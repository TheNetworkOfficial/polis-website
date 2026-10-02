import {
  escapeText as e,
  id,
  list,
  button,
  notice,
  select,
  uuid,
} from "./textingWorkspaceUi";

/** Recipient-scoped edits only. An uncertain save retains its exact operation and
 * payload; checking saved status never issues another mutation. */
export function createRecipientOutcomes(r, prefix) {
  let target = null,
    outcome = null,
    selected = new Set(),
    party = "",
    pending = null,
    busy = false,
    disposed = false,
    generation = 0,
    saved = false;
  const enabled = () => {
    if (disposed || !r.can("recordRecipientOutcome")) return false;
    try {
      r.guard();
      return true;
    } catch {
      return false;
    }
  };
  const actionName = (name) => `${prefix}-${name}`;
  const path = (value) =>
    value?.conversationId
      ? `/conversations/${id(value.conversationId)}/outcome`
      : `/campaigns/${id(value?.campaignId)}/queue/${id(value?.itemId)}/outcome`;
  const identity = (value) => JSON.stringify(value);
  const verify = () => {
    r.guard();
    if (!enabled())
      throw new Error("Your permission to record outcomes has changed.");
  };
  function accept(result, append = false) {
    const value = result?.outcome;
    if (
      !value?.capabilities?.record ||
      !Number.isSafeInteger(value.contactRevision) ||
      !Array.isArray(value.availableTags) ||
      !Array.isArray(value.tags) ||
      !Array.isArray(value.partyOptions)
    )
      throw new Error("The saved outcome could not be verified.");
    if (append && outcome?.contactRevision !== value.contactRevision) {
      append = false;
      r.toast(
        "This contact changed. Review its current outcome before saving.",
      );
    }
    const available = append
      ? [...list(outcome?.availableTags), ...value.availableTags]
      : value.availableTags;
    outcome = {
      ...value,
      availableTags: [
        ...new Map(available.map((tag) => [tag.tagId, tag])).values(),
      ],
    };
    if (!append) {
      selected = new Set(value.tags.map((tag) => tag.tagId));
      party = value.selfReportedParty ?? "";
    }
    if (pending && value.savedOperationId === pending.operationId) {
      pending = null;
      saved = true;
      r.toast("Recipient outcome saved.");
    }
  }
  async function read({ append = false, operation = false } = {}) {
    verify();
    const version = generation,
      key = identity(target);
    const query =
      operation && pending
        ? `?operationId=${id(pending.operationId)}`
        : append && outcome?.nextTagCursor
          ? `?tagCursor=${id(outcome.nextTagCursor)}`
          : "";
    const result = await r.api(path(target) + query);
    verify();
    if (version !== generation || key !== identity(target)) return;
    accept(result, append);
  }
  function trigger(value, text = "Record outcome") {
    if (!enabled() || !value) return "";
    return button(actionName("open"), text, {
      secondary: true,
      disabled: r.busy() || busy,
      value: JSON.stringify(value),
    });
  }
  function render() {
    if (!enabled() || !target || !outcome) return "";
    const tags = [
      ...new Map(
        [...outcome.availableTags, ...outcome.tags].map((tag) => [
          tag.tagId,
          tag,
        ]),
      ).values(),
    ];
    const options = [
      ["", "Not recorded"],
      ...outcome.partyOptions.map((value) => [value, value]),
    ];
    if (party && !outcome.partyOptions.includes(party))
      options.push([party, party]);
    return `<section class="pt-recipient-outcome" aria-label="Recipient outcome"><h3>Record outcome</h3><p class="pt-muted">Save what this person shared. Texting consent stays unchanged.</p>${saved ? notice("Outcome saved") : ""}${pending ? notice("Save needs confirmation", "Check the saved status before continuing. Retrying uses the same change.") + button(actionName("check"), "Check saved status", { secondary: true, disabled: busy || r.busy() }) + button(actionName("retry"), "Retry this save", { secondary: true, disabled: busy || r.busy() }) : ""}<form data-workspace-form="${actionName("save")}"><fieldset${pending || busy ? " disabled" : ""}><legend>Tags</legend>${tags.length ? tags.map((tag) => `<label class="pt-outcome-tag"><input type="checkbox" data-outcome-change="${prefix}" data-tag-id="${e(tag.tagId)}"${selected.has(tag.tagId) ? " checked" : ""}><span>${e(tag.label)}</span></label>`).join("") : `<p class="pt-muted">${outcome.capabilities.manageTags ? "Choose tags marked Available to texting volunteers in Contact book → Fields and tags." : "No tags are available for texting outcomes yet."}</p>`}${outcome.nextTagCursor ? button(actionName("more"), "More available tags", { secondary: true, disabled: busy || r.busy() }) : ""}${select("outcomeParty", "Self-reported party", options, party).replace("<select ", `<select data-outcome-change="${prefix}" `)}<div class="pt-actions"><button class="pt-btn" type="submit">Save outcome</button></div></fieldset></form>${!pending ? button(actionName("close"), "Close outcome", { secondary: true, disabled: busy }) : ""}</section>`;
  }
  async function send() {
    verify();
    if (!pending) throw new Error("There is no saved change to retry.");
    const version = generation,
      body = pending;
    busy = true;
    try {
      const result = await r.api(path(target), body);
      verify();
      if (version !== generation) return;
      if (result?.outcome?.savedOperationId !== body.operationId)
        throw new Error("Check the saved outcome before continuing.");
      accept(result);
    } catch (error) {
      if ([400, 409].includes(error?.status)) {
        pending = null;
        await read();
        throw new Error(
          "This contact changed. Review its current outcome and save again.",
        );
      }
      throw error;
    } finally {
      busy = false;
    }
  }
  async function action(name, value) {
    if (!name.startsWith(`${prefix}-`)) return false;
    verify();
    if (busy) return true;
    if (name === actionName("open")) {
      let next;
      try {
        next = JSON.parse(value);
      } catch {
        throw new Error("Recipient is unavailable.");
      }
      if (
        !next ||
        (next.conversationId
          ? Object.keys(next).join() !== "conversationId"
          : !next.campaignId ||
            !next.itemId ||
            Object.keys(next).some(
              (key) => !["campaignId", "itemId"].includes(key),
            ))
      )
        throw new Error("Recipient is unavailable.");
      if (pending && identity(next) !== identity(target))
        throw new Error("Check the previous recipient’s saved outcome first.");
      target = next;
      saved = false;
      generation++;
      await read({ operation: Boolean(pending) });
    } else if (name === actionName("more")) await read({ append: true });
    else if (name === actionName("check")) await read({ operation: true });
    else if (name === actionName("retry")) await send();
    else if (name === actionName("close") && !pending) {
      target = null;
      outcome = null;
      generation++;
    }
    return true;
  }
  function change(input) {
    if (input.dataset?.outcomeChange !== prefix) return false;
    verify();
    if (pending || busy) return true;
    saved = false;
    if (input.dataset.tagId) {
      const tag = [
        ...list(outcome?.availableTags),
        ...list(outcome?.tags),
      ].find((t) => t.tagId === input.dataset.tagId);
      if (!tag) throw new Error("Choose an available tag.");
      if (input.checked) selected.add(tag.tagId);
      else selected.delete(tag.tagId);
    } else if (input.name === "outcomeParty") party = input.value;
    return true;
  }
  async function submit(kind) {
    if (kind !== actionName("save")) return false;
    verify();
    if (pending || busy)
      throw new Error("Check the existing save before starting another.");
    const before = new Set(outcome.tags.map((tag) => tag.tagId));
    const addTagIds = [...selected].filter((tag) => !before.has(tag)),
      removeTagIds = [...before].filter((tag) => !selected.has(tag));
    const partyChanged = party !== (outcome.selfReportedParty ?? "");
    if (addTagIds.length + removeTagIds.length > 20)
      throw new Error("Change up to 20 tags at once.");
    if (partyChanged && !outcome.partyOptions.includes(party))
      throw new Error(
        "Choose the party this person reported, or leave it unchanged.",
      );
    if (!addTagIds.length && !removeTagIds.length && !partyChanged) {
      r.toast("No outcome changes to save.");
      return true;
    }
    pending = {
      operationId: uuid(),
      expectedRevision: outcome.contactRevision,
      addTagIds,
      removeTagIds,
      ...(partyChanged ? { selfReportedParty: party } : {}),
    };
    await send();
    return true;
  }
  return {
    trigger,
    render,
    action,
    submit,
    change,
    dispose() {
      disposed = true;
      generation++;
      pending = null;
      outcome = null;
      target = null;
      selected.clear();
    },
  };
}
