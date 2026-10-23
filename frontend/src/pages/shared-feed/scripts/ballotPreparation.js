import { checkedBallotDownload } from "./ballotExport";
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
const maxIdBytes = 10 * 1024 * 1024;

/** Browser-only preparation never uploads the original county file. */
export function createBallotPreparation({
  request,
  guard,
  changed,
  context,
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
    controller = new AbortController();
    const version = generation;
    state = {
      stage: "working",
      startedAt: Date.now(),
      file,
      format: {
        delimiter: data.get("delimiter") || "auto",
        encoding: data.get("encoding") || "utf-8",
      },
      binding: { ...ctx },
      mode: ctx.mode || (ctx.snapshotId ? "returns" : "baseline"),
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
      ctx.snapshotId !== saved.snapshotId
    )
      throw new Error(
        "The election or county report changed. Refresh and prepare this file again.",
      );
    if (state.mode === "returns" && !ctx.canExport)
      throw new Error(
        "Matching returns requires current export permission for this election.",
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
    const ctx = bound(),
      started = Date.now();
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
      result.export.rows > 50000
    )
      throw new Error(
        "The current voter list changed or exceeds 50,000 voters. Refresh and review the election.",
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
    const ids = await runWorker("ids", new Blob(chunks), {}, version);
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
  async function prepare(data) {
    if (!data.has("headersReviewed"))
      throw new Error(
        "Confirm the displayed header row and official voter ID column first.",
      );
    bound();
    const version = generation,
      idColumn = data.get("idColumn");
    if (!state.preview?.headers.includes(idColumn))
      throw new Error("Choose the county's official voter ID column.");
    const filters = [];
    if (state.mode === "baseline") {
      const district = data.get("districtColumn"),
        party = data.get("partyColumn");
      if (
        !state.preview.headers.includes(district) ||
        !state.preview.headers.includes(party) ||
        district === party ||
        !data.get("districtValue") ||
        !data.get("partyValue")
      )
        throw new Error(
          "Choose separate district and party columns and enter their exact county values.",
        );
      filters.push(
        { column: district, value: data.get("districtValue") },
        { column: party, value: data.get("partyValue") },
      );
    }
    state.stage = "working";
    state.startedAt = Date.now();
    changed();
    const deadline = setTimeout(() => controller.abort(), deadlineMs);
    try {
      const retained =
        state.mode === "returns" ? await retainedIds(version) : undefined;
      const prepared = await runWorker(
        "prepare",
        state.file,
        {
          ...state.format,
          delimiter: state.preview.delimiter,
          encoding: state.preview.encoding,
          idColumn,
          filters,
          mode: state.mode,
          ...(retained ? { retainedIds: retained } : {}),
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
  function ready() {
    guard();
    bound();
    if (state.stage !== "ready" || !state.prepared?.blob)
      throw new Error("Prepare and review the county file before uploading.");
    if (state.prepared.receipt.selectedRows < 1)
      throw new Error("No returns match this election. No update is needed.");
    return {
      file: new File([state.prepared.blob], "prepared-ballots.csv", {
        type: "text/csv",
      }),
      mode: state.mode,
      idColumn: state.mode === "returns" ? "Voter ID" : state.idColumn,
      snapshotId: state.binding.snapshotId,
      receipt: state.prepared.receipt,
    };
  }
  function render(busy = false) {
    if (!context().allowed)
      return notice(
        "Preparation unavailable",
        "County-file preparation is not enabled for this organization. Ask an organization administrator to check access.",
      );
    const submit = (text) =>
      `<button class="pt-btn" type="submit"${busy ? " disabled" : ""}>${e(text)}</button>`;
    const cancelButton =
      '<button class="pt-btn pt-btn--secondary" type="button" data-workspace-action="ballot-preparation-cancel">Cancel preparation</button>';
    if (state.stage === "working")
      return `<section class="pt-card" aria-label="County file preparation"><h2>Preparing county file</h2><progress aria-label="Preparation progress" ${state.progress?.inputBytes ? `value="${state.progress.bytesRead || 0}" max="${state.progress.inputBytes}"` : ""}></progress><p role="status">${e(state.progress?.phase || "Reading the county file")}${state.progress?.inputRows ? ` · ${count(state.progress.inputRows)} records checked` : ""}</p>${cancelButton}</section>`;
    if (state.stage === "ready") {
      const receipt = state.prepared.receipt;
      if (receipt.selectedRows === 0)
        return `<section class="pt-card"><h2>No matching returns</h2><p>${count(receipt.inputRows)} source records checked · ${count(receipt.unknownRows || 0)} rows outside this election · ${count(receipt.duplicateRows || 0)} repeated IDs removed.</p><p>No update is needed. No file was uploaded.</p>${cancelButton}</section>`;
      return `<form class="pt-card" data-ballot-form="prepare-upload"><h2>Review prepared ${state.mode === "returns" ? "returns" : "sent ballots"}</h2><p>${count(receipt.inputRows)} source records · ${count(receipt.selectedRows)} selected · ${count(receipt.excludedRows)} excluded</p><p>${count(receipt.duplicateRows || 0)} repeated IDs were removed.</p>${state.mode === "returns" ? `<p>${count(receipt.matchedUnique || receipt.selectedRows)} unique IDs matched this election; ${count(receipt.unknownRows || 0)} rows outside this election were excluded.</p>` : ""}<p>${(state.prepared.blob.size / 1000000).toFixed(2)} MB prepared. Only this list will upload. Official IDs and their leading zeroes are preserved.</p><p>Every selected row means <strong>${state.mode === "returns" ? "Returned" : "Issued"}</strong>. Missing voters keep their earlier status.</p>${state.binding.sourceAsOf ? `<p>Original report date: ${e(state.binding.sourceAsOf)}</p><input name="sourceAsOf" type="hidden" value="${e(state.binding.sourceAsOf)}">` : field("sourceAsOf", "Official report date and time", state.sourceAsOf || "", { type: "datetime-local", required: true })}<label class="pt-workspace-check"><input type="checkbox" name="preparedReviewed" required>I checked the selected count and this report's meaning.</label><div class="pt-actions">${submit("Upload prepared list and review columns")}${cancelButton}</div></form>`;
    }
    if (state.stage === "review") {
      const choices = [
        ["", "Choose a column"],
        ...state.preview.headers.map((header) => [header, header]),
      ];
      return `<form class="pt-card" data-ballot-form="prepare-review"><h2>Review county columns</h2><p>${e(state.file.name)} · ${e(state.preview.delimiter)} · ${e(state.preview.encoding)}</p><div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr>${state.preview.headers.map((header) => `<th>${e(header)}</th>`).join("")}</tr></thead><tbody>${state.preview.sample.map((row) => `<tr>${row.map((value) => `<td>${e(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="pt-fields">${select("idColumn", "Official voter ID column", choices, "", true)}${state.mode === "baseline" ? select("districtColumn", "Congressional district column", choices, "", true) + field("districtValue", "Exact district value", "", { required: true }) + select("partyColumn", "Party column", choices, "", true) + field("partyValue", "Exact party value", "", { required: true }) : ""}</div><p>${state.mode === "returns" ? "Returns will match official IDs against every voter retained in this election, including voters already returned. Unmatched IDs will be excluded." : "Both district and party values must match exactly. No county codes are inferred."}</p><label class="pt-workspace-check"><input type="checkbox" name="headersReviewed" required>I confirmed this is the county header row and selected its official voter ID.</label><div class="pt-actions">${submit(state.mode === "returns" ? "Match returns to this election" : "Prepare matching voters")}${cancelButton}</div></form>`;
    }
    return `<form class="pt-card" data-ballot-form="prepare-source"><h2>${context().snapshotId ? "Prepare a county returns file" : "Prepare the county sent-ballot file"}</h2><label class="pt-field"><span>County TXT, CSV or TSV file</span><input type="file" name="file" accept=".txt,.csv,.tsv" required></label><div class="pt-fields">${select(
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
    )}</div><p>Review the county layout before choosing an encoding or separator. Fixed-width text needs a reviewed conversion. Files are prepared on this device before upload.</p><p>The prepared list and this election's retained cohort must stay within 50,000 voters, 50 MB and 55 source columns.</p>${submit("Read columns and preview")}</form>`;
  }
  return {
    inspect,
    prepare,
    ready,
    render,
    reset,
    cancel,
    reportDate: (value) => {
      state.sourceAsOf = value;
    },
    state: () => state,
  };
}
