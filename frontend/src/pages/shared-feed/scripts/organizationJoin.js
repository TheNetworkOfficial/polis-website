const fields = new Set(["fullName", "email", "reason"]);

const errors = {
  join_application_state_changed:
    "Your application status has changed. Open the form again to check it.",
};
const completedStatuses = {
  already_member: "member",
  already_invited: "invited",
  duplicate_request: "pending",
};

function readForm(payload) {
  if (
    !payload?.organization?.coalitionId ||
    !Number.isSafeInteger(payload.formVersion) ||
    !Array.isArray(payload.questions)
  ) {
    throw new Error("invalid_join_form");
  }
  return payload;
}

function emptyDraft() {
  return { fullName: "", email: "", reason: "", answers: new Map() };
}

export function createOrganizationJoin({ request, actorId, changed }) {
  let view = null;

  function state() {
    const actor = actorId();
    if (!actor) {
      view = null;
      return null;
    }
    if (view?.actor !== actor) {
      view = {
        actor,
        items: [],
        cursor: "",
        loaded: false,
        loading: false,
        directoryError: "",
        error: "",
        notice: "",
        selection: null,
        form: null,
        draft: emptyDraft(),
        code: "",
        busy: "",
      };
    }
    return view;
  }

  function guard(current, selection = current.selection) {
    return () => {
      if (state() !== current || current.selection !== selection) {
        throw new Error("join_context_changed");
      }
    };
  }

  async function loadDirectory({ more = false, refresh = false } = {}) {
    const current = state();
    if (
      !current ||
      current.loading ||
      (more ? !current.cursor : current.loaded && !refresh)
    )
      return;
    const cursor = more ? current.cursor : "";
    current.loading = true;
    current.directoryError = "";
    changed();
    try {
      const payload = await request(
        `/api/organizations/join-directory${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        {
          auth: true,
          beforeDispatch: () => {
            if (state() !== current) throw new Error("join_context_changed");
          },
        },
      );
      if (state() !== current) return;
      const unique = new Map(
        (more ? current.items : []).map((item) => [item.coalitionId, item]),
      );
      for (const item of payload.items || []) {
        if (item?.coalitionId) unique.set(item.coalitionId, item);
      }
      current.items = [...unique.values()];
      current.cursor = payload.nextCursor || "";
      current.loaded = true;
    } catch {
      current.directoryError =
        "Could not load public organizations. Try again.";
    } finally {
      current.loading = false;
      if (state() === current) changed();
    }
  }

  async function fetchForm(current, selection) {
    const options = { auth: true, beforeDispatch: guard(current, selection) };
    const payload =
      selection.source === "code"
        ? await request("/api/organizations/join-code", {
            ...options,
            method: "POST",
            body: { code: selection.code },
          })
        : await request(
            `/api/coalitions/${encodeURIComponent(selection.id)}/join-application?source=directory`,
            options,
          );
    options.beforeDispatch();
    return readForm(payload);
  }

  async function open(source, value) {
    const current = state();
    if (!current || current.busy || !value) return;
    const selection =
      source === "code"
        ? { source, code: value.trim() }
        : { source, id: value };
    if (source === "code" && !selection.code) return;
    current.selection = selection;
    current.form = null;
    current.draft = emptyDraft();
    current.error = "";
    current.notice = "";
    current.busy = "opening";
    changed();
    try {
      current.form = await fetchForm(current, selection);
      current.code = "";
      if (
        current.form.requestStatus &&
        current.form.requestStatus !== "rejected"
      ) {
        current.selection = null;
      }
    } catch (error) {
      current.selection = null;
      current.error =
        error.status === 404
          ? source === "code"
            ? "That private code could not be found."
            : "This organization is no longer listed."
          : "Could not open the application. Try again.";
    } finally {
      current.busy = "";
      if (state() === current) changed();
    }
  }

  function update(name, value) {
    const current = state();
    if (!current || current.busy) return;
    if (name === "code") current.code = value;
    else if (fields.has(name)) current.draft[name] = value;
    else if (name.startsWith("question:"))
      current.draft.answers.set(name.slice(9), value);
  }

  async function submit(data) {
    const current = state();
    if (!current?.form || !current.selection || current.busy) return;
    const { form, selection, draft } = current;
    for (const [key, value] of data) update(key, value);
    const answers = form.questions
      .map(({ id }) => ({
        questionId: id,
        value: (draft.answers.get(id) || "").trim(),
      }))
      .filter(({ value }) => value);
    current.error = "";
    current.notice = "";
    current.busy = "sending";
    changed();
    try {
      await request(
        `/api/coalitions/${encodeURIComponent(form.organization.coalitionId)}/join`,
        {
          auth: true,
          method: "POST",
          beforeDispatch: guard(current, selection),
          body: {
            source: selection.source,
            ...(selection.source === "code" ? { code: selection.code } : {}),
            formVersion: form.formVersion,
            fullName: draft.fullName.trim(),
            email: draft.email.trim(),
            reason: draft.reason.trim(),
            answers,
          },
        },
      );
      guard(current, selection)();
      current.form = { ...form, requestStatus: "pending" };
      current.selection = null;
      current.draft = emptyDraft();
    } catch (error) {
      const key = error.payload?.error;
      if (state() !== current || current.selection !== selection) return;
      if (Object.hasOwn(completedStatuses, key)) {
        current.form = { ...form, requestStatus: completedStatuses[key] };
        current.selection = null;
        current.draft = emptyDraft();
      } else if (key === "join_application_form_changed") {
        try {
          const latest = await fetchForm(current, selection);
          current.form = latest;
          const previous = new Map(
            form.questions.map((question) => [question.id, question]),
          );
          for (const question of latest.questions) {
            const prior = previous.get(question.id);
            if (
              prior?.label !== question.label ||
              prior.required !== question.required
            ) {
              draft.answers.delete(question.id);
            }
          }
          current.notice =
            "The organization updated its form. Review the questions before resubmitting.";
          if (latest.requestStatus && latest.requestStatus !== "rejected") {
            current.selection = null;
            current.draft = emptyDraft();
          }
        } catch {
          current.error =
            "Could not refresh the updated form. Try submitting again to refresh it.";
        }
      } else {
        current.error =
          errors[key] ||
          (error.status === 404
            ? "This organization no longer accepts applications from this listing or code."
            : error.status === 400
              ? "Check your contact information and complete all required fields."
              : "Could not send your application. Try again.");
      }
    } finally {
      current.busy = "";
      if (state() === current) changed();
    }
  }

  function close() {
    const current = state();
    if (!current || current.busy) return;
    current.selection = null;
    current.form = null;
    current.draft = emptyDraft();
    current.error = "";
    current.notice = "";
    changed();
  }

  return {
    state,
    loadDirectory,
    open,
    update,
    submit,
    close,
    reset: () => {
      view = null;
    },
  };
}
