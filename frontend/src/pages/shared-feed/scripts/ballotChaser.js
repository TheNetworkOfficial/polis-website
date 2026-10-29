import "../css/ballot-chaser.css";
import { createOrganizationContactsApi } from "./organizationContactsApi";
import { createOrganizationContactBook } from "./organizationContactBook";
import { loadContactCities } from "./organizationContactCities";
import { createBallotChaserCanvassing } from "./ballotChaserCanvassing";
import { createBallotExport } from "./ballotExport";
import { createBallotRegister } from "./ballotRegister";
import {
  createBallotPreparation,
  preparedReportDate,
  ballotPreparationCapacity,
  ballotSentPreparationPolicy,
} from "./ballotPreparation";
import { ballotPreparationPolicyLimits } from "./ballotPreparationModel";
import { readBallotTextingAccess } from "./textingBallotRecipients";
import { contactStateOptions } from "./organizationContactPresentation";
import { checksumBlob } from "../../files/scripts/sha256";
import {
  escapeText as e,
  button,
  field,
  select,
  textarea,
  head,
  notice,
  count,
  list,
  id,
  uuid,
  label,
} from "./textingWorkspaceUi";
import {
  ballotStatuses,
  ballotImportStatus,
  ballotImportPhase,
  unfinishedBallotUpload,
  ballotPreparationMessage,
  ballotImportControls,
  ballotAddCountyField,
  ballotContactColumns,
  ballotChaseContext,
  ballotReportDate as reportDate,
  ballotFileFormat,
  uploadBallotFile,
  uploadBallotParts,
  addBallotChasingPreset,
  ballotSourceUsePolicy,
  ballotViews,
} from "./ballotChaserModel";

const columns = (job) =>
  list(job?.columns).map((value) =>
    typeof value === "string" ? value : value.header || value.name,
  );
const sourceUseOptions = [
  ["unreviewed", "Needs review"],
  ["manual_sms", "Allowed for manual texting"],
  ["sms_with_opt_in", "Text only with documented opt-in"],
  ["not_for_sms", "Not for texting"],
];
const stages = new Set(["reviewing", "applying", "inspecting"]);
const closed = (job) =>
  ["complete", "cancelled", "failed"].includes(job?.status);

/** Organization-owned uploads and frozen outreach lists share the Contact Book. */
export function createBallotChaser({
  request,
  context,
  changed,
  beginContactCampaign,
  beginTerritories,
  canBuildTerritories = () => false,
}) {
  let view = {},
    sequence = 0,
    jobGeneration = 0,
    contacts = null,
    timer;
  const identity = () => {
    const c = context();
    return c?.userId &&
      ["coalition", "candidate"].includes(c.scopeType) &&
      c.section === "ballot-chaser"
      ? `${c.userId}:${c.scopeType}:${c.scopeId}`
      : "";
  };
  const current = () => view.key && view.key === identity();
  const guard = (key = view.key, version = sequence) => {
    if (!current() || key !== view.key || version !== sequence)
      throw new Error(
        "Your account or organization changed. Reopen Ballot Chaser.",
      );
  };
  const base = () =>
    `/api/contact-book/scopes/${id(`${context().scopeType}:${context().scopeId}`)}`;
  const path = (suffix) => `${base()}/ballot-chaser${suffix}`;
  const b = (action, text, value = "", secondary = false, disabled = false) =>
    button(`ballot-${action}`, text, {
      value,
      secondary,
      disabled: view.busy || disabled,
    });
  const can = (name) => view.schema?.capabilities?.[name] === true;
  const boundedElection = () =>
    view.election?.preparationPolicy?.version === "bounded_v1";
  const sentElectionEligible = () =>
    boundedElection() &&
    view.election.preparationPolicy.maxRows === 125000 &&
    view.election.storageMode === "register" &&
    view.election.state === "AZ" &&
    String(view.election.county || "")
      .trim()
      .toLowerCase() === "maricopa";
  const sentUpdatesAllowed = () =>
    sentElectionEligible() &&
    can("import") &&
    can("export") &&
    Boolean(view.dashboard?.snapshotId) &&
    Boolean(
      ballotSentPreparationPolicy(
        view.preparationAvailability?.sentUpdates,
        view.election?.preparationColumns,
      ),
    );
  const preparation = createBallotPreparation({
    request: (url, options) => {
      const prefix = path("");
      if (!url.startsWith(`${prefix}/`))
        throw new Error("Reopen this organization's Ballot Chaser.");
      return call(url.slice(prefix.length), options.body, options.method);
    },
    guard,
    changed,
    beforeIdExport: async () => !(await resumeUnfinishedUpload()),
    context: () => {
      const limits = ballotPreparationCapacity(
        view.preparationAvailability,
        view.election?.preparationPolicy,
      );
      return {
        base: path(""),
        electionId: view.electionId,
        snapshotId: view.dashboard?.snapshotId || null,
        mode:
          view.resumePreparedImport?.preparation?.mode || view.preparationMode,
        sourceAsOf: view.resumePreparedImport?.sourceAsOf,
        allowed:
          can("import") &&
          limits !== null &&
          boundedElection() &&
          view.election.preparationPolicy.enabled === true,
        limits,
        canExport: can("export"),
        sentUpdates: sentElectionEligible()
          ? view.preparationAvailability?.sentUpdates
          : undefined,
        preparationColumns: view.election?.preparationColumns,
        retainedRows: view.dashboard?.total,
        electionDate: view.election?.electionDate,
      };
    },
  });
  const exports = createBallotExport({
    request,
    guard,
    changed,
    explainError: ballotPreparationMessage,
  });
  const door = createBallotChaserCanvassing({
    request,
    context,
    guard,
    run,
    changed,
    busy: () => view.busy,
  });
  function reset() {
    sequence++;
    jobGeneration++;
    clearTimeout(timer);
    contacts?.dispose?.();
    contacts = null;
    door.reset();
    exports.reset();
    preparation.reset();
    view = {};
  }
  async function call(suffix, body, method) {
    const key = view.key,
      version = sequence;
    guard(key, version);
    let result;
    try {
      result = await request(path(suffix), {
        auth: true,
        beforeRequest: () => guard(key, version),
        ...(body === undefined ? {} : { method: method || "POST", body }),
      });
    } catch (error) {
      if (
        current() &&
        version === sequence &&
        [401, 403].includes(error.status || error.statusCode)
      ) {
        clearTimeout(timer);
        contacts?.dispose?.();
        contacts = null;
        door.reset();
        Object.assign(view, {
          elections: [],
          imports: [],
          electionId: null,
          dashboard: null,
          job: null,
          rows: null,
          configuration: null,
          showContacts: false,
          schema: { capabilities: {} },
        });
        preparation.reset();
      }
      throw error;
    }
    guard(key, version);
    if (result?.ok !== true)
      throw new Error("The ballot update response could not be verified.");
    return result;
  }
  async function load({ force = false } = {}) {
    const key = identity();
    if (!key) {
      reset();
      return;
    }
    if (current() && (view.loading || (view.loaded && !force))) return;
    const electionId = current() ? view.electionId : null;
    reset();
    view = {
      key,
      loading: true,
      elections: [],
      imports: [],
      electionId,
      uploadDraft: {},
      mappingDraft: {},
      questionDraft: [],
      chaseView: "outstanding",
      chaseViewDraft: "outstanding",
    };
    const version = sequence;
    changed();
    try {
      const schema = await request(`${base()}/schema`, {
        auth: true,
        beforeRequest: () => guard(key, version),
      });
      guard(key, version);
      view.schema = schema;
      if (!can("read"))
        throw new Error(
          "Your role cannot view this organization’s contact data.",
        );
      if (!can("ballotChaser"))
        throw new Error(
          "Ballot Chaser is not available for this organization yet.",
        );
      const result = await call("/elections");
      view.preparationAvailability = result.preparationAvailability;
      view.elections = list(result.items);
      view.electionCursor = result.nextCursor;
      view.electionId = view.elections.some(
        (item) => item.electionId === electionId,
      )
        ? electionId
        : view.elections[0]?.electionId;
      if (view.electionId) await selectElection(view.electionId);
      view.loaded = true;
    } catch (error) {
      if (current() && version === sequence) view.error = error.message;
    } finally {
      if (current() && version === sequence) {
        view.loading = false;
        changed();
      }
    }
  }
  async function selectElection(electionId) {
    preparation.reset();
    view.resumePreparedImport = null;
    view.preparationMode = null;
    view.uploadOperationId = null;
    exports.reset();
    clearTimeout(timer);
    contacts?.dispose?.();
    contacts = null;
    view.showContacts = false;
    view.job = null;
    view.configuration = null;
    view.electionId = electionId;
    view.election = (await call(`/elections/${id(electionId)}`)).election;
    await refreshElection();
  }
  async function refreshElection() {
    const electionId = view.electionId;
    const results = await Promise.all([
      call(`/elections/${id(electionId)}/dashboard`),
      can("import")
        ? call(`/imports?electionId=${id(electionId)}`)
        : Promise.resolve({ items: [] }),
    ]);
    if (view.dashboard?.snapshotId !== results[0].dashboard?.snapshotId)
      exports.reset();
    view.dashboard = results[0].dashboard;
    view.imports = list(results[1].items);
    view.importCursor = results[1].nextCursor;
    view.pendingUpload = view.imports.find(uploadUnfinished) || null;
  }
  const uploadUnfinished = (job) =>
    unfinishedBallotUpload(
      job,
      view.election?.preparationPolicy?.maxAgeMs || 86400000,
    );

  function revealReviewStep() {
    const key = view.key,
      version = sequence;
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() => {
      if (!current() || key !== view.key || version !== sequence) return;
      const step = document.querySelector?.("[data-ballot-review-step]");
      if (owned(step)) {
        step.scrollIntoView?.({ block: "start" });
        step.focus?.({ preventScroll: true });
      }
    });
  }

  async function openExistingUpload(job) {
    if (job.electionId && job.electionId !== view.electionId)
      await selectElection(job.electionId);
    const sameReview =
      view.job?.importId === job.importId &&
      view.job.status === "awaiting_mapping" &&
      job.status === "awaiting_mapping";
    preparation.reset();
    view.resumePreparedImport = null;
    view.preparationMode = null;
    view.showUpload = false;
    view.uploadOperationId = null;
    view.showContacts = false;
    view.showDoor = false;
    view.configuration = null;
    view.rows = null;
    view.editingMapping = false;
    if (!sameReview) view.mappingDraft = {};
    trackJob(job);
    if (job.status === "awaiting_mapping") revealReviewStep();
  }

  /** Read scope-wide pages before admitting costly work; never restart the saved job. */
  async function resumeUnfinishedUpload() {
    if (!boundedElection() || !can("import")) return false;
    const resumeId = view.resumePreparedImport?.importId;
    const canResumeSource = (job) =>
      job.importId === resumeId && job.status === "uploading";
    let cursor;
    const seen = new Set();
    for (let page = 0; page < 20; page++) {
      const result = await call(
        `/imports${cursor ? `?cursor=${id(cursor)}` : ""}`,
      );
      for (const summary of list(result.items)) {
        view.imports = list(view.imports).map((saved) =>
          saved.importId === summary.importId
            ? { ...saved, ...summary }
            : saved,
        );
        if (!uploadUnfinished(summary)) continue;
        const job = (await call(`/imports/${id(summary.importId)}`)).import;
        if (!uploadUnfinished(job) || canResumeSource(job)) continue;
        await openExistingUpload(job);
        return true;
      }
      cursor = result.nextCursor;
      if (!cursor) {
        view.pendingUpload = null;
        return false;
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
    }
    throw new Error(
      "The upload history could not be fully checked. Refresh Ballot Chaser before starting another file.",
    );
  }
  async function refreshPreparationAccess() {
    const electionId = view.electionId,
      key = view.key,
      version = sequence;
    const schema = await request(`${base()}/schema`, {
      auth: true,
      beforeRequest: () => guard(key, version),
    });
    guard(key, version);
    view.schema = schema;
    const availability = await call("/elections");
    view.preparationAvailability = availability.preparationAvailability;
    const currentElection = await call(`/elections/${id(electionId)}`);
    view.election = currentElection.election;
    if (
      !can("import") ||
      view.preparationAvailability?.enabled !== true ||
      !boundedElection() ||
      view.election.preparationPolicy.enabled !== true
    ) {
      preparation.reset();
      throw new Error(
        "County-file preparation is not enabled for your current organization access.",
      );
    }
    view.dashboard = (
      await call(`/elections/${id(electionId)}/dashboard`)
    ).dashboard;
  }
  async function run(action) {
    if (!current() || view.busy || view.loading) return;
    const key = view.key,
      version = sequence;
    view.busy = true;
    view.error = "";
    view.message = "";
    changed();
    try {
      await action();
    } catch (error) {
      if (
        current() &&
        version === sequence &&
        boundedElection() &&
        (error?.payload?.error || error?.code) ===
          "ballot_preparation_job_active"
      ) {
        try {
          if (await resumeUnfinishedUpload()) return;
        } catch (recoveryError) {
          if (current() && version === sequence)
            view.error =
              ballotPreparationMessage(recoveryError) || recoveryError.message;
          return;
        }
      }
      if (
        current() &&
        version === sequence &&
        (error?.payload?.error || error?.code) ===
          "ballot_preparation_work_limit" &&
        view.job &&
        !closed(view.job) &&
        boundedElection()
      ) {
        view.job = {
          ...view.job,
          boundedHeld: true,
          status: "needs_review",
          reason: "ballot_preparation_work_limit",
        };
        view.editingMapping = false;
        view.mappingDraft = {};
      }
      if (current() && version === sequence)
        view.error = [
          "ballot_upload_file_changed",
          "ballot_upload_checksum_required",
        ].includes(error?.payload?.error || error?.code)
          ? "Reselect the original unchanged file, or start a new import for a different file."
          : ballotPreparationMessage(error) ||
            error.message ||
            "This update paused. Refresh and resume.";
    } finally {
      if (current() && version === sequence && key === view.key) {
        view.busy = false;
        changed();
      }
    }
  }
  function trackJob(job) {
    const needsFocus =
      job?.status === "awaiting_mapping" &&
      (view.job?.importId !== job.importId ||
        view.job.status !== "awaiting_mapping");
    view.job = job;
    view.imports = list(view.imports).map((saved) =>
      saved.importId === job?.importId ? { ...saved, ...job } : saved,
    );
    if (uploadUnfinished(job)) view.pendingUpload = job;
    else if (view.pendingUpload?.importId === job?.importId)
      view.pendingUpload = null;
    if (needsFocus) revealReviewStep();
    const generation = ++jobGeneration;
    clearTimeout(timer);
    if (stages.has(job?.status)) {
      const key = view.key,
        version = sequence;
      timer = setTimeout(() => {
        if (current() && key === view.key && version === sequence) {
          if (view.busy) {
            trackJob(view.job);
            return;
          }
          void (async () => {
            const result = await call(`/imports/${id(job.importId)}`);
            if (generation !== jobGeneration || view.editingMapping) return;
            trackJob(result.import);
            if (view.job.status === "complete") {
              await refreshElection();
              view.message =
                "Ballot update complete. Your new results are ready.";
            }
            changed();
          })().catch((error) => {
            if (
              current() &&
              generation === jobGeneration &&
              !view.editingMapping
            ) {
              view.error = ballotPreparationMessage(error) || error.message;
              changed();
            }
          });
        }
      }, 5000);
    }
  }
  async function showContacts() {
    const chase = ballotChaseContext(
      view.electionId,
      view.dashboard?.snapshotId,
      view.chaseView || "outstanding",
      view.dashboard,
    );
    const key = view.key,
      version = sequence;
    contacts?.dispose?.();
    if (view.election?.storageMode === "register") {
      const campaignRole = () =>
        context().scopeType === "coalition" &&
        chase.view === "outstanding" &&
        ["read", "select", "export", "personal", "campaign"].every(can);
      const scopeKey = `${context().scopeType}:${context().scopeId}`;
      let campaignAccess = false;
      if (campaignRole() && beginContactCampaign)
        campaignAccess = await readBallotTextingAccess({
          request,
          scopeKey,
          guard: () => guard(key, version),
        });
      guard(key, version);
      contacts = createBallotRegister({
        request,
        guard: () => guard(key, version),
        base: `${base()}/ballot-chaser`,
        electionId: view.electionId,
        snapshotId: chase.snapshotId,
        chaseView: chase.view,
        dates: view.dashboard,
        schema: view.schema,
        busy: () => view.busy,
        changed: () => {
          guard(key, version);
          changed();
        },
        canCampaign: () => campaignAccess && campaignRole(),
        beginCampaign: async (selection) => {
          guard(key, version);
          if (
            !campaignRole() ||
            !(await readBallotTextingAccess({
              request,
              scopeKey,
              guard: () => guard(key, version),
            }))
          )
            throw new Error(
              "Texting campaign access changed. Reopen Ballot Chaser.",
            );
          guard(key, version);
          beginContactCampaign({
            scopeKey,
            actorUserId: context().userId,
            selection,
          });
        },
        invalidateExport: () => exports.reset(),
        beginExport: (spec) => {
          guard(key, version);
          return exports.start(`${base()}/ballot-chaser`, {
            ...spec,
            operationId: uuid(),
          });
        },
      });
      view.showContacts = true;
      await contacts.load();
      return;
    }
    contacts = createOrganizationContactBook(
      {
        contactApi: createOrganizationContactsApi({
          request,
          scopeKey: `${context().scopeType}:${context().scopeId}`,
          guard: () => guard(key, version),
        }),
        guard: () => guard(key, version),
        view: () => view,
        context,
        beginBallotExport: (spec) => {
          guard(key, version);
          return exports.start(`${base()}/ballot-chaser`, {
            ...spec,
            operationId: uuid(),
          });
        },
        busy: () => view.busy,
        changed: () => {
          guard(key, version);
          changed();
        },
        toast: (message) => {
          guard(key, version);
          view.message = message;
        },
        fail: (error) => {
          guard(key, version);
          view.error = error.message;
        },
        cities: (state, options) => loadContactCities(state, request, options),
        beginContactCampaign: (selection) => {
          guard(key, version);
          beginContactCampaign({
            scopeKey: `${context().scopeType}:${context().scopeId}`,
            actorUserId: context().userId,
            selection,
          });
        },
        get beginBallotTerritories() {
          if (
            !canBuildTerritories() ||
            context().scopeType !== "coalition" ||
            chase.view !== "outstanding"
          )
            return undefined;
          return async (selection) => {
            guard(key, version);
            if (!canBuildTerritories() || chase.view !== "outstanding")
              throw new Error("This tool is unavailable.");
            beginTerritories({
              scopeKey: `${context().scopeType}:${context().scopeId}`,
              actorUserId: context().userId,
              contactSelectionId: selection.selectionId,
              ballotChase: chase,
            });
          };
        },
        openBallotChaser: () => {
          view.showContacts = false;
          changed();
        },
      },
      { ballotChase: chase },
    );
    view.contactBook = null;
    view.showContacts = true;
    await contacts.load();
  }
  function electionForm() {
    const capacity = ballotPreparationPolicyLimits(
      view.preparationAvailability,
    );
    return `<form class="pt-card" data-ballot-form="election"><h2>Add an election</h2><div class="pt-fields">${field("name", "Election name", "", { required: true, extra: 'placeholder="Arizona general election"' })}${field("electionDate", "Election date", "", { type: "date", required: true })}${field("county", "County", "Pinal", { required: true })}${select("state", "State", contactStateOptions, "AZ", true)}${field("sourceNamespace", "County voter file source", "", { extra: 'placeholder="Pinal County voter records"' })}${select(
      "sourceUse",
      "Permitted use of this voter file",
      sourceUseOptions,
      "unreviewed",
    )}</div>${capacity ? `<p>New elections prepare county files on this device, then match daily returns to one fixed voter cohort within ${count(capacity.maxRows)} voters and ${count(capacity.maxOutputBytes / 1000000)} MB. Review exact county columns and all intended party codes before preparing a file.</p>` : ""}<p>Confirm the source’s permitted use before applying the first report. Text Banking still checks sender consent, documented opt-in when required, and opt-outs.</p><p>Each election keeps its own ballot history. County voters are available without adding everyone to Contact Book.</p><button type="submit" class="pt-btn"${view.busy ? " disabled" : ""}>Add election</button></form>`;
  }
  const sourcePolicyLocked = () =>
    Boolean(
      view.election?.activeSnapshotId ||
        view.election?.pendingSnapshotId ||
        view.dashboard?.snapshotId ||
        view.job?.status === "applying",
    );
  function sourcePolicyPanel() {
    const purpose =
      view.election?.sourcePolicy?.permittedPurpose || "unreviewed";
    const title =
      sourceUseOptions.find(([value]) => value === purpose)?.[1] ||
      "Needs review";
    if (!can("import")) return "";
    if (sourcePolicyLocked())
      return `<p class="bc-impact-note"><strong>Source use:</strong> ${e(title)}. Source-use review is locked while a report publishes and after the first completed report.</p>`;
    return `<form class="pt-card" data-ballot-form="source-policy"><h2>Review permitted source use</h2>${select("sourceUse", "Permitted use of this voter file", sourceUseOptions, purpose)}<p>Confirm permitted use before applying the first report. Sender consent, documented opt-in when required, and opt-outs stay protected. This choice locks once publication starts.</p><button type="submit" class="pt-btn pt-btn--secondary"${view.busy ? " disabled" : ""}>Save source-use review</button></form>`;
  }
  function countyUploadChoices() {
    if (!sentUpdatesAllowed()) return "";
    return `<section aria-label="County file uploads"><h3>Choose a county file</h3><p>Have both files? Add sent ballots first, then match returned ballots.</p><div class="pt-fields"><article class="pt-card"><h4>Sent ballots — EV32</h4><p>Add new CD8 IND/PND voters from a county sent-ballot file. County code <strong>S</strong> means sent.</p>${b("sent-open", "Upload sent-ballot file")}</article><article class="pt-card"><h4>Returned ballots — EV33</h4><p>Match received ballots to voters already on this list. County code <strong>R</strong> means received; <strong>X</strong> means voided.</p>${b("upload-open", "Upload returned-ballot file")}</article></div></section>`;
  }
  function pendingUploadNotice() {
    const job = view.pendingUpload;
    if (!boundedElection() || !can("import") || !uploadUnfinished(job))
      return "";
    const waiting = job.status === "awaiting_mapping";
    const ready =
      job.status === "review_ready" && !Number(job.counts?.conflicts);
    const title = waiting
      ? "Your uploaded file is waiting for column review"
      : ready
        ? "Your county update is ready to apply"
        : stages.has(job.status)
          ? "Your county-file update is processing"
          : "Your county-file upload needs attention";
    const next = waiting
      ? "Continue with the file already uploaded. Review its columns; do not upload it again."
      : ready
        ? "Review the results, then choose Apply reviewed county update."
        : "Open the existing update to see its current status and next action.";
    const open =
      view.job?.importId === job.importId &&
      !view.configuration &&
      !view.showDoor &&
      !view.showContacts;
    return `<section class="pt-card" role="status"><h2>${e(title)}</h2><p>${e(next)}</p>${open ? "" : b("job", waiting ? "Resume review" : ready ? "Review update" : "Open existing update", job.importId)}</section>`;
  }
  function dashboard() {
    const d = view.dashboard || {};
    const stat = (title, value, detail = "") =>
      `<article class="pt-card bc-stat"><strong>${count(value)}</strong><h3>${e(title)}</h3>${detail ? `<p>${e(detail)}</p>` : ""}</article>`;
    const ratio =
      Number.isSafeInteger(d.total) &&
      d.total > 0 &&
      Number.isSafeInteger(d.returned)
        ? Math.max(0, Math.min(100, Math.round((d.returned / d.total) * 100)))
        : null;
    return `<section class="bc-dashboard" aria-label="Ballot progress"><div class="bc-progress-card pt-card"><div><span class="pt-eyebrow">EVERY BALLOT COUNTS</span><h2>${ratio == null ? "Your first update starts here" : `${ratio}% returned`}</h2><p>${d.sourceAsOf ? `County report as of ${e(reportDate(d.sourceAsOf))}` : "Upload the original base file, then add each new county report."}</p>${d.previousSourceAsOf ? `<small>Compared with ${e(reportDate(d.previousSourceAsOf))}</small>` : ""}</div>${ratio == null ? "" : `<progress aria-label="Ballots returned" value="${ratio}" max="100">${ratio}%</progress>`}</div><div class="bc-stats">${stat("Still to return", d.outstanding)}${stat("Accepted", d.accepted ?? d.statusCounts?.accepted)}${stat("Needs follow-up", d.needsFollowup ?? (["unknown", "cure_required", "rejected"].every((key) => Number.isSafeInteger(d.statusCounts?.[key])) ? ["unknown", "cure_required", "rejected"].reduce((sum, key) => sum + d.statusCounts[key], 0) : undefined))}${stat("Returned since last update", d.newlyReturned)}${stat("Returned after org outreach", d.outreachThenReturned, "Associated with recorded outreach; this does not prove outreach caused the return.")}${stat("Total ballots returned", d.returned)}</div>${d.snapshotId ? `<details class="pt-workspace-details"><summary>About these results</summary><p class="bc-impact-note"><strong>Newly found already returned:</strong> ${count(d.newlyDiscoveredReturned)}. These people were not previously recorded as awaiting a return.</p><p class="bc-impact-note">${count(d.textOutreachThenReturned)} after a sent text · ${count(d.doorOutreachThenReturned)} after a conversation or literature drop. People reached in both channels count once in the combined total.</p><p class="bc-impact-note">A confirmed conversation or literature drop credits all selected voters at the exact household or unit; it does not confirm an individual conversation with each voter.</p><p class="bc-impact-note">When no exact return time is supplied, outreach is compared with the first report showing a return.</p><p class="bc-impact-note">Returned means physically reported returned. Accepted is a separate county decision; cure, rejected and unknown cases need follow-up.</p></details>` : ""}<div class="pt-actions">${b("contacts", (view.chaseView || "outstanding") === "outstanding" ? "Show ballots not returned" : "Open ballot list", "", false, !d.snapshotId)}${can("import") && !sentUpdatesAllowed() ? b("upload-open", d.snapshotId ? (boundedElection() ? "Upload returned-ballot file" : "Upload next county report") : "Upload base file", "", true) : ""}${can("manage") ? b("questions", "Ballot chasing questions", "", true) : ""}${b("refresh", "Refresh results", "", true)}</div>${countyUploadChoices()}${listPicker()}</section>`;
  }
  function listPicker() {
    return `<form class="bc-election-picker" data-ballot-form="contacts-view">${select("chaseView", "Ballot list", Object.entries(ballotViews), view.chaseViewDraft || view.chaseView || "outstanding")}<button type="submit" class="pt-btn"${view.busy ? " disabled" : ""}>Open list</button></form>`;
  }
  function exportPanel() {
    const s = exports.view();
    if (!s.job && !s.error) return "";
    return `<section class="pt-card" aria-label="Ballot export"><h3>${s.stale ? "Refresh this list" : s.job?.status === "ready" ? "CSV ready" : s.job?.status === "needs_review" ? "Export needs review" : "Preparing your CSV"}</h3>${s.job ? `<p>${count(s.job.rows)} rows</p>` : ""}${s.job?.status === "building" ? `<progress aria-label="Preparing CSV"></progress>` : ""}${s.error ? `<p role="status">${e(s.error)}</p>` : ""}${s.job?.status === "ready" ? b("export-download", "Download CSV") : ""}${s.job ? b("export-refresh", "Check progress", "", true) : ""}${s.stale ? b("refresh-list", "Refresh ballot list") : ""}</section>`;
  }
  function uploadForm() {
    if (boundedElection()) return preparation.render(view.busy);
    if (view.preparationAvailability?.enabled === true)
      return notice(
        "Start a prepared-file election",
        "This earlier election keeps its published results. Add a new election to prepare a fixed voter cohort and match daily returns here.",
      );
    const draft = view.uploadDraft;
    return `<form class="pt-card" data-ballot-form="upload"><h2>${view.dashboard?.snapshotId ? "Add a county report" : "Start with the base file"}</h2><div class="pt-fields"><label class="pt-field"><span>County spreadsheet</span><input name="file" type="file" accept=".csv,.tsv,.xlsx" data-ballot-field="file" required></label>${field("sourceAsOf", "Report date and time", draft.sourceAsOf || "", { type: "datetime-local", required: true })}${select(
      "kind",
      "Report kind",
      [
        ["base", "Original base file"],
        ["snapshot", "Later snapshot"],
      ],
      draft.kind || (view.dashboard?.snapshotId ? "snapshot" : "base"),
    )}${select(
      "fileMode",
      "Contents",
      [
        ["full", "Full county snapshot"],
        ["delta", "Only records changed since the last report"],
      ],
      draft.fileMode || "full",
    )}</div><p>All original columns are retained. Missing rows never mean a ballot was returned. Uploading does not send messages or publish territories.</p><button type="submit" class="pt-btn"${!can("import") || view.busy ? " disabled" : ""}>Upload and review columns</button></form>`;
  }
  function mappingForm() {
    const job = view.job,
      headers = columns(job),
      draft = view.mappingDraft;
    const profile =
      draft.profile || job.profile || view.election?.profile || {};
    const mappingChoices = (header) => {
      const fields = list(view.schema?.fields).filter(
          (f) => !f.readOnly && !f.archived,
        ),
        saved = profile.fieldMapping?.[header];
      return [
        ["", "Keep in report only"],
        [ballotAddCountyField, "Add county field"],
        ...fields.map((f) => [f.fieldId, f.label]),
        ...(saved &&
        saved !== ballotAddCountyField &&
        !fields.some((f) => f.fieldId === saved)
          ? [
              [
                saved,
                list(view.schema?.fields).find((f) => f.fieldId === saved)
                  ?.label || "Saved contact field",
              ],
            ]
          : []),
      ];
    };
    const choices = [
      ["", "Not included"],
      ...headers.map((header) => [header, header]),
    ];
    if (boundedElection()) {
      const meaning =
        job.preparation?.mode === "sent"
          ? "issued"
          : job.preparation?.mode === "returns" || job.kind === "snapshot"
            ? "returned"
            : "issued";
      const voterIdColumn =
        job.preparation?.mode === "sent"
          ? "VOTERID"
          : meaning === "returned"
            ? "Voter ID"
            : profile.voterIdColumn || "";
      return `<form class="pt-card" data-ballot-form="mapping" data-ballot-review-step tabindex="-1"><h2>Review prepared county report</h2><p>Next: confirm the official voter ID column, then choose <strong>Review this report</strong>. Applying the update is a separate confirmation.</p>${select("voterIdColumn", "Official voter ID column", choices, voterIdColumn, true)}<input type="hidden" name="rowStatusMeans" value="${meaning}"><div class="pt-actions"><button class="pt-btn" type="submit"${view.busy ? " disabled" : ""}>Review this report</button></div><p>${count(headers.length)} county columns are retained in the report. This workflow does not create Contact Book people.</p><p>Every selected row means <strong>${meaning === "returned" ? "Returned" : "Issued"}</strong>. ${job.preparation?.mode === "sent" ? "Only new voters are added; existing voters and prior returns remain unchanged." : "Missing voters keep their earlier status."} Review the official report date and the complete-file results before applying.</p></form>`;
    }
    const sampleRows = list(job.sampleRows);
    const rawStatuses = [
      ...new Set(
        sampleRows
          .map((row) =>
            Array.isArray(row)
              ? row[headers.indexOf(profile.statusColumn)]
              : row[profile.statusColumn],
          )
          .filter((value) => value != null)
          .map(String),
      ),
    ];
    return `<form class="pt-card" data-ballot-form="mapping"><h2>Review columns and ballot status</h2>${
      list(job.sheets).length > 1
        ? select(
            "sheetName",
            "Worksheet",
            job.sheets.map((sheet) => [sheet.name, sheet.name]),
            job.sheetName || job.sheets[0].name,
          ) + b("sheet", "Preview this worksheet", "", true)
        : ""
    }<div class="pt-fields">${select("voterIdColumn", "County voter ID", choices, profile.voterIdColumn || "", true)}${select("statusColumn", "Ballot status column", choices, profile.statusColumn || "")}${select("returnedDateColumn", "Returned date column", choices, profile.returnedDateColumn || "")}${select("requestedColumn", "Requested column", choices, profile.requestedColumn || "")}${select("issuedColumn", "Issued column", choices, profile.issuedColumn || "")}${select("rowStatusMeans", "Every row in this file means", [["", "Use mapped columns"], ...ballotStatuses.map((status) => [status, label(status)])], profile.rowStatusMeans || "")}${select(
      "blankStatusMeans",
      "Blank ballot status",
      [
        ["", "Unknown; retain for review"],
        [
          "issued",
          "Issued, not yet returned (only when county format confirms this)",
        ],
      ],
      profile.blankStatusMeans || "",
    )}${field("voterIdPaddingWidth", "County-confirmed voter ID width (optional)", profile.voterIdPaddingWidth || "", { type: "number", extra: 'min="1" max="32" step="1"' })}</div><p class="pt-muted">For a request-only or return-only file, explicitly choose what every row means. Mapped status, return date, requested or issued values take precedence; unknown nonempty statuses still need review. Missing voters never imply a return.</p><p class="pt-muted">If Excel stored IDs as numbers, confirm their fixed width with the county before using padding. Uncertain IDs are held for review.</p><h3>County status meanings</h3><p>Map the county’s original values to ballot states. Unknown values are held for review. This sample does not cover the entire file.</p>${textarea(
      "statusMap",
      "Status meanings (one original value = ballot state per line)",
      draft.statusText ??
        Object.entries(profile.statusMap || {})
          .map(([raw, status]) => `${raw} = ${status}`)
          .join("\n"),
      false,
      16000,
    )}<p class="pt-muted">Ballot states: ${ballotStatuses.map(e).join(", ")}.${rawStatuses.length ? ` Sample values: ${rawStatuses.map(e).join(", ")}` : ""}</p><details class="pt-workspace-details" data-ballot-mapping-details${view.mappingDetailsOpen ? " open" : ""}><summary>Map contact information</summary><p>Match contact information, add a county field, or keep a column in the report only. Original data is always retained.</p><div class="pt-fields">${headers
      .map((header, index) =>
        select(
          `field_${index}`,
          header,
          mappingChoices(header),
          profile.fieldMapping?.[header] || "",
        ),
      )
      .join(
        "",
      )}</div><label class="pt-field"><span>Clear imported values when this column is blank</span><select name="clearBlankColumns" multiple size="${Math.min(6, Math.max(2, headers.length))}">${headers
      .filter((header) => profile.fieldMapping?.[header])
      .map(
        (header) =>
          `<option value="${e(header)}"${list(profile.clearBlankColumns).includes(header) ? " selected" : ""}>${e(header)}</option>`,
      )
      .join(
        "",
      )}</select></label><p>Leave this selection empty to preserve existing values. Select a column only when a blank should clear that source’s imported value. Volunteer corrections, manual edits, and opt-outs remain protected.</p></details><details class="pt-workspace-details"><summary>Sample values</summary><div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr>${headers.map((header) => `<th>${e(header)}</th>`).join("")}</tr></thead><tbody>${sampleRows.map((row) => `<tr>${headers.map((header, index) => `<td>${e(Array.isArray(row) ? row[index] : row[header])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details><p>Blank contact cells preserve the existing value unless explicitly selected above. A county report never resets an opt-out or volunteer notes.</p><button type="submit" class="pt-btn"${view.busy ? " disabled" : ""}>Review full update</button></form>`;
  }
  function identityReview(row) {
    if (row.error !== "ballot_legacy_identity_review") return "";
    const options = list(row.candidates)
      .map(
        (candidate, index) =>
          `<option value="${index}"${candidate.canLink === false ? " disabled" : ""}>${e(candidate.label || "Existing person")}${candidate.detail ? ` · ${e(candidate.detail)}` : ""}${candidate.canLink === false ? " · Already linked to a different voter record" : ""}</option>`,
      )
      .join("");
    return `<form data-ballot-form="identity-review"><input type="hidden" name="row" value="${e(row.row)}"><p>This voter may already be in your contact book. Choose the person to update, or keep a separate person after reviewing the match.</p><label class="pt-field"><span>Existing contact for record ${e(row.row)}</span><select name="candidate"><option value="">Choose after reviewing</option>${options}<option value="create_new">Keep as a separate person</option></select></label><button type="submit" class="pt-btn pt-btn--secondary"${view.busy ? " disabled" : ""}>Resolve contact identity</button></form>`;
  }
  function recordOutcome(row) {
    return `<article class="bc-outcome"><strong>Record ${e(row.row)}</strong><span>${e(label(row.status))}</span>${row.error ? `<p>${e(label(row.error))}</p>` : ""}${row.status === "review_required" && can("import") && !view.job?.boundedHeld ? identityReview(row) + b("exclude", "Exclude this record", String(row.row), true) : ""}</article>`;
  }
  function importPanel() {
    const job = view.job;
    if (!job) return view.showUpload ? uploadForm() : "";
    const c = job.counts || {},
      controls = ballotImportControls(job, view.editingMapping);
    const phase = boundedElection()
      ? ballotImportPhase(job)
      : ballotImportStatus(job.status);
    const detail = ballotImportStatus(job.status);
    const importError = job.boundedHeld
      ? ballotPreparationMessage(job.reason || job.error) ||
        "This saved update is paused. Keep the upload in place for Polis support to review. The last published list remains available."
      : ballotPreparationMessage(job.error) ||
        (boundedElection() && job.error
          ? "This county report needs an organization administrator's review. The last published list remains available."
          : job.error);
    return `${controls.mapping ? mappingForm() : ""}<section class="pt-card"><h2>${e(job.fileName || "County report")}</h2><p role="status">${e(phase)}${phase !== detail ? ` · ${e(detail)}` : ""}${job.sourceAsOf ? ` · ${e(reportDate(job.sourceAsOf))}` : ""}</p>${job.status === "awaiting_mapping" ? "<p>Upload received. Review its columns before records are counted.</p>" : `<p>${count(c.rows)} records · ${count(view.election?.storageMode === "register" ? (c.newVoters ?? c.newContacts) : c.newContacts)} ${view.election?.storageMode === "register" ? (job.status === "complete" ? "records added" : "new records staged") : "new people"} · ${count(view.election?.storageMode === "register" ? (c.updatedVoters ?? c.updatedContacts) : c.updatedContacts)} ${view.election?.storageMode === "register" && job.status !== "complete" ? "updates staged" : "updated"} · ${count(c.unchanged)} unchanged · ${count(c.duplicateRows)} repeated records · ${count(c.conflicts)} need review</p>`}${view.election?.storageMode === "register" && !["awaiting_mapping", "uploading", "complete"].includes(job.status) ? '<p class="pt-muted">These are staged results. The published list changes only after this update completes.</p>' : ""}${job.processingPhase && stages.has(job.status) && !job.boundedHeld ? `<p role="status">${e({ preparing_previous: "Preparing your previous list", partitioning: "Reading your file", comparing: "Comparing county updates", applying: "Publishing results" }[job.processingPhase] || "Processing your file")}${Number.isSafeInteger(job.totalRows) ? ` · ${count(job[{ partitioning: "partitionedRows", comparing: "stagedRows", applying: "appliedRows", preparing_previous: "preparedPreviousRows" }[job.processingPhase]])} of ${count(job.totalRows)} rows` : ""}</p>` : ""}${importError ? notice(job.boundedHeld ? (job.reason === "ballot_preparation_work_limit" ? "Processing safety limit reached" : "Update processing paused") : "Update needs attention", importError) : ""}<div class="pt-actions">${controls.advance && job.status !== "review_ready" ? b("advance", "Continue / retry update", "", true, !can("import")) : ""}${b("job-refresh", "Check progress", "", true, view.editingMapping)}${b("rows", "Review record outcomes", "", true)}${controls.apply ? b("apply", "Apply reviewed county update", "", false, !can("import") || Number(c.conflicts) > 0) : ""}${controls.remap && can("import") ? b("mapping-edit", "Edit mapping", "", true) : ""}${view.editingMapping && !job.boundedHeld ? b("mapping-cancel", "Cancel mapping changes", "", true) : ""}${b("job-close", "Back to dashboard", "", true)}${job.status === "uploading" && boundedElection() ? b("prepare-resume", "Prepare the original county file to resume", "", true) : ""}</div>${job.status === "uploading" && !boundedElection() ? `<form data-ballot-form="resume"><label class="pt-field"><span>Original spreadsheet</span><input name="file" type="file" accept=".csv,.tsv,.xlsx" required></label><button class="pt-btn" type="submit"${view.busy ? " disabled" : ""}>Resume upload</button></form>` : ""}${job.status === "review_ready" ? "<p>The full report has been staged. Review its outcomes before applying. The previous completed report stays active until publication finishes.</p>" : ""}</section>${view.rows ? `<section class="pt-card"><h3>Record outcomes</h3>${view.rows.length ? view.rows.map(recordOutcome).join("") : view.rowCursor ? "<p>No row conflicts on this page. Continue to the next page.</p>" : view.election?.storageMode === "register" ? `<p>No row conflicts recorded.</p><p class="pt-muted">This report lists rows requiring review, not processing failures.${job.boundedHeld ? " This update remains paused; see the processing message above. Keep the existing upload for recovery." : ""}</p>` : "<p>No record outcomes to display.</p>"}${view.rowCursor ? b("rows-more", "More record outcomes", "", true) : ""}</section>` : ""}`;
  }
  function history() {
    return `<section class="pt-card"><h2>Update history</h2>${view.imports.length ? view.imports.map((job) => `<article class="bc-history"><div><strong>${e(job.fileName || "County report")}</strong><p>${e(reportDate(job.sourceAsOf || ""))} · ${e(boundedElection() ? ballotImportPhase(job) : ballotImportStatus(job.status))}</p></div>${b("job", job.boundedHeld ? "View held update" : closed(job) ? "View outcomes" : "Review / resume", job.importId, true)}</article>`).join("") : "<p>Your reports will appear here.</p>"}${view.importCursor ? b("imports-more", "More updates", "", true) : ""}</section>`;
  }
  async function loadConfiguration(roundId = "") {
    const key = view.key,
      version = sequence;
    const result = await request(
      `/api/voter-map/canvassing/configuration?coalitionId=${id(context().scopeId)}${roundId ? `&roundId=${id(roundId)}` : ""}`,
      { auth: true, beforeRequest: () => guard(key, version) },
    );
    guard(key, version);
    view.configuration = result.configuration;
    view.roundId = roundId;
    view.questionDraft = structuredClone(
      result.configuration.effective.questions || [],
    );
    view.questionsDirty = false;
  }
  function questionsPanel() {
    const config = view.configuration;
    if (!config) return "";
    return `<form class="pt-card" data-ballot-form="questions"><h2>Ballot chasing questions</h2>${select("roundId", "Canvassing round", [["", "Organization defaults"], ...list(config.availableRounds).map((round) => [round.roundId, round.label])], view.roundId)}${b("round", "Open selected round", "", true)}<p>Choose a round to customize its questions. Official ballot status always comes from county reports; conversation answers remain dated self-reports.</p>${view.roundId && config.inherited?.questions ? notice("Using organization defaults", "Adding the preset creates a copy for this round and preserves existing questions.") : ""}${b("preset", "Add ballot chasing preset", "", true, !view.roundId)}${view.questionDraft
      .map(
        (question, index) =>
          `<fieldset class="bc-question"><legend>Question ${index + 1}</legend>${field(`prompt_${index}`, "Question", question.prompt, { required: true, max: 240 })}${select(
            `type_${index}`,
            "Answer type",
            [
              ["single", "Single choice"],
              ["multi", "Multiple choices"],
              ["text", "Written answer"],
              ...(question.type === "support"
                ? [["support", "Support question"]]
                : []),
            ],
            question.type,
          )}${question.type !== "text" ? textarea(`choices_${index}`, "Answer choices (one per line)", list(question.choices).join("\n"), true, 4000) : ""}<label class="pt-workspace-check"><input type="checkbox" name="required_${index}"${question.required ? " checked" : ""}>Required during a conversation</label><div class="pt-actions">${b("question-up", "Move up", String(index), true, index === 0)}${b("question-down", "Move down", String(index), true, index === view.questionDraft.length - 1)}${b("question-remove", "Remove question", String(index), true)}</div></fieldset>`,
      )
      .join(
        "",
      )}<div class="pt-actions">${b("question-add", "Add question", "", true, view.questionDraft.length >= 40)}<button type="submit" class="pt-btn"${view.busy ? " disabled" : ""}>Save round questions</button>${b("questions-close", "Back to dashboard", "", true)}</div></form>`;
  }
  function electionWorkspace() {
    if (!view.electionId) return "";
    const prioritize =
      boundedElection() && !view.showDoor && !view.configuration;
    return (
      pendingUploadNotice() +
      (prioritize ? importPanel() : "") +
      dashboard() +
      sourcePolicyPanel() +
      ((view.chaseView || "outstanding") === "outstanding"
        ? b("door", "Record DoorKnocker outreach", "", true)
        : "") +
      (view.showDoor
        ? door.render()
        : view.configuration
          ? questionsPanel()
          : prioritize
            ? ""
            : importPanel()) +
      (can("import") ? history() : "")
    );
  }
  function render() {
    if (!current()) return "";
    const navigation = `<nav class="bc-nav" aria-label="Organization work"><a href="/workspace/${id(context().scopeType)}/${id(context().scopeId)}/people/contacts">Contact book</a><span aria-current="page">Ballot Chaser</span></nav>`;
    const body = view.loading
      ? notice("Loading Ballot Chaser")
      : view.showContacts
        ? `${b("contacts-close", "Back to ballot progress", "", true)}${listPicker()}${exportPanel()}${contacts?.render() || ""}`
        : `${head("ORGANIZATION · WORK", "Ballot Chaser", "Track county ballot returns.")}${
            view.elections.length
              ? `<form class="bc-election-picker" data-ballot-form="choose-election">${select(
                  "electionId",
                  "Election",
                  view.elections.map((item) => [
                    item.electionId,
                    `${item.name} · ${item.county || ""}`,
                  ]),
                  view.electionId,
                )}<button class="pt-btn pt-btn--secondary" type="submit"${view.busy ? " disabled" : ""}>Open election</button>${view.electionCursor ? b("elections-more", "More elections", "", true) : ""}${can("import") ? b("election-new", "Add election", "", true) : ""}</form>`
              : ""
          }${view.showElection || !view.elections.length ? (can("import") ? electionForm() : notice("No ballot elections yet", "An organization contact manager can add the county file.")) : ""}${electionWorkspace()}`;
    return `<section class="texting-workspace pt-workspace ballot-chaser" data-ballot-key="${e(view.key)}" aria-busy="${view.busy ? "true" : "false"}">${navigation}${view.error ? notice("Needs attention", view.error) : ""}${view.message ? notice(view.message) : ""}${view.uploadProgress ? `<section class="pt-card" aria-label="File upload"><progress aria-label="Upload progress" ${view.checkingFile ? "" : `value="${view.uploadProgress.loaded}" max="${view.uploadProgress.total}"`}></progress><p>${view.checkingFile ? "Checking file" : `${(view.uploadProgress.loaded / 1048576).toFixed(1)} of ${(view.uploadProgress.total / 1048576).toFixed(1)} MB uploaded`}</p></section>` : ""}${body}</section>`;
  }
  async function action(name, value) {
    if (!name.startsWith("ballot-")) {
      await contacts?.action?.(name, value);
      return;
    }
    const operation = name.slice(7);
    if (
      view.job?.boundedHeld &&
      ["advance", "apply", "mapping-edit", "sheet", "exclude"].includes(
        operation,
      )
    )
      throw new Error(
        ballotPreparationMessage("ballot_preparation_work_limit"),
      );
    if (operation === "export-refresh") await exports.refresh();
    else if (operation === "export-download") {
      const url = await exports.download();
      if (url) {
        const link = document.createElement("a");
        link.href = url;
        link.download = "ballot-contacts.csv";
        link.rel = "noreferrer";
        link.click();
      }
    } else if (operation === "refresh-list") {
      await refreshElection();
      await showContacts();
    } else if (operation === "refresh") await refreshElection();
    else if (operation === "contacts") await showContacts();
    else if (operation === "contacts-close") {
      view.showContacts = false;
      contacts?.dispose?.();
      contacts = null;
    } else if (operation === "election-new")
      view.showElection = !view.showElection;
    else if (operation === "upload-open") {
      if (await resumeUnfinishedUpload()) return;
      preparation.reset();
      view.resumePreparedImport = null;
      view.preparationMode = null;
      view.showUpload = true;
      view.job = null;
      view.rows = null;
    } else if (operation === "sent-open") {
      if (await resumeUnfinishedUpload()) return;
      if (!sentUpdatesAllowed())
        throw new Error(
          "New sent-ballot additions are not available for this election's current access. Refresh Ballot Chaser.",
        );
      preparation.reset();
      view.resumePreparedImport = null;
      view.preparationMode = "sent";
      view.uploadOperationId = null;
      view.showUpload = true;
      view.job = null;
      view.rows = null;
    } else if (operation === "prepare-resume") {
      if (!boundedElection() || view.job?.status !== "uploading")
        throw new Error(
          "Open the paused upload before preparing its source again.",
        );
      preparation.reset();
      view.preparationMode = null;
      view.resumePreparedImport = view.job;
      view.job = null;
      view.showUpload = true;
    } else if (operation === "job-close") {
      jobGeneration++;
      clearTimeout(timer);
      view.job = null;
      view.rows = null;
      view.showUpload = false;
      view.preparationMode = null;
      view.resumePreparedImport = null;
      view.editingMapping = false;
    } else if (operation === "mapping-edit") {
      if (
        !can("import") ||
        !["reviewing", "review_ready", "needs_review"].includes(
          view.job?.status,
        )
      )
        throw new Error("This report cannot be remapped now.");
      jobGeneration++;
      clearTimeout(timer);
      view.editingMapping = true;
      view.mappingDraft = {
        profile: structuredClone(
          view.job.profile || view.election?.profile || {},
        ),
      };
    } else if (operation === "mapping-cancel") {
      view.editingMapping = false;
      view.mappingDraft = {};
      trackJob(view.job);
    } else if (operation === "job" || operation === "job-refresh") {
      if (view.editingMapping) return;
      await openExistingUpload(
        (await call(`/imports/${id(value || view.job.importId)}`)).import,
      );
      if (view.job.status === "complete") await refreshElection();
    } else if (["advance", "apply"].includes(operation)) {
      if (view.editingMapping)
        throw new Error("Finish or cancel the mapping changes first.");
      jobGeneration++;
      if (!can("import"))
        throw new Error("Your role cannot change county reports.");
      trackJob(
        (
          await call(`/imports/${id(view.job.importId)}/${operation}`, {
            operationId: (view[`${operation}OperationId`] ||= uuid()),
          })
        ).import,
      );
      view[`${operation}OperationId`] = null;
      if (view.job.status === "complete") await refreshElection();
    } else if (operation === "sheet") {
      const sheetName = view.mappingDraft.sheetName || view.job.sheetName;
      trackJob(
        (
          await call(`/imports/${id(view.job.importId)}/inspect`, {
            operationId: uuid(),
            sheetName,
          })
        ).import,
      );
      view.mappingDraft = {};
    } else if (operation === "rows" || operation === "rows-more") {
      const result = await call(
        `/imports/${id(view.job.importId)}/rows${operation === "rows-more" && view.rowCursor ? `?cursor=${id(view.rowCursor)}` : ""}`,
      );
      view.rows = [
        ...(operation === "rows-more" ? view.rows : []),
        ...list(result.items),
      ];
      view.rowCursor = result.nextCursor;
    } else if (operation === "exclude") {
      if (!can("import"))
        throw new Error("Your role cannot review county records.");
      trackJob(
        (
          await call(`/imports/${id(view.job.importId)}/resolve`, {
            operationId: uuid(),
            row: Number(value),
            action: "exclude",
          })
        ).import,
      );
      await action("ballot-rows");
    } else if (operation === "imports-more" || operation === "elections-more") {
      const imports = operation === "imports-more";
      const result = await call(
        imports
          ? `/imports?electionId=${id(view.electionId)}&cursor=${id(view.importCursor)}`
          : `/elections?cursor=${id(view.electionCursor)}`,
      );
      view[imports ? "imports" : "elections"].push(...list(result.items));
      view[imports ? "importCursor" : "electionCursor"] = result.nextCursor;
    } else if (operation === "door") {
      view.showDoor = !view.showDoor;
      if (view.showDoor) await door.load();
    } else if (operation === "questions") {
      view.showDoor = false;
      await loadConfiguration();
    } else if (operation === "round")
      await loadConfiguration(view.selectedRoundId || "");
    else if (operation === "questions-close") view.configuration = null;
    else if (operation === "preset") {
      if (!view.roundId) throw new Error("Choose a canvassing round first.");
      view.questionDraft = addBallotChasingPreset(view.questionDraft);
      view.questionsDirty = true;
    } else if (operation === "question-add") {
      view.questionDraft.push({
        id: `question_${uuid().replaceAll("-", "")}`,
        prompt: "",
        type: "single",
        required: false,
        choices: ["Yes", "No", "Not discussed"],
      });
    } else if (operation === "question-remove")
      view.questionDraft.splice(Number(value), 1);
    else if (operation === "question-up" || operation === "question-down") {
      const index = Number(value),
        next = index + (operation === "question-up" ? -1 : 1);
      if (next >= 0 && next < view.questionDraft.length) {
        const question = view.questionDraft.splice(index, 1)[0];
        view.questionDraft.splice(next, 0, question);
      }
    }
  }
  async function submit(type, data, file) {
    if (type === "contacts-view") {
      if (!Object.hasOwn(ballotViews, data.get("chaseView")))
        throw new Error("Choose a ballot list.");
      view.chaseView = data.get("chaseView");
      view.chaseViewDraft = view.chaseView;
      view.showDoor = false;
      exports.reset();
      await showContacts();
      return;
    }
    if (type === "source-policy") {
      if (!can("import"))
        throw new Error("Your role cannot review this source’s permitted use.");
      if (sourcePolicyLocked())
        throw new Error("Source-use review is locked once publication starts.");
      const result = await call(
        `/elections/${id(view.electionId)}`,
        {
          expectedRevision: view.election.revision,
          operationId: (view.sourcePolicyOperationId ||= uuid()),
          sourcePolicy: ballotSourceUsePolicy(
            data.get("sourceUse") || "unreviewed",
          ),
        },
        "PATCH",
      );
      view.election = result.election;
      view.sourcePolicyOperationId = null;
      view.message =
        "Source-use review saved. Text Banking will also check consent and opt-outs.";
      return;
    }
    if (type === "identity-review") {
      if (!can("import"))
        throw new Error("Your role cannot review county records.");
      const row = list(view.rows).find(
          (item) => item.row === Number(data.get("row")),
        ),
        choice = data.get("candidate");
      if (
        !row ||
        row.status !== "review_required" ||
        row.error !== "ballot_legacy_identity_review"
      )
        throw new Error(
          "Refresh these record outcomes before resolving the contact.",
        );
      const candidate =
        choice !== "" && /^\d+$/.test(choice)
          ? list(row.candidates)[Number(choice)]
          : null;
      if (
        choice !== "create_new" &&
        (!candidate || candidate.canLink === false)
      )
        throw new Error(
          "Choose an eligible existing contact or keep a separate person.",
        );
      trackJob(
        (
          await call(`/imports/${id(view.job.importId)}/resolve`, {
            operationId: uuid(),
            row: row.row,
            action: choice === "create_new" ? "create_new" : "link",
            ...(candidate
              ? {
                  selectedContactId: candidate.contactId,
                  expectedRevision: candidate.revision,
                }
              : {}),
          })
        ).import,
      );
      await action("ballot-rows");
      return;
    }
    if (type === "choose-election") {
      await selectElection(data.get("electionId"));
      return;
    }
    if (type === "election") {
      if (!can("import"))
        throw new Error("Your role cannot set up county imports.");
      const result = await call("/elections", {
        operationId: uuid(),
        storageMode: "register",
        ...(view.preparationAvailability?.enabled === true
          ? { preparationPolicy: "bounded_v1" }
          : {}),
        name: data.get("name"),
        electionDate: data.get("electionDate"),
        state: data.get("state"),
        county: data.get("county"),
        sourceNamespace: data.get("sourceNamespace"),
        sourcePolicy: ballotSourceUsePolicy(
          data.get("sourceUse") || "unreviewed",
        ),
      });
      view.elections.unshift(result.election);
      view.showElection = false;
      await selectElection(result.election.electionId);
      return;
    }
    if (type === "prepare-source") {
      await refreshPreparationAccess();
      if (await resumeUnfinishedUpload()) return;
      await preparation.inspect(file, data);
      return;
    }
    if (type === "prepare-review") {
      await refreshPreparationAccess();
      if (await resumeUnfinishedUpload()) return;
      await preparation.prepare(data);
      return;
    }
    if (type === "prepare-return-edit") {
      preparation.reviewReturns();
      return;
    }
    let prepared;
    if (type === "prepare-upload") {
      if (!data.has("preparedReviewed"))
        throw new Error(
          "Review the selected voters and report meaning before uploading.",
        );
      data.set("sourceAsOf", preparedReportDate(data.get("sourceAsOf")));
      await refreshPreparationAccess();
      if (await resumeUnfinishedUpload()) return;
      prepared = preparation.ready(data);
      file = prepared.file;
      data.set("kind", prepared.mode === "baseline" ? "base" : "snapshot");
      data.set("fileMode", prepared.mode === "baseline" ? "full" : "delta");
    }
    if (type === "upload" || type === "resume" || type === "prepare-upload") {
      if (boundedElection() && type === "upload")
        throw new Error("Prepare this county file before uploading it.");
      if (!can("import") || !file?.size)
        throw new Error("Choose a county spreadsheet with import access.");
      if (
        type === "resume" &&
        (file.name !== view.job.fileName || file.size !== view.job.sizeBytes)
      )
        throw new Error("Reselect the original unchanged spreadsheet.");
      const job =
        type === "resume" || (prepared && view.resumePreparedImport)
          ? await call(
              `/imports/${id((view.resumePreparedImport || view.job).importId)}`,
            )
          : await call("/imports", {
              operationId: (view.uploadOperationId ||= uuid()),
              electionId: view.electionId,
              fileName: file.name,
              format: ballotFileFormat(file.name),
              sizeBytes: file.size,
              sourceAsOf: new Date(data.get("sourceAsOf")).toISOString(),
              kind: data.get("kind"),
              fileMode: data.get("fileMode"),
              ...(prepared
                ? {
                    preparation: {
                      mode: prepared.mode,
                      ...(prepared.snapshotId
                        ? { snapshotId: prepared.snapshotId }
                        : {}),
                    },
                  }
                : {}),
            });
      trackJob(job.import);
      const key = view.key,
        version = sequence;
      const progress = (value) => {
        guard(key, version);
        view.uploadProgress = value;
        changed();
      };
      view.uploadProgress = { loaded: 0, total: file.size };
      if (boundedElection() || file.size > 16 * 1024 * 1024) {
        view.checkingFile = true;
        changed();
        let sourceSha256;
        try {
          sourceSha256 = await checksumBlob(file, {
            ...(boundedElection() ? { chunkSize: 256 * 1024 } : {}),
            onProgress: () => guard(key, version),
          });
        } finally {
          if (sequence === version && view.key === key) {
            view.checkingFile = false;
            changed();
          }
        }
        guard(key, version);
        const upload = await call(
          `/imports/${id(job.import.importId)}/upload-start`,
          { operationId: uuid(), sourceSha256 },
        );
        const completion = await uploadBallotParts(file, upload.upload, {
          guard: () => guard(key, version),
          progress,
        });
        if (completion)
          await call(
            `/imports/${id(job.import.importId)}/upload-complete`,
            completion,
          );
      } else
        await uploadBallotFile(file, job.upload || job.import.upload, {
          guard: () => guard(key, version),
          progress,
        });
      view.uploadProgress = null;
      trackJob(
        (
          await call(`/imports/${id(job.import.importId)}/inspect`, {
            operationId: uuid(),
          })
        ).import,
      );
      view.uploadOperationId = null;
      view.resumePreparedImport = null;
      view.preparationMode = null;
      view.showUpload = false;
      if (prepared)
        view.mappingDraft = {
          profile: {
            voterIdColumn: prepared.idColumn,
            rowStatusMeans: prepared.mode === "returns" ? "returned" : "issued",
          },
        };
      return;
    }
    if (type === "mapping") {
      if (view.job?.boundedHeld)
        throw new Error(
          ballotPreparationMessage("ballot_preparation_work_limit"),
        );
      if (
        ![
          "awaiting_mapping",
          "reviewing",
          "review_ready",
          "needs_review",
        ].includes(view.job?.status)
      )
        throw new Error("This report cannot be remapped now.");
      jobGeneration++;
      clearTimeout(timer);
      if (!can("import"))
        throw new Error("Your role cannot map county columns.");
      const statusMap = {};
      for (const line of String(data.get("statusMap") || "")
        .split(/\r?\n/)
        .filter((line) => line.trim())) {
        const separator = line.lastIndexOf("=");
        if (
          separator < 0 ||
          !ballotStatuses.includes(line.slice(separator + 1).trim())
        )
          throw new Error(
            "Use one county value = valid ballot state per line.",
          );
        const raw = line.slice(0, separator).trim();
        if (Object.hasOwn(statusMap, raw))
          throw new Error("Each county status value needs one meaning.");
        statusMap[raw] = line.slice(separator + 1).trim();
      }
      const profile = {
        voterIdColumn: data.get("voterIdColumn"),
        statusMap,
        fieldMapping: {},
        sourceOnlyColumns: [],
        blankPolicy: "preserve",
        clearBlankColumns: data.getAll("clearBlankColumns"),
      };
      if (data.get("voterIdPaddingWidth"))
        profile.voterIdPaddingWidth = Number(data.get("voterIdPaddingWidth"));
      for (const key of [
        "statusColumn",
        "returnedDateColumn",
        "requestedColumn",
        "issuedColumn",
        "blankStatusMeans",
        "rowStatusMeans",
      ])
        if (data.get(key)) profile[key] = data.get(key);
      Object.assign(
        profile,
        ballotContactColumns(
          columns(view.job),
          Object.fromEntries(
            columns(view.job).map((header, index) => [
              header,
              data.get(`field_${index}`),
            ]),
          ),
        ),
      );
      trackJob(
        (
          await call(`/imports/${id(view.job.importId)}/mapping`, {
            operationId: uuid(),
            sheetName: data.get("sheetName") || view.job.sheetName,
            profile,
          })
        ).import,
      );
      view.editingMapping = false;
      view.mappingDraft = {};
      return;
    }
    if (type === "questions") {
      const questions = view.questionDraft.map((question, index) => ({
        ...question,
        prompt: data.get(`prompt_${index}`),
        type: data.get(`type_${index}`),
        required: data.has(`required_${index}`),
        ...(data.get(`type_${index}`) !== "support"
          ? { target: null, party: null, ideology: null }
          : {}),
        ...(data.get(`type_${index}`) !== "multi"
          ? { linkTargets: false, targets: [] }
          : {}),
        choices:
          data.get(`type_${index}`) === "text"
            ? []
            : String(data.get(`choices_${index}`) || "")
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean),
      }));
      const key = view.key,
        version = sequence;
      const result = await request(
        `/api/voter-map/canvassing/configuration?coalitionId=${id(context().scopeId)}${view.roundId ? `&roundId=${id(view.roundId)}` : ""}`,
        {
          auth: true,
          method: "PATCH",
          beforeRequest: () => guard(key, version),
          body: {
            expectedRevision: view.configuration.revision,
            questions,
            ...(view.roundId
              ? { ballotChase: { electionId: view.electionId } }
              : {}),
          },
        },
      );
      guard(key, version);
      view.configuration = result.configuration;
      view.questionDraft = structuredClone(
        result.configuration.effective.questions,
      );
      view.message =
        "Round questions saved. County ballot status stays separate from conversation answers.";
    }
  }
  const owned = (element) =>
    current() &&
    element?.closest?.("[data-ballot-key]")?.dataset.ballotKey === view.key;
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-workspace-action]");
    if (!owned(target) || target.disabled) return;
    event.preventDefault();
    if (target.dataset.workspaceAction === "ballot-preparation-cancel") {
      preparation.cancel();
      return;
    }
    if (
      contacts?.localAction?.(
        target.dataset.workspaceAction,
        target.dataset.value,
        target,
      )
    ) {
      changed();
      return;
    }
    void run(() =>
      action(target.dataset.workspaceAction, target.dataset.value),
    );
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.matches?.("[data-ballot-door-form]")) return;
    if (!owned(form)) return;
    event.preventDefault();
    const statusRescan =
      form.dataset.ballotForm === "prepare-review" &&
      event.submitter?.name === "readStatuses";
    if (!statusRescan && !form.reportValidity()) return;
    const data = new FormData(form),
      file = form.querySelector('input[type="file"]')?.files?.[0];
    if (statusRescan) data.set("readStatuses", "on");
    if (form.dataset.workspaceForm?.endsWith("-import-preview") && file)
      contacts?.change(form.querySelector('input[type="file"]'));
    void run(() =>
      form.dataset.ballotForm
        ? submit(form.dataset.ballotForm, data, file)
        : contacts?.submit?.(
            form.dataset.registerForm || form.dataset.workspaceForm,
            form,
          ),
    );
  });
  const change = (event) => {
    const target = event.target;
    if (!owned(target)) return;
    if (target.name === "roundId") view.selectedRoundId = target.value;
    const form = target.closest("[data-ballot-form]");
    if (
      form?.dataset.ballotForm === "contacts-view" &&
      target.name === "chaseView" &&
      Object.hasOwn(ballotViews, target.value)
    )
      view.chaseViewDraft = target.value;
    if (form?.dataset.ballotForm === "upload")
      view.uploadDraft[target.name] = target.value;
    if (
      form?.dataset.ballotForm === "prepare-upload" &&
      target.name === "sourceAsOf"
    )
      preparation.reportDate(target.value);
    if (form?.dataset.ballotForm === "mapping") {
      const data = new FormData(form),
        profile = {
          ...(view.mappingDraft.profile ||
            view.job.profile ||
            view.election?.profile ||
            {}),
        };
      for (const key of [
        "voterIdColumn",
        "statusColumn",
        "returnedDateColumn",
        "requestedColumn",
        "issuedColumn",
        "blankStatusMeans",
        "rowStatusMeans",
      ])
        profile[key] = data.get(key);
      view.mappingDraft = {
        ...view.mappingDraft,
        sheetName: data.get("sheetName"),
        profile,
        statusText: data.get("statusMap"),
      };
      profile.fieldMapping = {};
      profile.clearBlankColumns = data.getAll("clearBlankColumns");
      columns(view.job).forEach((header, index) => {
        if (data.get(`field_${index}`))
          profile.fieldMapping[header] = data.get(`field_${index}`);
      });
      if (target.name.startsWith("field_")) {
        const blanks = form.elements.namedItem("clearBlankColumns");
        if (blanks)
          blanks.innerHTML = columns(view.job)
            .filter((header) => profile.fieldMapping[header])
            .map(
              (header) =>
                `<option value="${e(header)}"${list(profile.clearBlankColumns).includes(header) ? " selected" : ""}>${e(header)}</option>`,
            )
            .join("");
      }
      if (data.get("voterIdPaddingWidth"))
        profile.voterIdPaddingWidth = Number(data.get("voterIdPaddingWidth"));
    }
    if (form?.dataset.ballotForm === "questions") {
      const match = target.name.match(/^(prompt|type|choices|required)_(\d+)$/);
      if (match) {
        const [, key, index] = match;
        view.questionDraft[Number(index)][key] =
          key === "required"
            ? target.checked
            : key === "choices"
              ? target.value
                  .split(/\r?\n/)
                  .map((value) => value.trim())
                  .filter(Boolean)
              : target.value;
        view.questionsDirty = true;
      }
    }
    if (contacts?.change?.(target)) changed();
    if (
      ["-tag-cell", "-page-size"].some((suffix) =>
        target.dataset.contactChange?.endsWith(suffix),
      )
    )
      void run(() => contacts.action(target.dataset.contactChange));
  };
  document.addEventListener(
    "toggle",
    (event) => {
      const target = event.target;
      if (
        target?.isConnected &&
        target.matches?.("[data-ballot-mapping-details]") &&
        owned(target)
      )
        view.mappingDetailsOpen = target.open;
    },
    true,
  );
  document.addEventListener("input", change);
  document.addEventListener("change", change);
  return {
    load,
    render,
    reset,
    action: (name, value) => run(() => action(name, value)),
    state: () => view,
  };
}
