/** Mirrors backend importNames version 1; audit hashes are computed by the server. */
const object = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value);
const fail = (code) => {
  throw new Error(code);
};

export const IMPORT_NAME_VERSION = 1;
export const IMPORT_NAME_FORMATS = Object.freeze([
  "auto",
  "family_given",
  "given_family",
  "keep",
]);
export const NAME_PARTS = Object.freeze([
  "firstName",
  "middleName",
  "lastName",
]);
const present = (value) => typeof value === "string" && value.trim() !== "";
const populated = (value) =>
  value != null && (typeof value !== "string" || value.trim() !== "");
const clean = (value) => value.trim().replace(/\s+/gu, " ");
const comparable = (value) => clean(value).normalize("NFKC").toLowerCase();
const initial = (value) => /^\p{L}\p{M}*\.?$/u.test(value.normalize("NFC"));
const word = (value) =>
  /^[\p{L}\p{M}]+(?:['’.-][\p{L}\p{M}]+)*\.?$/u.test(value);
const suffix = (value) =>
  /^(?:jr|sr|ii|iii|iv|vi|esq|phd|md)$/u.test(
    value.toLowerCase().replace(/\./g, ""),
  );
const title = (value) =>
  /^(?:mr|mrs|ms|miss|dr|prof|rev)$/u.test(
    value.toLowerCase().replace(/\./g, ""),
  );

export function normalizeNamePolicy(input) {
  if (input === undefined)
    return { version: IMPORT_NAME_VERSION, format: "auto" };
  if (
    !object(input) ||
    input.version !== IMPORT_NAME_VERSION ||
    !IMPORT_NAME_FORMATS.includes(input.format) ||
    Object.keys(input).some((key) => !["version", "format"].includes(key))
  )
    fail("contact_import_name_policy_invalid");
  return { version: input.version, format: input.format };
}

function parseName(original, format) {
  const value = clean(original),
    tokens = value.split(/[\s,]+/u).filter(Boolean);
  if (
    !value ||
    value.length >
      600 /* eslint-disable-next-line no-control-regex -- Reject source control characters. */ ||
    /[&/+;{}[\]\d\u0000-\u001f]/u.test(value) ||
    /\b(?:and|or|household|family|estate|trust|trustee|trustees|unknown|unnamed|llc|inc|company|committee|association|foundation|church)\b/iu.test(
      value,
    )
  )
    return { reason: "household_or_ambiguous_name" };
  if (tokens.some(suffix) || tokens.some(title))
    return { reason: "suffix_or_title_requires_review" };
  if (
    tokens.some(
      (token) =>
        !word(token) || /^(?:\p{L}\p{M}*\.){2,}$/u.test(token.normalize("NFC")),
    )
  )
    return { reason: "ambiguous_name_tokens" };
  let firstName, middleName, lastName;
  if (format === "family_given") {
    const halves = value.split(",");
    if (halves.length !== 2 || halves.some((part) => !part.trim()))
      return { reason: "family_given_comma_required" };
    lastName = clean(halves[0]);
    if (/\s+v\.?$/iu.test(lastName))
      return { reason: "suffix_or_title_requires_review" };
    const given = clean(halves[1]).split(" "),
      middle = [];
    while (given.length && initial(given.at(-1))) middle.unshift(given.pop());
    if (!given.length) return { reason: "given_name_is_initial_only" };
    firstName = given.join(" ");
    if (middle.length) middleName = middle.join(" ");
  } else {
    if (value.includes(",")) return { reason: "given_family_has_comma" };
    if (tokens.length < 2) return { reason: "name_parts_missing" };
    if (tokens.length > 2 && !tokens.slice(1, -1).every(initial))
      return { reason: "ambiguous_multipart_name" };
    [firstName] = tokens;
    lastName = tokens.at(-1);
    if (tokens.length > 2) middleName = tokens.slice(1, -1).join(" ");
  }
  if (firstName.split(" ").every(initial))
    return { reason: "given_name_is_initial_only" };
  if (lastName.split(" ").every(initial))
    return { reason: "family_name_is_initial_only" };
  return {
    parts: { firstName, ...(middleName ? { middleName } : {}), lastName },
    reason:
      format === "family_given"
        ? "comma_family_given"
        : "confirmed_given_family",
  };
}

function compatible(parts, fields) {
  if (
    NAME_PARTS.some(
      (field) => populated(fields[field]) && typeof fields[field] !== "string",
    )
  )
    return false;
  const supplied = Object.fromEntries(
    NAME_PARTS.filter((field) => present(fields[field])).map((field) => [
      field,
      fields[field],
    ]),
  );
  if (
    supplied.lastName &&
    comparable(supplied.lastName) !== comparable(parts.lastName)
  )
    return false;
  // Explicit first + middle may divide a full given block differently. Preserve
  // both and infer the family name only when their complete given block agrees.
  if (
    supplied.firstName &&
    supplied.middleName &&
    comparable(`${supplied.firstName} ${supplied.middleName}`) ===
      comparable(`${parts.firstName} ${parts.middleName || ""}`)
  )
    return true;
  for (const field of ["firstName", "middleName"])
    if (
      supplied[field] &&
      (!parts[field] ||
        comparable(supplied[field]) !== comparable(parts[field]))
    )
      return false;
  return true;
}

/** Pure proposals depend only on the original mapped row and pinned policy.
 * Existing contact values are considered separately inside the write transaction. */
export function deriveImportNames(fields, policyInput) {
  const policy = normalizeNamePolicy(policyInput),
    output = { ...fields };
  const sourceField = present(fields.fullName)
    ? "fullName"
    : present(fields.displayName)
      ? "displayName"
      : null;
  const original = sourceField ? fields[sourceField] : "";
  const analysis = {
    version: policy.version,
    format: policy.format,
    sourceField,
    original,
    status: "kept",
    reason: "no_full_name",
    proposed: {},
    suggestedFormat: "keep",
  };
  const result = { fields: output, derivations: {}, analysis };
  if (!sourceField) {
    if (NAME_PARTS.some((field) => populated(fields[field])))
      Object.assign(analysis, {
        status: "explicit",
        reason: "explicit_name_parts",
      });
    return result;
  }
  if (
    present(fields.displayName) &&
    present(fields.fullName) &&
    comparable(fields.displayName) !== comparable(fields.fullName)
  ) {
    Object.assign(analysis, {
      status: "ambiguous",
      reason: "conflicting_full_names",
    });
    return result;
  }
  const inferredFormat = original.includes(",")
    ? "family_given"
    : "given_family";
  const inferred = parseName(original, inferredFormat);
  if (inferred.parts && compatible(inferred.parts, fields))
    analysis.suggestedFormat = inferredFormat;
  if (policy.format === "keep") {
    analysis.reason = "keep_original_selected";
    return result;
  }
  const selectedFormat =
    policy.format === "auto" ? "family_given" : policy.format;
  const parsed = parseName(original, selectedFormat);
  if (policy.format === "auto" && !original.includes(",")) {
    Object.assign(analysis, {
      status: "ambiguous",
      reason: inferred.parts ? "format_confirmation_required" : inferred.reason,
    });
    return result;
  }
  if (!parsed.parts) {
    Object.assign(analysis, { status: "ambiguous", reason: parsed.reason });
    return result;
  }
  if (!compatible(parsed.parts, fields)) {
    Object.assign(analysis, {
      status: "ambiguous",
      reason: "explicit_name_parts_conflict",
    });
    return result;
  }
  const additions = NAME_PARTS.filter(
    (field) => !populated(fields[field]) && parsed.parts[field],
  );
  if (
    Object.keys(fields).length +
      additions.filter((field) => !Object.hasOwn(fields, field)).length >
    512
  ) {
    Object.assign(analysis, {
      status: "ambiguous",
      reason: "name_field_limit",
    });
    return result;
  }
  for (const field of additions) {
    output[field] = parsed.parts[field];
    analysis.proposed[field] = parsed.parts[field];
    result.derivations[field] = {
      version: policy.version,
      format: selectedFormat,
      sourceField,
      origin: "derived",
    };
  }
  Object.assign(analysis, {
    status: Object.keys(result.derivations).length ? "derived" : "explicit",
    reason: parsed.reason,
  });
  return result;
}

/** A generated value can fill a blank imported cell, but never replace a
 * stored name or undo a person's deliberate manual/canvassing clear. */
export function canApplyDerivedName(contact, field) {
  if (!NAME_PARTS.includes(field) || populated(contact?.fields?.[field]))
    return false;
  return !["manual", "canvassing"].includes(
    contact?.fieldEvidence?.[field]?.kind,
  );
}

export function storedNamesAllowDerivation(contact, proposedFields) {
  return !contact || compatible(proposedFields, contact.fields || {});
}

export function analyzeImportNames(analyses, policyInput) {
  const policy = normalizeNamePolicy(policyInput);
  const counts = {
    rows: analyses.length,
    derived: 0,
    ambiguous: 0,
    explicit: 0,
    preserved: 0,
    kept: 0,
  };
  const formats = new Set();
  for (const row of analyses) {
    if (Object.hasOwn(counts, row.status)) counts[row.status]++;
    if (row.suggestedFormat !== "keep") formats.add(row.suggestedFormat);
  }
  return {
    version: policy.version,
    sampleOnly: true,
    format: policy.format,
    suggestedFormat: formats.size === 1 ? [...formats][0] : "keep",
    counts,
    examples: analyses.slice(0, 8).map((row, index) => ({
      row: row.row ?? index,
      original: row.original,
      ...(row.effective || row.proposed),
      status: row.status,
      reason: row.reason,
    })),
    reasons: [...new Set(analyses.map((row) => row.reason))],
  };
}
