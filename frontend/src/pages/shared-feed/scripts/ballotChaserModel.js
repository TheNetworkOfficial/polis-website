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
export function ballotChaseContext(electionId, snapshotId) {
  if (
    typeof electionId !== "string" ||
    !electionId.trim() ||
    typeof snapshotId !== "string" ||
    !snapshotId.trim()
  )
    throw new Error(
      "Finish a ballot update before selecting an outreach list.",
    );
  return { electionId, snapshotId, outstandingOnly: true };
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
  { guard, transport = fetch },
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
