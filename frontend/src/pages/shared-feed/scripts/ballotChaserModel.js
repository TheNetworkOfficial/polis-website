export const ballotStatuses = [
  "not_requested",
  "requested",
  "issued",
  "returned",
  "accepted",
  "cure_required",
  "rejected",
  "cancelled",
  "unknown",
];

export const ballotViews = Object.freeze({
  outstanding: "Outstanding",
  newly_returned: "Newly returned",
  returned: "Returned",
  needs_followup: "Needs follow-up",
  all: "All voters",
});

export const ballotAddCountyField = "__ballot_add_county_field__";

export function ballotImportStatus(status) {
  const captions = {
    uploading: "Upload file",
    inspecting: "Reading file",
    awaiting_mapping: "Review columns",
    reviewing: "Checking county update",
    review_ready: "Ready to apply",
    needs_review: "Needs review",
    applying: "Publishing update",
    complete: "Update complete",
    failed: "Update paused",
    cancelled: "Update cancelled",
  };
  return Object.hasOwn(captions, status) ? captions[status] : "Check progress";
}

/** A saved upload can be waiting for a person rather than using server time. */
export function ballotImportPhase(job) {
  if (job?.boundedHeld || job?.status === "needs_review")
    return "Needs attention";
  if (job?.status === "awaiting_mapping") return "Waiting for your review";
  if (["inspecting", "reviewing", "applying"].includes(job?.status))
    return "Processing";
  if (job?.status === "review_ready")
    return Number(job.counts?.conflicts) > 0
      ? "Waiting for your review"
      : "Ready to apply";
  if (job?.status === "complete") return "Complete";
  return ballotImportStatus(job?.status);
}

/** County report dates and later recovery never change when a file was uploaded. */
export function ballotImportHistoryNewestFirst(items) {
  const uploaded = (job) =>
    typeof job?.createdAt === "string" ? Date.parse(job.createdAt) : NaN;
  return [...items].sort((left, right) => {
    const leftDate = uploaded(left),
      rightDate = uploaded(right),
      leftKnown = Number.isFinite(leftDate),
      rightKnown = Number.isFinite(rightDate);
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    if (leftKnown && leftDate !== rightDate) return rightDate - leftDate;
    const leftId = String(left?.importId || ""),
      rightId = String(right?.importId || "");
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

/** Partial comparison counts must not look like a completed source-file count. */
export function ballotImportHistoryRecordCount(job) {
  const known = (value) => Number.isSafeInteger(value) && value >= 0;
  for (const value of [job?.totalRows, job?.rowCount])
    if (known(value)) return value;
  return job?.status === "complete" && known(job.counts?.rows)
    ? job.counts.rows
    : null;
}

/** Daily county reports use a calendar date, independent of the viewer's zone. */
export function ballotImportHistoryReportDate(value) {
  const date = typeof value === "string" ? new Date(value) : null;
  return !date || Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
}

/** Read metadata only, within the existing 20-page safety bound per user action. */
export async function collectBallotImportHistory(
  loadPage,
  { items = [], cursor = null, guard = () => {}, maxPages = 20 } = {},
) {
  const saved = new Map(items.map((job) => [job.importId, job])),
    seen = new Set(cursor ? [cursor] : []),
    pages = Math.min(20, Math.max(1, maxPages));
  let nextCursor = cursor;
  for (let page = 0; page < pages; page++) {
    guard();
    let result;
    try {
      result = await loadPage(nextCursor);
    } catch (error) {
      guard();
      if ([401, 403].includes(error.status || error.statusCode)) throw error;
      return { items: [...saved.values()], nextCursor, incomplete: true };
    }
    guard();
    for (const job of Array.isArray(result.items) ? result.items : [])
      saved.set(job.importId, job);
    nextCursor = result.nextCursor || null;
    if (!nextCursor)
      return {
        items: [...saved.values()],
        nextCursor: null,
        incomplete: false,
      };
    if (seen.has(nextCursor)) break;
    seen.add(nextCursor);
  }
  return { items: [...saved.values()], nextCursor, incomplete: true };
}

/** Match the existing bounded admission policy without trapping expired work. */
export function unfinishedBallotUpload(job, maxAgeMs = 86400000) {
  if (
    !job?.importId ||
    !job.status ||
    job.boundedHeld ||
    ["complete", "ready", "cancelled", "failed", "needs_review"].includes(
      job.status,
    )
  )
    return false;
  const created = Date.parse(job.createdAt);
  return !Number.isFinite(created) || Date.now() - created < maxAgeMs;
}

/** Server policy failures expose a useful next step without internal job details. */
export function ballotPreparationMessage(error) {
  const code =
    typeof error === "string"
      ? error
      : error?.payload?.error || error?.code || error?.message;
  const messages = {
    ballot_preparation_usage_limit:
      "This organization has reached its county-file processing limit. Ask an organization administrator to review usage before starting another update.",
    ballot_preparation_job_active:
      "An unfinished county-file operation needs attention. Resume the existing upload or check the current voter-ID export before starting another file.",
    ballot_preparation_job_busy:
      "This county-file job is being processed. Check its progress before making changes.",
    ballot_preparation_admission_changed:
      "County-file activity changed. Check current progress before trying this action again.",
    ballot_preparation_work_limit:
      "This saved update reached its processing safety limit. Polis support must review it before processing can continue. Retrying does not reset the limit. Keep this upload in place; the last published list remains available.",
    ballot_preparation_processing_failed:
      "Processing stopped before this update could be published. Your uploaded file and review are saved. Keep this upload in place for Polis support to recover; do not upload the same file again. The last published list remains available.",
    ballot_preparation_cohort_limit:
      "This change exceeds this organization's controlled election, retained-voter or storage capacity. The published list remains available. Ask an organization administrator to review capacity before another update.",
    ballot_sent_updates_unavailable:
      "Daily sent-ballot additions are not enabled for this election. Refresh Ballot Chaser and check the selected election.",
    ballot_sent_source_limit:
      "This prepared sent-ballot update exceeds the 5 MB limit. The published list is unchanged. Ask an organization administrator to review capacity.",
    ballot_sent_columns_invalid:
      "The sent-ballot file must contain the same county columns as the original master, including VOTERID, CONDIST, PARTY, BALSTATUS and ELECTDATE. Choose the correct county sent report and prepare it again.",
    ballot_sent_voter_review:
      "A new voter does not match this election's CD8 IND/PND sent-ballot selection. The published list is unchanged. Review the selected county file and its election date before continuing.",
    ballot_preparation_history_review:
      "The saved county-update history needs review. The published list remains unchanged; do not start over or re-upload the master.",
    ballot_snapshot_out_of_order:
      "Check the county report date against the latest report for this file type. Do not invent a later date or time. The published list remains unchanged.",
    ballot_preparation_unavailable:
      "County-file preparation is not enabled for this organization. Ask an organization administrator to review access.",
    ballot_preparation_policy_required:
      "This election cannot use prepared-file updates. Ask an organization administrator to review the election.",
    ballot_preparation_input_invalid:
      "The prepared CSV or TSV exceeds this election's approved file or voter capacity. Ask an organization administrator to review capacity; do not remove eligible voters to fit.",
    ballot_preparation_columns_limit:
      "The prepared file exceeds the supported county-column limits. Review its columns with an organization administrator.",
    ballot_preparation_export_limit:
      "This export exceeds the supported voter-list limit. Ask an organization administrator to review the election.",
  };
  if (Object.hasOwn(messages, code)) return messages[code];
  return typeof code === "string" && code.startsWith("ballot_preparation_")
    ? "This county-file update needs an organization administrator's review. The last published list remains available."
    : null;
}

export function ballotImportControls(job, editingMapping = false) {
  const mutable = Boolean(job) && !job.boundedHeld;
  return {
    advance:
      mutable &&
      !["complete", "cancelled", "failed", "awaiting_mapping"].includes(
        job?.status,
      ) &&
      !editingMapping,
    apply: mutable && job?.status === "review_ready" && !editingMapping,
    remap:
      mutable &&
      ["reviewing", "review_ready", "needs_review"].includes(job?.status) &&
      !editingMapping,
    mapping: mutable && (job?.status === "awaiting_mapping" || editingMapping),
  };
}

/** Empty choices retain raw evidence without creating volatile contact fields. */
export function ballotContactColumns(headers, choices = {}) {
  return {
    fieldMapping: Object.fromEntries(
      headers
        .filter(
          (header) =>
            choices[header] && choices[header] !== ballotAddCountyField,
        )
        .map((header) => [header, choices[header]]),
    ),
    sourceOnlyColumns: headers.filter((header) => !choices[header]),
  };
}

export function ballotReportDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "No published update"
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
}
export const ballotStatusLabels = Object.freeze({
  not_requested: "Not requested",
  requested: "Requested",
  issued: "Issued / not returned",
  returned: "Returned",
  accepted: "Accepted",
  cure_required: "Needs cure",
  rejected: "Rejected",
  cancelled: "Cancelled",
  unknown: "Unknown",
});

/** A manager explicitly reviews source use; permission never implies consent. */
export function ballotSourceUsePolicy(purpose = "unreviewed") {
  if (
    !["unreviewed", "manual_sms", "sms_with_opt_in", "not_for_sms"].includes(
      purpose,
    )
  )
    throw new Error("Choose a valid source-use policy.");
  return {
    permittedPurpose: purpose,
    reviewRequired: purpose === "unreviewed",
    requiresOptIn: purpose === "sms_with_opt_in",
    smsProhibited: purpose === "not_for_sms",
  };
}

/** Election targeting stays fixed while ordinary Contact Book filters narrow it. */
export function ballotChaseContext(
  electionId,
  snapshotId,
  view = "outstanding",
  dates = {},
) {
  if (
    typeof electionId !== "string" ||
    !electionId.trim() ||
    typeof snapshotId !== "string" ||
    !snapshotId.trim()
  )
    throw new Error(
      "Finish a ballot update before selecting an outreach list.",
    );
  if (!Object.hasOwn(ballotViews, view))
    throw new Error("Choose a ballot list.");
  return {
    electionId,
    snapshotId,
    view,
    ...(view === "outstanding" ? { outstandingOnly: true } : {}),
    ...(dates.sourceAsOf ? { sourceAsOf: dates.sourceAsOf } : {}),
    ...(dates.previousSourceAsOf
      ? { previousSourceAsOf: dates.previousSourceAsOf }
      : {}),
  };
}

export function ballotFileFormat(name) {
  const extension = String(name || "")
    .split(".")
    .at(-1)
    .toLowerCase();
  if (!["csv", "tsv", "xlsx"].includes(extension))
    throw new Error("Choose a CSV, TSV, or Excel (.xlsx) file.");
  return extension;
}

/** Signed uploads never receive Polis credentials, cookies, or redirected bytes. */
export async function uploadBallotFile(
  file,
  upload,
  { guard, transport = fetch, progress = () => {} },
) {
  guard();
  const url = new URL(upload?.url || "");
  const headers = upload?.headers || {};
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !/^[a-z0-9][a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/i.test(
      url.hostname,
    ) ||
    upload.method !== "PUT" ||
    Object.keys(headers).some((key) =>
      ["authorization", "cookie", "host"].includes(key.toLowerCase()),
    )
  )
    throw new Error("The protected upload destination could not be verified.");
  progress({ loaded: 0, total: file.size });
  const response = await transport(url.href, {
    method: "PUT",
    headers,
    body: file,
    credentials: "omit",
    redirect: "error",
  });
  guard();
  if (!response.ok)
    throw new Error("Upload paused. Reselect the original file and resume.");
  progress({ loaded: file.size, total: file.size });
  return response;
}

/** Resume from storage-confirmed parts; at most two file ranges are in flight. */
export async function uploadBallotParts(
  file,
  upload,
  { guard, transport = fetch, progress = () => {} },
) {
  guard();
  if (upload?.method === "COMPLETE" && upload.completed === true) return null;
  const size = upload?.partSizeBytes;
  if (
    upload?.method !== "MULTIPART" ||
    !upload.uploadId ||
    !Number.isSafeInteger(size) ||
    size < 5 * 1024 * 1024 ||
    !Array.isArray(upload.parts) ||
    !Array.isArray(upload.completedParts)
  )
    throw new Error("The resumable upload could not be verified.");
  const expected = Math.ceil(file.size / size),
    receipts = new Map(),
    pending = new Map();
  const partSize = (number) => Math.min(size, file.size - (number - 1) * size);
  for (const part of [...upload.completedParts, ...upload.parts]) {
    if (
      !Number.isSafeInteger(part.partNumber) ||
      part.partNumber < 1 ||
      part.partNumber > expected ||
      part.sizeBytes !== partSize(part.partNumber) ||
      receipts.has(part.partNumber) ||
      pending.has(part.partNumber)
    )
      throw new Error("The upload parts do not match the original file.");
    if (upload.completedParts.includes(part)) {
      if (typeof part.etag !== "string" || !part.etag)
        throw new Error("An uploaded part could not be confirmed.");
      receipts.set(part.partNumber, {
        partNumber: part.partNumber,
        etag: part.etag,
      });
    } else pending.set(part.partNumber, part);
  }
  if (receipts.size + pending.size !== expected)
    throw new Error("Some file parts are missing. Resume the original upload.");
  let loaded = [...receipts.keys()].reduce(
      (sum, number) => sum + partSize(number),
      0,
    ),
    next = 0,
    stopped = false;
  progress({ loaded, total: file.size });
  const parts = [...pending.values()];
  async function worker() {
    try {
      while (!stopped && next < parts.length) {
        const part = parts[next++];
        guard();
        const response = await uploadBallotFile(
          file.slice((part.partNumber - 1) * size, part.partNumber * size),
          { url: part.url, method: "PUT", headers: part.headers || {} },
          { guard, transport },
        );
        guard();
        const etag = response.headers?.get?.("etag");
        if (!etag)
          throw new Error(
            "The uploaded part receipt was not returned. Resume to verify saved parts.",
          );
        receipts.set(part.partNumber, { partNumber: part.partNumber, etag });
        loaded += part.sizeBytes;
        progress({ loaded, total: file.size });
      }
    } catch (error) {
      stopped = true;
      throw error;
    }
  }
  const results = await Promise.allSettled([worker(), worker()]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  guard();
  return {
    uploadId: upload.uploadId,
    parts: [...receipts.values()].sort((a, b) => a.partNumber - b.partNumber),
  };
}

export const ballotChasingPreset = Object.freeze({
  id: "ballot_chasing",
  name: "Ballot chasing",
  questions: [
    {
      id: "ballot_status",
      prompt: "What did they say about their ballot?",
      type: "single",
      required: true,
      choices: [
        "Already returned",
        "Have ballot, not returned",
        "Not received / need replacement",
        "Unsure",
        "Declined",
      ],
    },
    {
      id: "ballot_follow_up",
      prompt: "What follow-up would help?",
      type: "single",
      required: false,
      choices: [
        "None requested",
        "Return/drop-off information",
        "Election-office help",
        "Follow-up requested",
        "Not discussed",
      ],
    },
    {
      id: "ballot_notes",
      prompt: "Notes",
      type: "text",
      required: false,
      choices: [],
    },
  ],
});

/** Appending a preset preserves existing round questions and stable answer keys. */
export function addBallotChasingPreset(questions = []) {
  const ids = new Set(questions.map((question) => question.id));
  const additions = ballotChasingPreset.questions.filter(
    (question) => !ids.has(question.id),
  );
  if (questions.length + additions.length > 40)
    throw new Error(
      "This round supports at most 40 questions. Remove a question before adding this preset.",
    );
  return [...structuredClone(questions), ...structuredClone(additions)];
}

export function validateQuestionAnswers(
  questions,
  answers,
  { conversation = true } = {},
) {
  const result = {};
  for (const question of questions || []) {
    const value = answers?.[question.id];
    const empty =
      value == null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (conversation && question.required)
        throw new Error(
          `Answer “${question.prompt}” before saving the conversation.`,
        );
      continue;
    }
    if (question.type === "multi") {
      if (
        !Array.isArray(value) ||
        value.some((item) => !question.choices.includes(item))
      )
        throw new Error(`Review the answer to “${question.prompt}”.`);
      result[question.id] = [...new Set(value)];
    } else {
      if (
        typeof value !== "string" ||
        value.length > 2000 ||
        (question.type !== "text" && !question.choices.includes(value))
      )
        throw new Error(`Review the answer to “${question.prompt}”.`);
      result[question.id] = value;
    }
  }
  if (
    Object.keys(answers || {}).some(
      (key) => !(questions || []).some((question) => question.id === key),
    )
  )
    throw new Error("The round questions changed. Reload them before saving.");
  return result;
}
