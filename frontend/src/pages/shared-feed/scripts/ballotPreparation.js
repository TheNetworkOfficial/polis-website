import { checkedBallotDownload } from "./ballotExport";
import {
  BALLOT_PREPARATION_LIMITS,
  BALLOT_PREPARATION_MAX_ROWS,
  BALLOT_PREPARATION_MAX_PARTY_VALUES,
  ballotPreparationPolicyLimits,
} from "./ballotPreparationModel";
import {
  escapeText as e,
  field,
  select,
  count,
  notice,
  uuid,
} from "./textingWorkspaceUi";

const workerFactory = () =>
  new Worker(new URL("./ballotPreparation.worker.js", import.meta.url));
const deadlineMs = 10 * 60 * 1000;

/** Only the server's controlled C4D sent-update contract exposes this workflow. */
export function ballotSentPreparationPolicy(policy, columns) {
  return policy?.enabled === true &&
    policy.maxRows === 5000 &&
    policy.maxSourceBytes === 5000000 &&
    policy.idColumn === "VOTERID" &&
    policy.districtColumn === "CONDIST" &&
    policy.districtValue === "8" &&
    policy.partyColumn === "PARTY" &&
    Array.isArray(policy.partyValues) &&
    policy.partyValues.length === 2 &&
    [...policy.partyValues].sort().join(",") === "IND,PND" &&
    policy.statusColumn === "BALSTATUS" &&
    policy.issuedValue === "S" &&
    policy.electionDateColumn === "ELECTDATE" &&
    Array.isArray(columns) &&
    columns.length > 0 &&
    columns.length <= BALLOT_PREPARATION_LIMITS.maxColumns &&
    new Set(columns).size === columns.length &&
    ["VOTERID", "CONDIST", "PARTY", "BALSTATUS", "ELECTDATE"].every((name) =>
      columns.includes(name),
    )
    ? policy
    : null;
}

const sentPolicyKey = (ctx) => {
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(ctx.electionDate || "")
    ? new Date(`${ctx.electionDate}T00:00:00.000Z`)
    : null;
  return date &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === ctx.electionDate &&
    ballotSentPreparationPolicy(ctx.sentUpdates, ctx.preparationColumns)
    ? JSON.stringify([ctx.electionDate, ctx.preparationColumns])
    : "";
};

function preparationLimits(ctx) {
  const limits = { ...BALLOT_PREPARATION_LIMITS, ...ctx.limits };
  if (
    ctx.limits === null ||
    !Number.isSafeInteger(limits.maxRows) ||
    limits.maxRows < 1 ||
    limits.maxRows > BALLOT_PREPARATION_MAX_ROWS ||
    limits.maxOutputBytes !== BALLOT_PREPARATION_LIMITS.maxOutputBytes
  )
    throw new Error(
      "This election's file capacity could not be confirmed. Refresh Ballot Chaser.",
    );
  return limits;
}
const capacityKey = (ctx) => {
  const limits = preparationLimits(ctx);
  return `${limits.maxRows}:${limits.maxOutputBytes}`;
};

/** An enrolled cohort retains its frozen cap when availability later expands. */
export function ballotPreparationCapacity(availability, election) {
  const available = ballotPreparationPolicyLimits(availability),
    enrolled = ballotPreparationPolicyLimits(election);
  return available && enrolled
    ? { ...enrolled, maxRows: Math.min(available.maxRows, enrolled.maxRows) }
    : null;
}

/** A county date needs no invented time; supplied times must identify their zone. */
export function preparedReportDate(value) {
  const text = String(value || "").trim(),
    date = text.slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/u.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : null;
  const validDay =
    day &&
    Number.isFinite(day.getTime()) &&
    day.toISOString().slice(0, 10) === date;
  if (validDay && text === date) return day.toISOString();
  if (
    validDay &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      text,
    )
  ) {
    const timestamp = new Date(text);
    if (Number.isFinite(timestamp.getTime())) return timestamp.toISOString();
  }
  throw new Error(
    "Enter the county's actual YYYY-MM-DD date, or an ISO date and time with Z or a time-zone offset. Do not invent a time for a date-only report.",
  );
}

/** Browser-only preparation never uploads the original county file. */
export function createBallotPreparation({
  request,
  guard,
  changed,
  context,
  beforeIdExport = async () => true,
  createWorker = workerFactory,
  transport = fetch,
  pause = (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Preparation cancelled."));
        },
        { once: true },
      );
    }),
}) {
  let state = {},
    generation = 0,
    worker,
    controller,
    rejectWorker;
  const check = (version) => {
    guard();
    if (version !== generation || controller?.signal.aborted)
      throw new Error(
        "Preparation cancelled. Choose the file again when ready.",
      );
    if (state.startedAt && Date.now() - state.startedAt > deadlineMs)
      throw new Error(
        "Preparation took too long. Review the county file and try again.",
      );
  };
  function cancel() {
    generation++;
    controller?.abort();
    worker?.terminate();
    worker = null;
    rejectWorker?.(new Error("Preparation cancelled. No file was uploaded."));
    rejectWorker = null;
    state = {};
    changed();
  }
  const reset = cancel;
  function runWorker(action, file, options, version) {
    check(version);
    return new Promise((resolve, reject) => {
      const active = createWorker();
      worker = active;
      let lastProgress = 0;
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              "Preparation took too long. Use a smaller reviewed county file and try again.",
            ),
          ),
        Math.max(1, deadlineMs - (Date.now() - state.startedAt)),
      );
      function finish(error, result) {
        clearTimeout(timeout);
        active.terminate();
        if (worker === active) {
          worker = null;
          rejectWorker = null;
        }
        if (error) reject(error);
        else resolve(result);
      }
      rejectWorker = (error) => finish(error);
      active.onerror = () =>
        finish(
          new Error(
            "The county file could not be prepared. Review its format and try again.",
          ),
        );
      active.onmessage = ({ data }) => {
        if (data.id !== version) return;
        try {
          check(version);
        } catch (error) {
          finish(error);
          return;
        }
        if (data.type === "progress") {
          if (
            Date.now() - lastProgress >= 100 ||
            data.progress?.bytesRead === data.progress?.inputBytes
          ) {
            lastProgress = Date.now();
            state.progress = data.progress;
            changed();
          }
        } else if (data.type === "result") finish(null, data.result);
        else if (data.type === "error")
          finish(
            new Error(
              data.error?.message ||
                "Review the county file format before trying again.",
            ),
          );
      };
      active.postMessage({ id: version, action, file, options });
    });
  }
  async function inspect(file, data) {
    cancel();
    const ctx = context();
    if (!ctx.allowed)
      throw new Error(
        "County-file preparation is not enabled for this organization.",
      );
    if (!file?.size) throw new Error("Choose a county TXT, CSV or TSV file.");
    const mode = ctx.mode || (ctx.snapshotId ? "returns" : "baseline");
    if (
      mode === "sent" &&
      (!ctx.snapshotId || !ctx.canExport || !sentPolicyKey(ctx))
    )
      throw new Error(
        "Adding newly sent ballots is not available for this election's current access. Refresh Ballot Chaser.",
      );
    controller = new AbortController();
    const version = generation;
    state = {
      stage: "working",
      startedAt: Date.now(),
      file,
      format: {
        delimiter: data.get("delimiter") || "auto",
        encoding: data.get("encoding") || "utf-8",
        limits: preparationLimits(ctx),
      },
      binding: {
        ...ctx,
        capacityKey: capacityKey(ctx),
        sentPolicyKey: sentPolicyKey(ctx),
      },
      mode,
    };
    changed();
    try {
      const preview = await runWorker("inspect", file, state.format, version);
      check(version);
      state.preview = preview;
      state.stage = "review";
      state.progress = null;
      changed();
    } catch (error) {
      if (version === generation) {
        state = {};
        changed();
      }
      throw error;
    }
  }
  const bound = () => {
    const ctx = context(),
      saved = state.binding;
    if (
      !ctx.allowed ||
      !saved ||
      ctx.base !== saved.base ||
      ctx.electionId !== saved.electionId ||
      ctx.snapshotId !== saved.snapshotId ||
      capacityKey(ctx) !== saved.capacityKey ||
      (state.mode === "sent" &&
        (!sentPolicyKey(ctx) || sentPolicyKey(ctx) !== saved.sentPolicyKey))
    )
      throw new Error(
        "The election or county report changed. Refresh and prepare this file again.",
      );
    if (["returns", "sent"].includes(state.mode) && !ctx.canExport)
      throw new Error(
        "Matching county updates requires current export permission for this election.",
      );
    return ctx;
  };
  async function api(url, body, version) {
    check(version);
    bound();
    const result = await request(url, {
      auth: true,
      beforeRequest: () => {
        check(version);
        bound();
      },
      ...(body ? { method: "POST", body } : {}),
    });
    check(version);
    bound();
    if (result?.ok !== true)
      throw new Error("The current voter list could not be confirmed.");
    return result;
  }
  async function retainedIds(version) {
    if ((await beforeIdExport()) === false) return null;
    check(version);
    const ctx = bound(),
      started = Date.now(),
      limits = preparationLimits(ctx),
      maxIdBytes = Math.min(limits.maxOutputBytes, limits.maxRows * 162 + 1024);
    if (!ctx.canExport || !ctx.snapshotId)
      throw new Error(
        "Matching returns requires permission to export this election's official voter IDs.",
      );
    state.progress = { phase: "Matching the current voter list" };
    changed();
    let result = await api(
      `${ctx.base}/elections/${encodeURIComponent(ctx.electionId)}/exports`,
      {
        operationId: (state.idExportOperation ||= uuid()),
        snapshotId: ctx.snapshotId,
        view: "all",
        columns: ["ballotVoterId"],
        selection: { mode: "all_matching", excludeVoterRefs: [] },
      },
      version,
    );
    const exportId = result.export?.exportId;
    if (!exportId)
      throw new Error("The voter ID export could not be confirmed.");
    const endpoint = `${ctx.base}/exports/${encodeURIComponent(exportId)}`;
    while (result.export?.status === "building") {
      if (Date.now() - started > deadlineMs)
        throw new Error(
          "Matching the current voter list timed out. Check the election and try again.",
        );
      await pause(3000, controller.signal);
      check(version);
      result = await api(endpoint, null, version);
    }
    if (
      result.export?.status !== "ready" ||
      result.export.snapshotId !== ctx.snapshotId ||
      !Number.isSafeInteger(result.export.rows) ||
      result.export.rows < 1 ||
      result.export.rows > limits.maxRows
    )
      throw new Error(
        `The current voter list changed or exceeds this election's ${count(limits.maxRows)}-voter capacity. Refresh and review the election.`,
      );
    // Reauthorize every download through the existing private export endpoint.
    result = await api(endpoint, null, version);
    if (
      result.export?.status !== "ready" ||
      result.export.snapshotId !== ctx.snapshotId
    )
      throw new Error(
        "The voter list changed. Refresh and prepare the returns again.",
      );
    const url = checkedBallotDownload(result.download);
    const response = await transport(url, {
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    check(version);
    if (!response.ok || !response.body?.getReader)
      throw new Error(
        "The private voter list could not be downloaded. Try again.",
      );
    const reader = response.body.getReader(),
      chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        check(version);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxIdBytes)
          throw new Error(
            "The voter ID list is larger than this preparation supports.",
          );
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const ids = await runWorker("ids", new Blob(chunks), { limits }, version);
    if (ids.length !== result.export.rows)
      throw new Error(
        "The voter ID list could not be verified. Refresh and try again.",
      );
    const confirmed = await api(endpoint, null, version);
    if (
      confirmed.export?.status !== "ready" ||
      confirmed.export.snapshotId !== ctx.snapshotId ||
      confirmed.export.exportId !== exportId
    )
      throw new Error(
        "The voter list changed. Refresh and prepare the returns again.",
      );
    return ids;
  }
  /** Scan only local status codes before C4D decides how each code is handled. */
  async function readReturnStatuses(idColumn, statusColumn) {
    const version = generation;
    bound();
    state.prepared = null;
    state.returnStatusReview = null;
    state.returnMeanings = null;
    state.stage = "working";
    state.startedAt = Date.now();
    changed();
    try {
      const result = await runWorker(
        "return-statuses",
        state.file,
        {
          ...state.format,
          delimiter: state.preview.delimiter,
          encoding: state.preview.encoding,
          idColumn,
          statusColumn,
        },
        version,
      );
      check(version);
      bound();
      if (
        result.statusColumn !== statusColumn ||
        !Number.isSafeInteger(result.inputRows) ||
        result.inputRows < 0 ||
        !Array.isArray(result.statuses) ||
        result.statuses.length > 32 ||
        result.statuses.some(
          (item) =>
            typeof item.value !== "string" ||
            !Number.isSafeInteger(item.count) ||
            item.count < 1,
        ) ||
        new Set(result.statuses.map((item) => item.value)).size !==
          result.statuses.length ||
        result.statuses.reduce((sum, item) => sum + item.count, 0) !==
          result.inputRows
      )
        throw new Error("The county status counts could not be confirmed.");
      state.returnStatusReview = { ...result, idColumn };
      state.returnMeanings = result.statuses.map(({ value }) =>
        value === "R" ? "returned" : value === "X" ? "voided" : "",
      );
      state.stage = "review";
      state.progress = null;
      changed();
    } catch (error) {
      if (version === generation) {
        state.stage = "review";
        state.progress = null;
        changed();
      }
      throw error;
    }
  }
  async function prepare(data) {
    // A changed or rejected review must never leave an older file uploadable.
    state.prepared = null;
    state.stage = "review";
    if (!data.has("headersReviewed"))
      throw new Error(
        "Confirm the displayed header row and official voter ID column first.",
      );
    const ctx = bound();
    const version = generation,
      idColumn = data.get("idColumn");
    if (!state.preview?.headers.includes(idColumn))
      throw new Error("Choose the county's official voter ID column.");
    const filters = [];
    let returnStatus;
    if (state.mode === "sent") {
      const policy = ballotSentPreparationPolicy(
        ctx.sentUpdates,
        ctx.preparationColumns,
      );
      if (
        !policy ||
        idColumn !== policy.idColumn ||
        state.preview.headers.length !== ctx.preparationColumns.length ||
        ctx.preparationColumns.some(
          (column) => !state.preview.headers.includes(column),
        )
      )
        throw new Error(
          "Use the county sent-ballot layout with VOTERID, CONDIST, PARTY, BALSTATUS, ELECTDATE and every original master column. Existing voters will not be changed.",
        );
      filters.push(
        { column: policy.districtColumn, value: policy.districtValue },
        { column: policy.partyColumn, values: [...policy.partyValues] },
      );
      state.reviewedFilters = {
        district: policy.districtValue,
        partyValues: [...policy.partyValues],
      };
    } else if (state.mode === "baseline") {
      const district = data.get("districtColumn"),
        party = data.get("partyColumn"),
        partyValues = [
          ...new Set(
            String(data.get("partyValue") || "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ];
      if (
        !state.preview.headers.includes(district) ||
        !state.preview.headers.includes(party) ||
        district === party ||
        !data.get("districtValue") ||
        partyValues.length < 1 ||
        partyValues.length > BALLOT_PREPARATION_MAX_PARTY_VALUES
      )
        throw new Error(
          "Choose separate district and party columns and enter up to 16 exact county party values, separated by commas.",
        );
      filters.push(
        { column: district, value: data.get("districtValue") },
        partyValues.length === 1
          ? { column: party, value: partyValues[0] }
          : { column: party, values: partyValues },
      );
      state.reviewedFilters = {
        district: String(data.get("districtValue")),
        partyValues,
      };
    } else {
      const statusColumn = String(data.get("statusColumn") || "");
      state.returnColumns = { idColumn, statusColumn };
      if (statusColumn) {
        if (
          statusColumn === idColumn ||
          !state.preview.headers.includes(statusColumn)
        )
          throw new Error("Choose a separate county return-status column.");
        const review = state.returnStatusReview;
        if (
          data.has("readStatuses") ||
          review?.idColumn !== idColumn ||
          review?.statusColumn !== statusColumn
        )
          return readReturnStatuses(idColumn, statusColumn);
        state.returnMeanings = review.statuses.map((_, index) =>
          String(data.get(`returnMeaning_${index}`) || ""),
        );
        if (
          state.returnMeanings.some(
            (meaning) => !["returned", "voided", "ignore"].includes(meaning),
          )
        )
          throw new Error(
            "Choose a meaning for every observed status, including blank values, before matching returns.",
          );
        if (!data.has("statusMeaningsReviewed"))
          throw new Error(
            "Confirm the displayed county status meanings first.",
          );
        returnStatus = {
          column: statusColumn,
          mappings: review.statuses.map(({ value }, index) => ({
            value,
            meaning: state.returnMeanings[index],
          })),
        };
      } else {
        if (state.preview.headers.includes("BALSTATUS"))
          throw new Error(
            "This file includes BALSTATUS. Review its received and voided codes before matching returns.",
          );
        if (!data.has("confirmedReturnsOnly"))
          throw new Error(
            "Select the return-status column, or explicitly confirm this file contains only received ballots.",
          );
        state.returnStatusReview = null;
        state.returnMeanings = null;
        returnStatus = { returnedOnly: true };
      }
    }
    state.stage = "working";
    state.startedAt = Date.now();
    changed();
    const deadline = setTimeout(() => controller.abort(), deadlineMs);
    try {
      const retained = ["returns", "sent"].includes(state.mode)
        ? await retainedIds(version)
        : undefined;
      if (retained === null) return;
      const prepared = await runWorker(
        "prepare",
        state.file,
        {
          ...state.format,
          delimiter: state.preview.delimiter,
          encoding: state.preview.encoding,
          idColumn,
          filters,
          limits: preparationLimits(ctx),
          mode: state.mode,
          ...(returnStatus ? { returnStatus } : {}),
          ...(retained ? { retainedIds: retained } : {}),
          ...(state.mode === "sent"
            ? {
                outputColumns: ctx.preparationColumns,
                sentPolicy: ctx.sentUpdates,
                electionDate: ctx.electionDate,
              }
            : {}),
        },
        version,
      );
      check(version);
      bound();
      state.prepared = prepared;
      state.idColumn = idColumn;
      state.stage = "ready";
      state.progress = null;
      changed();
    } catch (error) {
      if (version === generation) {
        state.stage = "review";
        state.progress = null;
        changed();
      }
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }
  function ready(data) {
    guard();
    bound();
    if (state.stage !== "ready" || !state.prepared?.blob)
      throw new Error("Prepare and review the county file before uploading.");
    if (state.prepared.receipt.selectedRows < 1)
      throw new Error(
        state.mode === "sent"
          ? "No new eligible voters were found. No update is needed."
          : "No returns match this election. No update is needed.",
      );
    if (state.mode === "sent") {
      const policy = ballotSentPreparationPolicy(
        context().sentUpdates,
        context().preparationColumns,
      );
      if (
        !policy ||
        state.prepared.receipt.selectedRows > policy.maxRows ||
        state.prepared.blob.size > policy.maxSourceBytes
      )
        throw new Error(
          "This daily sent update exceeds the controlled 5,000-new-voter or 5 MB limit. No file was uploaded.",
        );
    }
    if (
      state.prepared.receipt.conflictingIds > 0 &&
      !data?.has("excludeConflicted")
    )
      throw new Error(
        state.mode === "sent"
          ? "Confirm that new voters with conflicting sent-ballot records will be excluded from this update."
          : "Confirm that voters with both received and voided records will be left unchanged in this update.",
      );
    return {
      file: new File(
        [state.prepared.blob],
        state.mode === "sent"
          ? "prepared-sent-ballots.csv"
          : "prepared-ballots.csv",
        { type: "text/csv" },
      ),
      mode: state.mode,
      idColumn: state.mode === "returns" ? "Voter ID" : state.idColumn,
      snapshotId: state.binding.snapshotId,
      receipt: state.prepared.receipt,
    };
  }
  function reviewReturns() {
    guard();
    bound();
    if (state.mode !== "returns" || !state.preview)
      throw new Error("Choose the county returns file first.");
    state.prepared = null;
    state.stage = "review";
    changed();
  }
  function returnSummary(receipt) {
    if (state.mode !== "returns") return "";
    return `<section aria-label="County return status summary"><p>County status counts: ${count(receipt.returnedRows ?? receipt.selectedRows)} received rows · ${count(receipt.voidedRows || 0)} voided rows excluded · ${count(receipt.ignoredStatusRows || 0)} other rows excluded.</p><p>${count(receipt.conflictingIds || 0)} voters with both received and voided records are excluded from this update. Voided records do not count as new returns. Previous ballot status stays unchanged for excluded voters; a received ballot is separate from an accepted ballot.</p></section>`;
  }
  function sentSummary(receipt) {
    if (state.mode !== "sent") return "";
    return `<section aria-label="Newly sent ballot summary"><p>${count(receipt.selectedRows)} new CD8 IND/PND voters · ${count(receipt.existingRows || 0)} already tracked rows skipped · ${count(receipt.outsideRows || 0)} rows outside CD8 IND/PND · ${count(receipt.voidedRows || 0)} voided rows excluded.</p><p>${count(receipt.conflictingIds || 0)} new voters with conflicting sent-ballot records are excluded. Only newly listed voters with the county's S code will be added as Issued. Existing voters, previous returns and ballot history stay unchanged.</p></section>`;
  }
  const reviewReturnsButton = () =>
    state.mode === "returns"
      ? '<form data-ballot-form="prepare-return-edit"><button class="pt-btn pt-btn--secondary" type="submit">Review return status choices</button></form>'
      : "";
  function render(busy = false) {
    if (!context().allowed)
      return notice(
        "Preparation unavailable",
        "County-file preparation is not enabled for this organization. Ask an organization administrator to check access.",
      );
    if (
      context().mode === "sent" &&
      (!context().snapshotId ||
        !context().canExport ||
        !sentPolicyKey(context()))
    )
      return notice(
        "Sent additions unavailable",
        "Refresh this election's access before preparing newly sent ballots.",
      );
    const limits = preparationLimits(context());
    const mode =
      state.mode ||
      (context().mode === "sent"
        ? "sent"
        : context().snapshotId
          ? "returns"
          : "baseline");
    const workflowLabel = `<p class="pt-eyebrow">${mode === "sent" ? "Sent ballots — add new voters" : mode === "returns" ? "Returned ballots — match received ballots" : "Initial sent-ballot master"}</p>`;
    const sentReturnWarning =
      mode === "returns" &&
      sentPolicyKey(context()) &&
      state.returnStatusReview?.statuses.some(({ value }) => value === "S")
        ? '<p role="status"><strong>This file includes sent ballots (S).</strong> To add newly sent voters, choose <strong>Cancel preparation</strong>, then <strong>Upload sent-ballot file</strong> on the dashboard. S means Sent; do not mark it as Returned.</p>'
        : "";
    const submit = (text) =>
      `<button class="pt-btn" type="submit"${busy ? " disabled" : ""}>${e(text)}</button>`;
    const cancelButton =
      '<button class="pt-btn pt-btn--secondary" type="button" data-workspace-action="ballot-preparation-cancel">Cancel preparation</button>';
    if (state.stage === "working")
      return `<section class="pt-card" aria-label="County file preparation">${workflowLabel}<h2>Preparing county file</h2><progress aria-label="Preparation progress" ${state.progress?.inputBytes ? `value="${state.progress.bytesRead || 0}" max="${state.progress.inputBytes}"` : ""}></progress><p role="status">${e(state.progress?.phase || "Reading the county file")}${state.progress?.inputRows ? ` · ${count(state.progress.inputRows)} records checked` : ""}</p>${cancelButton}</section>`;
    if (state.stage === "ready") {
      const receipt = state.prepared.receipt;
      const reviewedSelection = state.reviewedFilters
        ? `<p>Reviewed selection: district <strong>${e(state.reviewedFilters.district)}</strong> and party <strong>${state.reviewedFilters.partyValues.map(e).join(" or ")}</strong>.</p>`
        : "";
      if (receipt.selectedRows === 0)
        return `<section class="pt-card">${workflowLabel}<h2>${state.mode === "sent" ? "No new eligible voters" : "No matching returns"}</h2><p>${count(receipt.inputRows)} source records checked${state.mode === "sent" ? "" : ` · ${count(receipt.unknownRows || 0)} rows outside this election`} · ${count(receipt.duplicateRows || 0)} repeated IDs removed.</p>${returnSummary(receipt)}${sentSummary(receipt)}<p>No update is needed. No file was uploaded.</p>${cancelButton}</section>${reviewReturnsButton()}`;
      const conflictReview =
        receipt.conflictingIds > 0
          ? `<label class="pt-workspace-check"><input type="checkbox" name="excludeConflicted" required>${state.mode === "sent" ? "Exclude new voters with conflicting sent-ballot records from this update." : "Leave voters with both received and voided records unchanged in this update."}</label>`
          : "";
      return `<form class="pt-card" data-ballot-form="prepare-upload">${workflowLabel}<h2>Review prepared ${state.mode === "returns" ? "returns" : state.mode === "sent" ? "newly sent ballots" : "sent ballots"}</h2>${reviewedSelection}<p>${count(receipt.inputRows)} source records · ${count(receipt.selectedRows)} selected · ${count(receipt.excludedRows)} excluded</p><p>${count(receipt.duplicateRows || 0)} repeated IDs were removed.</p>${state.mode === "returns" ? `<p>${count(receipt.matchedUnique || receipt.selectedRows)} unique IDs matched this election; ${count(receipt.unknownRows || 0)} rows outside this election were excluded.</p>` : ""}${returnSummary(receipt)}${sentSummary(receipt)}<p>${(state.prepared.blob.size / 1000000).toFixed(2)} MB prepared. Only this list will upload. Official IDs and their leading zeroes are preserved.</p><p>Every selected row means <strong>${state.mode === "returns" ? "Returned" : "Issued"}</strong>. Missing voters keep their earlier status.</p>${state.binding.sourceAsOf ? `<p>Original report date: ${e(state.binding.sourceAsOf)}</p><input name="sourceAsOf" type="hidden" value="${e(state.binding.sourceAsOf)}">` : field("sourceAsOf", "Official report date or timestamp", state.sourceAsOf || "", { required: true, extra: 'placeholder="YYYY-MM-DD or 2026-10-24T12:00:00-07:00"' }) + "<p>Use the county date alone when no time is supplied. A timestamp must include its time zone. Sent and returned reports may use the same official date; never invent a later time.</p>"}${state.mode === "sent" ? "<p>Apply daily sent additions before matching that day's returns. If returns were already applied, match the latest returns again after these additions. All county updates share the existing two-per-day and 35-per-month import limits; if today's limit is reached, continue on the next day.</p>" : ""}${conflictReview}<label class="pt-workspace-check"><input type="checkbox" name="preparedReviewed" required>I checked the selected count and this report's meaning.</label><div class="pt-actions">${submit("Upload prepared list and review columns")}${cancelButton}</div></form>${reviewReturnsButton()}`;
    }
    if (state.stage === "review") {
      const choices = [
        ["", "Choose a column"],
        ...state.preview.headers.map((header) => [header, header]),
      ];
      const review = state.returnStatusReview;
      const countyStatus = state.preview.headers.includes("BALSTATUS");
      const statusChoices = [
        [
          "",
          countyStatus
            ? "Choose a status column"
            : "No status column — confirmed returns only",
        ],
        ...state.preview.headers.map((header) => [header, header]),
      ];
      const returnFields =
        state.mode === "returns"
          ? select(
              "statusColumn",
              "Return-status column",
              statusChoices,
              state.returnColumns?.statusColumn ??
                (countyStatus ? "BALSTATUS" : ""),
              countyStatus,
            ) +
            (countyStatus
              ? "<p>Use the county's returns report here. Maricopa's S code does not confirm a received ballot.</p>"
              : '<label class="pt-workspace-check"><input type="checkbox" name="confirmedReturnsOnly">For a file without a status column, I confirmed every record is a received ballot.</label>')
          : "";
      const statusMeanings =
        state.mode === "returns" && review
          ? `<section aria-label="Review county return statuses"><h3>Review every return status</h3><p>${count(review.inputRows)} rows checked locally. Confirm each exact county code. Maricopa documents R as received and X as voided; other codes and blank values need your choice.</p>${review.statuses
              .map(
                ({ value, count: rows }, index) =>
                  `<div class="pt-fields"><p><strong>${value === "" ? "Blank status" : e(JSON.stringify(value))}</strong> · ${count(rows)} rows</p>${select(
                    `returnMeaning_${index}`,
                    `Meaning for ${value === "" ? "blank status" : value}`,
                    [
                      ["", "Choose meaning"],
                      ["returned", "Received ballot — include as Returned"],
                      ["voided", "Voided ballot — exclude"],
                      ["ignore", "Other record — exclude"],
                    ],
                    state.returnMeanings?.[index] || "",
                    true,
                  )}</div>`,
              )
              .join(
                "",
              )}<label class="pt-workspace-check"><input type="checkbox" name="statusMeaningsReviewed" required>I reviewed how every county status will be handled.</label><p>Only received voter IDs will upload. Voided and excluded rows preserve previous ballot history. Conflicting received/voided records will be counted in the review before upload.</p><button class="pt-btn pt-btn--secondary" type="submit" name="readStatuses" value="on" formnovalidate${busy ? " disabled" : ""}>Read status codes again</button></section>`
          : "";
      return `<form class="pt-card" data-ballot-form="prepare-review">${workflowLabel}<h2>${mode === "sent" ? "Review sent-ballot columns" : mode === "returns" ? "Review returned-ballot columns" : "Review county columns"}</h2>${sentReturnWarning}<p>${e(state.file.name)} · ${e(state.preview.delimiter)} · ${e(state.preview.encoding)}</p><div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr>${state.preview.headers.map((header) => `<th>${e(header)}</th>`).join("")}</tr></thead><tbody>${state.preview.sample.map((row) => `<tr>${row.map((value) => `<td>${e(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="pt-fields">${state.mode === "sent" ? '<input type="hidden" name="idColumn" value="VOTERID"><p>Official voter ID column: <strong>VOTERID</strong></p>' : select("idColumn", "Official voter ID column", choices, state.returnColumns?.idColumn || "", true)}${state.mode === "baseline" ? select("districtColumn", "Congressional district column", choices, "", true) + field("districtValue", "Exact district value", "", { required: true }) + select("partyColumn", "Party column", choices, "", true) + field("partyValue", "Exact party values (comma-separated)", "", { required: true, extra: 'placeholder="IND, PND"' }) : returnFields}</div><p>${state.mode === "returns" ? "Returns will match official IDs against every voter retained in this election, including voters already returned. Review status codes before matching; unmatched IDs will be excluded." : state.mode === "sent" ? "This election's sent additions are fixed to CONDIST 8, PARTY IND or PND, and BALSTATUS S. ELECTDATE must identify the selected election. X records are excluded. Blank or unfamiliar status codes stop preparation for review. Existing voter IDs will be skipped; all original master columns must be present." : "The district must match exactly and any one of the listed party values must match exactly. Separate party values with commas. No county codes are inferred."}</p><label class="pt-workspace-check"><input type="checkbox" name="headersReviewed" required>I confirmed this is the county header row and selected its official voter ID.</label>${statusMeanings}<div class="pt-actions">${submit(state.mode === "returns" ? (review ? "Match returns to this election" : "Read return statuses") : state.mode === "sent" ? "Prepare new eligible voters" : "Prepare matching voters")}${cancelButton}</div></form>`;
    }
    return `<form class="pt-card" data-ballot-form="prepare-source">${workflowLabel}<h2>${mode === "sent" ? "Upload sent-ballot file" : mode === "returns" ? "Upload returned-ballot file" : "Prepare the county sent-ballot file"}</h2>${mode === "returns" ? `<p>Use a county returned-ballot file to match received ballots to voters already on this list.${sentPolicyKey(context()) ? " Maricopa EV33 reports use R for received and X for voided. To add voters from an EV32 sent file with code S, cancel preparation and choose Upload sent-ballot file on the dashboard." : ""}</p>` : ""}${context().mode === "sent" ? "<p>Add only new CD8 IND/PND voters from a county sent-ballot report. This keeps the existing list and previous returns. Each prepared sent update supports at most 5,000 new voters and 5 MB, within this election's total voter and storage limits.</p>" : ""}<label class="pt-field"><span>County TXT, CSV or TSV file</span><input type="file" name="file" accept=".txt,.csv,.tsv" required></label><div class="pt-fields">${select(
      "delimiter",
      "File separator",
      [
        ["auto", "Detect comma, tab or pipe"],
        ["comma", "Comma"],
        ["tab", "Tab"],
        ["pipe", "Pipe"],
      ],
      "auto",
    )}${select(
      "encoding",
      "County file encoding",
      [
        ["utf-8", "UTF-8"],
        ["utf-16le", "UTF-16 little endian"],
        ["utf-16be", "UTF-16 big endian"],
        ["windows-1252", "Windows-1252"],
      ],
      "utf-8",
    )}</div><p>Review the county layout before choosing an encoding or separator. Fixed-width text needs a reviewed conversion. Files are prepared on this device before upload.</p><p>This election supports up to ${count(limits.maxRows)} retained voters, ${count(limits.maxOutputBytes / 1000000)} MB and ${count(limits.maxColumns)} source columns. If eligible voters exceed its capacity, ask an organization administrator for review; do not remove eligible voters to fit.</p>${submit("Read columns and preview")}</form>`;
  }
  return {
    inspect,
    prepare,
    ready,
    reviewReturns,
    render,
    reset,
    cancel,
    reportDate: (value) => {
      state.sourceAsOf = value;
    },
    state: () => state,
  };
}
