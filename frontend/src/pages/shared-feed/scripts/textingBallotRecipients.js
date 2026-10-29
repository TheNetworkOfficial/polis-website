import {
  button,
  count,
  escapeText as e,
  id,
  notice,
  select,
  uuid,
} from "./textingWorkspaceUi";

const staleCodes = new Set([
  "ballot_snapshot_changed",
  "ballot_publication_pending",
  "ballot_cursor_stale",
  "contact_cursor_query_changed",
  "contact_selection_access_changed",
  "contact_book_changed",
]);
const refPattern = /^voter_[a-f0-9]{2}_[a-f0-9]{64}$/;
const heldLabels = {
  invalid_phone: "Invalid phone",
  missing_phone: "No phone number",
  blank_phone: "No phone number",
  usable_phone_required: "No usable phone number",
  duplicate_phone: "Shared phone numbers",
  opted_out: "Opted out",
  STOP: "Opted out",
  stop: "Opted out",
  imported_opt_out: "Opted out",
  consent_evidence: "Opted out",
  prompt_inbound_stop: "Opted out",
  prompt_message_opt_out: "Opted out",
  prompt_contact_readback: "Opted out",
  prompt_opt_out: "Opted out",
  suppressed: "Contact restricted",
  do_not_contact: "Do not contact",
  consent_required: "Consent needed",
  sender_consent_verification_required: "Sender consent must be verified",
  source_policy: "Source use needs review",
  source_review_required: "Source use needs review",
  source_prohibits_sms: "Source does not permit texting",
  not_outstanding: "Ballot no longer outstanding",
  ballot_no_longer_outstanding: "Ballot no longer outstanding",
  personalization_invalid: "Name or personalization needs review",
  contact_archived: "Contact is archived or unavailable",
  contact_endpoint_not_owned:
    "Phone number is no longer linked to this contact",
  household_not_sms_recipient: "Household records cannot receive texts",
};

function ballotRecipientReasonLabel(reason) {
  if (reason === "invalid_phone") return "Invalid or placeholder phone number";
  if (reason === "duplicate_phone") return "Shared phone number";
  return Object.hasOwn(heldLabels, reason)
    ? heldLabels[reason]
    : "Additional eligibility review required";
}

/** Display the saved classification without changing recipient eligibility. */
function ballotRecipientPreviewGroup(row) {
  if (row?.eligibility?.status === "eligible") return "eligible";
  const reasons = row?.eligibility?.reasons;
  if (
    Array.isArray(reasons) &&
    reasons.length > 0 &&
    reasons.every((reason) => reason === "sender_consent_verification_required")
  )
    return "consent";
  return ["held", "suppressed"].includes(row?.eligibility?.status)
    ? "held"
    : "review";
}

/** Only the existing saved examples are shown; totals cover the full review. */
function renderBallotRecipientPreview(job) {
  const samples = Array.isArray(job.samples) ? job.samples.slice(0, 10) : [],
    groups = [
      ["eligible", "Eligible examples"],
      ["consent", "Consent review examples"],
      ["held", "Held examples — excluded from campaign"],
      ["review", "Additional review examples"],
    ];
  return `<section aria-label="Recipient examples"><h3>Recipient examples</h3><p class="pt-muted">Up to 10 examples; totals above cover everyone reviewed.</p>${
    job.eligibleCount > 0 &&
    !samples.some((row) => ballotRecipientPreviewGroup(row) === "eligible")
      ? notice(
          "Eligible recipients",
          `This small preview does not include an eligible example. Total eligible recipients: ${count(job.eligibleCount)}.`,
        )
      : ""
  }${
    samples.length
      ? groups
          .map(([key, title]) => {
            const rows = samples.filter(
              (row) => ballotRecipientPreviewGroup(row) === key,
            );
            if (!rows.length) return "";
            return `<section aria-label="${e(title)}"><h4>${e(title)}</h4>${rows
              .map((row) => {
                const reasons = Array.isArray(row?.eligibility?.reasons)
                  ? [
                      ...new Set(
                        row.eligibility.reasons.map(ballotRecipientReasonLabel),
                      ),
                    ]
                  : [];
                return `<div class="pt-row"><div><strong>${e(row?.displayName || "Selected voter")}</strong>${key !== "eligible" ? `<p class="pt-muted">${e(reasons.length ? reasons.join(" · ") : "Additional eligibility review required")}</p>` : ""}</div><span>${e(row?.maskedPhone || "")}</span></div>`;
              })
              .join("")}</section>`;
          })
          .join("")
      : '<p class="pt-muted">No recipient examples were saved for this review.</p>'
  }</section>`;
}
const submissionFor = (seed, phoneFieldId, operationId) => ({
  operationId,
  ...seed.query,
  snapshotId: seed.ballotChase.snapshotId,
  view: "outstanding",
  selection: structuredClone(seed.selection),
  phoneFieldId,
});

const reviewFailed = (job) =>
  job?.status === "needs_review" &&
  (job.reason !== "prompt_campaign_no_eligible_recipients" ||
    !!job.failureCode);
function reviewFailureNotice(job) {
  if (!reviewFailed(job))
    return notice(
      "No recipients ready",
      "Review the held reasons or choose another phone column from a fresh ballot list.",
    );
  if (staleCodes.has(job.failureCode))
    return notice(
      "Review paused",
      "The ballot list, contact information or access changed before review finished. Reopen Ballot Chaser, choose Outstanding, and select the voters again. These are not completed eligibility results.",
    );
  if (
    ["contact_book_permission_denied", "contact_book_access_denied"].includes(
      job.failureCode,
    )
  )
    return notice(
      "Review paused",
      "Access changed before review finished. Reopen Ballot Chaser and check your access before choosing recipients again. These are not completed eligibility results.",
    );
  return notice(
    "Recipient review failed",
    "The server could not complete this review. This does not mean there are no usable recipients. After the issue is resolved, reopen Ballot Chaser and choose a fresh Outstanding list. Check progress cannot restart this failed review.",
  );
}

/** A scoped read never sets up access, prepares a provider audience or sends. */
export async function readBallotTextingAccess({ request, scopeKey, guard }) {
  guard();
  if (!/^coalition:[^:]+$/.test(scopeKey)) return false;
  try {
    const prefix = `/api/text-banking/prompt/scopes/${id(scopeKey)}`;
    const result = await request(`${prefix}/workspace`, {
      auth: true,
      beforeRequest: guard,
    });
    guard();
    const workspace = result?.workspace;
    if (
      result?.ok !== true ||
      workspace?.scopeKey !== scopeKey ||
      workspace.manualOnly !== true ||
      !["prompt", "polis"].includes(workspace.provider) ||
      workspace.status !== "configured" ||
      workspace.capabilities?.createCampaigns !== true
    )
      return false;
    const neutral =
      workspace.contractVersion === 2 ||
      workspace.capabilities?.neutralWorkspaceApi === true;
    const billing = await request(
      `${neutral ? `/api/text-banking/workspaces/${id(scopeKey)}` : prefix}/billing/summary`,
      { auth: true, beforeRequest: guard },
    );
    guard();
    return (
      billing?.ok === true &&
      billing.billing?.canManageBilling === true &&
      (workspace.capabilities?.manageBilling === true ||
        (!neutral && workspace.capabilities?.manageBilling === undefined))
    );
  } catch {
    guard();
    return false;
  }
}

export function ballotTextingSeed(value) {
  const chase = value?.ballotChase,
    selection = value?.selection;
  if (
    value?.sourceType !== "ballot_register" ||
    !chase?.electionId ||
    !chase.snapshotId ||
    chase.view !== "outstanding" ||
    !["explicit", "all_matching"].includes(selection?.mode)
  )
    throw new Error(
      "Reopen the outstanding ballot list to choose campaign recipients.",
    );
  const included = selection.includeVoterRefs ?? [],
    excluded = selection.excludeVoterRefs ?? [];
  if (
    !Array.isArray(included) ||
    !Array.isArray(excluded) ||
    included.length + excluded.length > 5000 ||
    [...included, ...excluded].some(
      (value) => typeof value !== "string" || !refPattern.test(value),
    ) ||
    selection.includeIds?.length ||
    selection.excludeIds?.length ||
    (selection.mode === "explicit" && !included.length)
  )
    throw new Error(
      "Choose up to 5,000 individual selection changes, or select all matching voters.",
    );
  return structuredClone({
    sourceType: "ballot_register",
    ballotChase: {
      electionId: chase.electionId,
      snapshotId: chase.snapshotId,
      view: "outstanding",
    },
    query: Object.fromEntries(
      ["filter", "search", "sort"]
        .filter((key) => value.query?.[key] !== undefined)
        .map((key) => [key, value.query[key]]),
    ),
    selection: {
      mode: selection.mode,
      includeVoterRefs: [...new Set(included)],
      excludeVoterRefs: [...new Set(excluded)],
    },
  });
}

/** Register-only recipient review. The existing composer still owns draft/save/activation. */
export function createTextingBallotRecipients(
  r,
  { schedule = setTimeout, cancel = clearTimeout } = {},
) {
  let state = {},
    generation = 0,
    disposed = false,
    timer,
    flight = null,
    reads = 0;
  const current = (version = generation) => {
    r.guard();
    if (disposed || version !== generation)
      throw new Error("This recipient review is no longer open.");
  };
  const capable = () =>
    r.can("createCampaigns") &&
    r.can("manageBilling") &&
    ["read", "select", "export", "personal", "campaign"].every(
      (key) => state.capabilities?.[key] === true,
    );
  const base = () =>
    `/ballot-chaser/elections/${id(state.seed.ballotChase.electionId)}/texting-selections`;
  const changed = () => {
    current();
    r.changed();
  };
  const clearAudience = () => {
    const draft = r.view().campaigns?.draft;
    if (draft) draft.audienceId = "";
  };
  function fail(error) {
    state.reviewedManifest = null;
    clearAudience();
    const denied = [401, 403].includes(error.status || error.statusCode);
    if (denied || staleCodes.has(error.payload?.error || error.code)) {
      cancel(timer);
      state.job = null;
      state.denied = denied;
      state.stale = !denied;
      state.error = denied
        ? "Access changed. Reopen Ballot Chaser."
        : "A new county update is available. Reopen Ballot Chaser and choose this list again.";
    } else
      state.error = "Recipient review paused. Check this request to continue.";
  }
  async function call(path, body, version = generation) {
    current(version);
    const result = await r.contactApi(path, body);
    current(version);
    return result;
  }
  function accept(value) {
    const chase = state.seed.ballotChase;
    if (
      !value?.selectionId ||
      value.sourceType !== "ballot_register" ||
      !["building", "ready", "needs_review"].includes(value.status) ||
      value.ballotChase?.electionId !== chase.electionId ||
      value.ballotChase?.snapshotId !== chase.snapshotId ||
      value.ballotChase?.view !== "outstanding" ||
      (state.job && state.job.selectionId !== value.selectionId)
    )
      throw Object.assign(new Error("This ballot recipient list changed."), {
        code: "ballot_snapshot_changed",
      });
    if (
      (value.status !== "building" &&
        [
          "count",
          "eligibleCount",
          "consentReviewableCount",
          "recipientCount",
          "excludedCount",
        ].some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0)) ||
      (value.status === "ready" &&
        (!/^[a-f0-9]{64}$/.test(value.manifestSha256 || "") ||
          value.recipientCount < 1 ||
          (value.duplicateEndpointCount || 0) !== 0 ||
          value.recipientCount !==
            value.eligibleCount + value.consentReviewableCount ||
          value.count !== value.recipientCount + value.excludedCount))
    )
      throw new Error("The recipient totals could not be confirmed.");
    if (state.job?.manifestSha256 !== value.manifestSha256)
      state.reviewedManifest = null;
    state.job = value;
    state.error = "";
    cancel(timer);
    if (value.status === "building" && reads < 120)
      timer = schedule(() => {
        try {
          current();
        } catch {
          return;
        }
        if (globalThis.document?.hidden || r.busy()) {
          accept(state.job);
          return;
        }
        void refresh().catch(() => {});
      }, 5000);
  }
  async function load({ selection } = {}) {
    current();
    if (selection) {
      generation++;
      cancel(timer);
      state = { seed: ballotTextingSeed(selection) };
      clearAudience();
    }
    if (!state.seed) return;
    const version = generation;
    state.loading = true;
    try {
      const schema = await call("/schema", undefined, version);
      state.capabilities = schema.capabilities;
      if (
        !["read", "select", "export", "personal", "campaign"].every(
          (key) => state.capabilities?.[key] === true,
        )
      )
        throw Object.assign(new Error("Recipient access changed."), {
          status: 403,
        });
      const chase = state.seed.ballotChase;
      const page = await call(
        `/ballot-chaser/elections/${id(chase.electionId)}/voters`,
        {
          ...state.seed.query,
          snapshotId: chase.snapshotId,
          view: "outstanding",
          limit: 1,
        },
        version,
      );
      if (
        page.storageMode !== "register" ||
        page.ballotChase?.snapshotId !== chase.snapshotId ||
        page.ballotChase?.electionId !== chase.electionId ||
        page.ballotChase?.view !== "outstanding"
      )
        throw Object.assign(new Error("This ballot list changed."), {
          code: "ballot_snapshot_changed",
        });
      state.phoneFields = (
        Array.isArray(page.schema) ? page.schema : []
      ).filter((field) => field.textingPhone === true);
      state.phoneFieldId ||=
        state.phoneFields.find((field) => field.fieldId === "phone")?.fieldId ||
        "";
      if (
        state.submission &&
        !state.phoneFields.some(
          (field) => field.fieldId === state.submission.phoneFieldId,
        )
      )
        throw Object.assign(new Error("Phone field access changed."), {
          status: 403,
        });
      if (state.job?.selectionId)
        accept(
          (
            await call(
              `${base()}/${id(state.job.selectionId)}`,
              undefined,
              version,
            )
          ).selection,
        );
    } catch (error) {
      if (!disposed && version === generation) {
        current(version);
        fail(error);
      }
    } finally {
      if (!disposed && version === generation) {
        state.loading = false;
        changed();
      }
    }
  }
  async function refresh() {
    if (
      flight ||
      !state.job?.selectionId ||
      disposed ||
      state.stale ||
      state.denied
    )
      return flight;
    const version = generation;
    reads++;
    flight = (async () => {
      try {
        accept(
          (
            await call(
              `${base()}/${id(state.job.selectionId)}`,
              undefined,
              version,
            )
          ).selection,
        );
      } catch (error) {
        if (!disposed && version === generation) {
          current(version);
          fail(error);
        }
      } finally {
        if (!disposed && version === generation) changed();
      }
    })().finally(() => {
      flight = null;
    });
    return flight;
  }
  const reviewed = () =>
    capable() &&
    !state.stale &&
    !state.denied &&
    state.job?.status === "ready" &&
    state.job.recipientCount > 0 &&
    state.reviewedManifest === state.job.manifestSha256;
  async function action(name) {
    if (!name.startsWith("ballot-recipients-")) return false;
    current();
    if (state.loading || state.stale || state.denied) return true;
    if (!capable()) throw new Error("Campaign recipient access is restricted.");
    if (name === "ballot-recipients-refresh") {
      await refresh();
      return true;
    }
    if (name === "ballot-recipients-review") {
      if (
        !state.phoneFields?.some(
          (field) => field.fieldId === state.phoneFieldId,
        )
      )
        throw new Error("Choose the phone column to review.");
      const version = generation;
      state.submission ||= submissionFor(
        state.seed,
        state.phoneFieldId,
        uuid(),
      );
      state.loading = true;
      state.reviewedManifest = null;
      changed();
      try {
        accept(
          (await call(base(), structuredClone(state.submission), version))
            .selection,
        );
      } catch (error) {
        if (!disposed && version === generation) {
          current(version);
          fail(error);
        }
      } finally {
        if (!disposed && version === generation) {
          state.loading = false;
          changed();
        }
      }
    }
    return true;
  }
  async function bindCampaign(campaignId) {
    current();
    if (!reviewed())
      throw new Error(
        "Review and confirm the recipients before saving this campaign.",
      );
    const manifest = state.reviewedManifest;
    await refresh();
    current();
    if (!reviewed() || state.job.manifestSha256 !== manifest)
      throw new Error("Review this recipient list again before saving.");
    if (
      state.bound?.campaignId === campaignId &&
      state.bound.selectionId === state.job.selectionId
    )
      return state.bound.audienceId;
    state.binding ||= { operationId: uuid(), campaignId };
    if (state.binding.campaignId !== campaignId)
      throw new Error(
        "Reopen this saved campaign draft to check its recipient request.",
      );
    changed();
    const result = await call(
      `/selections/${id(state.job.selectionId)}/campaign`,
      structuredClone(state.binding),
    );
    if (!result.audienceId || result.exportAuthorized !== false)
      throw new Error(
        "The campaign recipient selection could not be confirmed.",
      );
    state.bound = { ...result, campaignId, selectionId: state.job.selectionId };
    changed();
    return result.audienceId;
  }
  function render() {
    if (!state.seed) return "";
    if (state.denied || state.stale)
      return notice("Choose a fresh ballot list", state.error);
    const job = state.job;
    const held = Object.entries(job?.heldCounts || {}).filter(
      ([key, value]) =>
        key !== "sender_consent_verification_required" &&
        Number.isSafeInteger(value) &&
        value > 0,
    );
    return `<section class="pt-card" aria-label="Ballot campaign recipients"><h2>Outstanding ballot recipients</h2>
      <p class="pt-muted">Review phone eligibility before saving your campaign.</p>
      ${state.error ? notice("Review paused", state.error) : ""}
      ${!state.submission ? `<form data-workspace-form="ballot-recipients-phone">${select("phoneFieldId", "Phone column", [["", "Choose a column"], ...(state.phoneFields || []).map((field) => [field.fieldId, field.label])], state.phoneFieldId)}<button type="submit" class="pt-btn"${state.loading || !capable() || !state.phoneFields?.length ? " disabled" : ""}>Review recipients</button></form>` : ""}
      ${!state.phoneFields?.length && !state.loading ? notice("No phone column", "This county report has no phone column available for texting.") : ""}
      ${state.loading || job?.status === "building" ? '<p role="status">Checking phone numbers…</p>' : ""}
      ${
        job && job.status !== "building" && !reviewFailed(job)
          ? `<p class="pt-muted">${count(job.count)} voters reviewed</p><div class="pt-grid pt-grid--three">${[
              ["Eligible now", job.eligibleCount],
              ["Consent review", job.consentReviewableCount],
              ["Held", job.excludedCount],
            ]
              .map(
                ([text, value]) =>
                  `<div><strong>${count(value)}</strong><p class="pt-muted">${text}</p></div>`,
              )
              .join(
                "",
              )}</div>${held.length ? `<dl>${held.map(([key, value]) => `<div class="pt-row"><dt>${e(Object.hasOwn(heldLabels, key) ? heldLabels[key] : "Additional eligibility review required")}</dt><dd>${count(value)}</dd></div>`).join("")}</dl>` : ""}${renderBallotRecipientPreview(job)}`
          : ""
      }
      ${job?.status === "ready" ? `<label class="pt-workspace-check"><input type="checkbox" data-workspace-ballot-reviewed${reviewed() ? " checked" : ""}${!capable() || state.loading ? " disabled" : ""}>I reviewed these recipients</label><p class="pt-muted">${job.consentReviewableCount ? "Sender consent must be verified before preparation. " : "Held voters are excluded. "}Saving creates a draft.</p>` : job?.status === "needs_review" ? reviewFailureNotice(job) : ""}
      ${state.submission && !job ? button("ballot-recipients-review", "Check this request", { secondary: true, disabled: state.loading || !capable() }) : job && job.status !== "needs_review" ? button("ballot-recipients-refresh", "Check progress", { secondary: true, disabled: state.loading || !capable() }) : ""}
    </section>`;
  }
  return {
    load,
    action,
    bindCampaign,
    render,
    renderPreparation: render,
    renderReview: () => "",
    reviewed,
    selection: () => state.job,
    hasSelection: () => !!state.seed,
    prepareInBackground() {},
    localAction: () => false,
    async reviewForCampaign() {
      return reviewed();
    },
    async submit(kind, form) {
      if (kind !== "ballot-recipients-phone") return false;
      current();
      if (state.submission) return true;
      const data = form instanceof FormData ? form : new FormData(form);
      state.phoneFieldId = String(data.get("phoneFieldId") || "");
      return action("ballot-recipients-review");
    },
    change(target) {
      if (
        target.name === "phoneFieldId" &&
        target.closest?.('[data-workspace-form="ballot-recipients-phone"]')
      ) {
        current();
        if (
          !state.submission &&
          state.phoneFields?.some((field) => field.fieldId === target.value)
        ) {
          state.phoneFieldId = target.value;
          return true;
        }
        return false;
      }
      if (target.dataset.workspaceBallotReviewed === undefined) return false;
      current();
      state.reviewedManifest =
        target.checked && capable() && state.job?.status === "ready"
          ? state.job.manifestSha256
          : null;
      return true;
    },
    snapshot() {
      return (
        state.seed && {
          sourceType: "ballot_register",
          seed: state.seed,
          submission: state.submission
            ? {
                operationId: state.submission.operationId,
                phoneFieldId: state.submission.phoneFieldId,
              }
            : undefined,
          selectionId: state.job?.selectionId,
          binding: state.binding,
        }
      );
    },
    restore(saved) {
      const seed = ballotTextingSeed(saved.seed);
      state = {
        seed,
        submission: saved.submission
          ? submissionFor(
              seed,
              saved.submission.phoneFieldId,
              saved.submission.operationId,
            )
          : undefined,
        phoneFieldId: saved.submission?.phoneFieldId,
        job: saved.selectionId ? { selectionId: saved.selectionId } : null,
        binding: saved.binding,
      };
    },
    dispose() {
      disposed = true;
      generation++;
      cancel(timer);
      state = {};
    },
  };
}
