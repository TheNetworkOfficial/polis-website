import {
  escapeText as e,
  field,
  select,
  textarea,
  notice,
  list,
  id,
  uuid,
} from "./textingWorkspaceUi";
import { validateQuestionAnswers } from "./ballotChaserModel";

export function renderCanvassingQuestionAnswers(questions, answers = {}) {
  return list(questions)
    .map((question) =>
      question.type === "text"
        ? textarea(
            `answer_${question.id}`,
            question.prompt,
            answers[question.id] || "",
            question.required,
            2000,
          )
        : question.type === "multi"
          ? `<fieldset><legend>${e(question.prompt)}</legend>${list(
              question.choices,
            )
              .map(
                (choice) =>
                  `<label class="pt-workspace-check"><input type="checkbox" name="answer_${e(question.id)}" value="${e(choice)}"${list(answers[question.id]).includes(choice) ? " checked" : ""}>${e(choice)}</label>`,
              )
              .join("")}</fieldset>`
          : select(
              `answer_${question.id}`,
              question.prompt,
              [
                ["", "Not answered"],
                ...list(question.choices).map((choice) => [choice, choice]),
              ],
              answers[question.id] || "",
              question.required,
            ),
    )
    .join("");
}

/** Uses authorized address and resident choices; all identity keys stay internal. */
export function createBallotChaserCanvassing({
  request,
  context,
  guard,
  run,
  changed,
  busy,
}) {
  let state = { locations: [], answers: {} },
    generation = 0;
  const base = "/api/voter-map/canvassing";
  const query = (values) =>
    new URLSearchParams({ coalitionId: context().scopeId, ...values });
  const button = (action, text, value = "") =>
    `<button type="button" class="pt-btn pt-btn--secondary" data-ballot-door-action="${e(action)}" data-value="${e(value)}"${busy() ? " disabled" : ""}>${e(text)}</button>`;
  async function call(path, options = {}) {
    const version = generation;
    guard();
    let result;
    try {
      result = await request(`${base}${path}`, {
        auth: true,
        ...options,
        beforeRequest: guard,
      });
    } catch (error) {
      if ([401, 403].includes(error.status || error.statusCode)) {
        generation++;
        state = { locations: [], answers: {} };
      }
      throw error;
    }
    guard();
    if (generation !== version)
      throw new Error("The selected door changed. Reopen the visit.");
    if (result?.ok !== true)
      throw new Error("The DoorKnocker response could not be verified.");
    return result;
  }
  async function load(more = false, search = "") {
    const result = await call(
      `/operations?${query({ kind: "locations", limit: "25", ...(search ? { q: search } : {}), ...(more && state.cursor ? { cursor: state.cursor } : {}) })}`,
    );
    state.locations = [...(more ? state.locations : []), ...list(result.items)];
    state.cursor = result.nextCursor;
  }
  async function open(location, unit = "") {
    generation++;
    state.ready = false;
    state.location = location;
    state.answers = {};
    state.draft = null;
    state.outcome = "contacted";
    const result = await call(
      `/context?${query({ lat: String(location.lat), lng: String(location.lng), buildingId: location.buildingId || `pin:${location.lat}:${location.lng}`, addressLabel: location.addressLabel || "", includeStreetView: "false", ...(unit ? { unit } : {}) })}`,
    );
    state.operations = result.operations;
    const address = result.address || location.address;
    state.address = address
      ? {
          line1: address.line1 || address.addressLine1,
          line2: address.line2 || address.addressLine2 || unit,
          city: address.city,
          state: address.state || address.stateId,
          postalCode: address.postalCode,
        }
      : null;
    const operations = state.operations;
    if (operations?.ballotChase?.activeTargetCount === 0)
      throw new Error(
        "All selected voters at this door have returned their ballots. Choose another door.",
      );
    if (operations?.access?.canKnock !== true || operations.flags?.doNotKnock)
      throw new Error(
        "This address is not available for your assigned outreach.",
      );
    const roundId = operations.round?.roundId;
    if (!roundId || operations.round.status === "unresolved")
      throw new Error(
        "This address needs a resolved canvassing round before recording ballot outreach.",
      );
    const config = await call(
      `/configuration?${query({ runtime: "true", roundId, lat: String(location.lat), lng: String(location.lng) })}`,
    );
    state.configuration = config.configuration;
    state.visitId = uuid();
    state.submissionId = uuid();
    state.ready = true;
  }
  function render() {
    if (!state.location)
      return `<section class="pt-card" data-ballot-door><h2>Record DoorKnocker outreach</h2><p>Choose an authorized address and its exact unit. A conversation or literature drop can contribute to your outreach progress.</p><form data-ballot-door-form="search">${field("search", "Find an address", state.search || "")}<button class="pt-btn" type="submit"${busy() ? " disabled" : ""}>Find addresses</button></form>${state.locations.map((location) => `<article class="bc-history"><span>${e(location.addressLabel || "Recorded address")}</span>${button("open", "Open address", location.locationId)}</article>`).join("")}${state.cursor ? button("more", "More addresses") : ""}${!state.locations.length ? notice("No authorized recorded addresses on this page", "Use DoorKnocker to add or verify an address, or continue through the available pages.") : ""}</section>`;
    const op = state.operations || {},
      config = state.configuration;
    if (state.draft)
      return `<section class="pt-card" data-ballot-door><h2>${e(state.location.addressLabel || "Recorded address")}</h2>${notice("Original save is held for review", "Check the original save before starting another visit. Your original answers and submission identity are preserved.")}<form data-ballot-door-form="visit"><button class="pt-btn" type="submit"${busy() ? " disabled" : ""}>Check original save</button></form></section>`;
    const people = list(op.people);
    return `<section class="pt-card" data-ballot-door><h2>${e(state.location.addressLabel || "Recorded address")}${op.unit?.label ? ` · ${e(op.unit.label)}` : ""}</h2>${button("back", "Choose another address")}${
      op.units?.length > 1
        ? `<form data-ballot-door-form="unit">${select(
            "unit",
            "Unit",
            op.units.map((unit) => [
              unit.label || "",
              unit.label || "Main entrance",
            ]),
            op.unit?.label || "",
          )}<button class="pt-btn pt-btn--secondary" type="submit"${busy() ? " disabled" : ""}>Open unit</button></form>`
        : ""
    }${
      !state.ready
        ? notice("Load this door again before recording a visit")
        : `<form data-ballot-door-form="visit">${select(
            "outcome",
            "What happened?",
            [
              ["contacted", "Confirmed conversation"],
              ["left_literature", "Left literature"],
            ],
            state.outcome,
          )}${state.outcome === "contacted" ? `${select("person", "Who did you speak with?", [["", "Choose the person you spoke with"], ...people.map((person, index) => [String(index), person.displayName || "Recorded resident"])], state.person ?? "", true)}${!people.length ? notice("No identified residents available", "Identify and link the respondent in DoorKnocker before recording a ballot conversation here.") : ""}${renderCanvassingQuestionAnswers(config?.effective?.questions, state.answers)}` : "<p>Literature is recorded for this exact address and unit. Conversation answers are not required.</p>"}<button class="pt-btn" type="submit"${busy() || (state.outcome === "contacted" && !people.length) ? " disabled" : ""}>Save outreach visit</button><p>Volunteer reports do not change the county’s official ballot status.</p></form>`
    }</section>`;
  }
  async function save(data) {
    if (!state.ready) throw new Error("Reopen the address before saving.");
    if (state.draft) {
      await call(`/visits/${id(state.visitId)}?${query({})}`, {
        method: "PUT",
        body: state.draft,
      });
      state = {
        locations: state.locations,
        answers: {},
        cursor: state.cursor,
        message: "Original outreach save confirmed.",
      };
      return;
    }
    const op = state.operations,
      config = state.configuration,
      location = state.location;
    if (op?.ballotChase?.activeTargetCount === 0)
      throw new Error(
        "All selected voters at this door have returned their ballots. Choose another door.",
      );
    const outcome = data.get("outcome"),
      conversation = outcome === "contacted";
    if (!["contacted", "left_literature"].includes(outcome))
      throw new Error("Choose a conversation or literature drop.");
    const person = conversation
      ? list(op.people)[Number(data.get("person"))]
      : null;
    if (conversation && (!data.get("person") || !person))
      throw new Error("Choose the person you spoke with.");
    const answers = {};
    if (conversation)
      for (const question of list(config.effective.questions))
        answers[question.id] =
          question.type === "multi"
            ? data.getAll(`answer_${question.id}`)
            : data.get(`answer_${question.id}`) || "";
    const questionAnswers = validateQuestionAnswers(
      config.effective.questions,
      answers,
      { conversation },
    );
    state.answers = answers;
    // Reuse the same visit/submission identities after a timeout; the server owns receipts.
    state.draft ||= {
      buildingId: location.buildingId || `pin:${location.lat}:${location.lng}`,
      lat: location.lat,
      lng: location.lng,
      addressLabel: location.addressLabel || "",
      unit: op.unit?.label || "",
      outcome,
      observedAt: new Date().toISOString(),
      yardSignStatus: "not_checked",
      yardSignCandidateIds: [],
      notSeenCandidateIds: [],
      clientSubmissionId: state.submissionId,
      expectedRevision: 0,
      locationId: op.location.locationId,
      unitId: op.unit.unitId,
      ...(state.address ? { address: state.address } : {}),
      questionSet: {
        roundId: config.roundId,
        revision: config.revision,
        organizationRevision: config.organizationDefaults?.revision || 0,
        ...(config.effective.questions.some(
          (question) => question.id === "ballot_status",
        )
          ? { presetId: "ballot_chasing" }
          : {}),
      },
      respondents: person
        ? [
            {
              clientPersonId: uuid(),
              ...(person.personId ? { personId: person.personId } : {}),
              ...(person.contactId ? { contactId: person.contactId } : {}),
              ...(person.voterRecordId
                ? { voterRecordId: person.voterRecordId }
                : {}),
              displayName: person.displayName,
              contactResponse: "not_discussed",
              followUpActions: [],
              questionAnswers,
            },
          ]
        : [],
    };
    await call(`/visits/${id(state.visitId)}?${query({})}`, {
      method: "PUT",
      body: state.draft,
    });
    state = {
      locations: state.locations,
      answers: {},
      cursor: state.cursor,
      message:
        "Outreach visit saved. Related Contact Book results may still be processing.",
    };
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-ballot-door-action]");
    if (
      !target ||
      !context()?.userId ||
      !target.closest("[data-ballot-key]") ||
      target.disabled
    )
      return;
    event.preventDefault();
    void run(async () => {
      guard();
      if (target.dataset.ballotDoorAction === "open") {
        const location = state.locations.find(
          (item) => item.locationId === target.dataset.value,
        );
        if (location) await open(location);
      } else if (target.dataset.ballotDoorAction === "more")
        await load(true, state.search);
      else if (target.dataset.ballotDoorAction === "back") {
        generation++;
        state.location = null;
        state.ready = false;
      }
    });
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (
      !form.matches?.("[data-ballot-door-form]") ||
      !form.closest("[data-ballot-key]") ||
      !context()?.userId
    )
      return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    void run(async () => {
      guard();
      if (form.dataset.ballotDoorForm === "search") {
        state.search = data.get("search");
        await load(false, state.search);
      } else if (form.dataset.ballotDoorForm === "unit")
        await open(state.location, data.get("unit"));
      else await save(data);
    });
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!target.closest?.("[data-ballot-door]") || !context()?.userId) return;
    if (target.name === "outcome") {
      state.outcome = target.value;
      changed();
    }
    if (target.name === "person") state.person = target.value;
    if (target.name?.startsWith("answer_")) {
      const questionId = target.name.slice(7);
      state.answers[questionId] =
        target.type === "checkbox"
          ? new FormData(target.form).getAll(target.name)
          : target.value;
    }
  });
  return {
    load,
    render: () => (state.message ? notice(state.message) : "") + render(),
    reset: () => {
      generation++;
      state = { locations: [], answers: {} };
    },
  };
}
