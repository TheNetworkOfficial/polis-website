/** Shared contact values stay typed. Identifiers, ZIP codes, and raw import cells stay strings. */
export function contactValue(contact, field) {
  const key = typeof field === "string" ? field : field.fieldId || field.id;
  if (key.startsWith("tag_group:")) {
    const members = new Set(
      (contact.tagIds || contact.tags || []).map(
        (tag) => tag.tagId || tag.id || tag,
      ),
    );
    return (field.memberTags || [])
      .filter((tag) => members.has(tag.tagId))
      .map((tag) => tag.label);
  }
  if (key.startsWith("tag:"))
    return (contact.tagIds || contact.tags || []).some(
      (tag) => (tag.tagId || tag.id || tag) === key.slice(4),
    );
  if (Object.hasOwn(contact.customFields || {}, key))
    return contact.customFields[key];
  if (Object.hasOwn(contact.fields || {}, key)) return contact.fields[key];
  return key.split(".").reduce((value, part) => value?.[part], contact);
}

export function displayContactValue(value) {
  if (value == null || value === "") return "Not recorded";
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (Array.isArray(value))
    return value.length
      ? value.map(displayContactValue).join(" · ")
      : "Not recorded";
  if (typeof value === "object") {
    if (value.status === "restricted") return "Restricted";
    if (value.status === "not_shared") return "Not shared";
    if (Object.hasOwn(value, "value")) return displayContactValue(value.value);
    return (
      value.label ||
      value.name ||
      value.phone ||
      value.email ||
      value.number ||
      [
        value.line1 || value.addressLine1,
        value.line2 || value.addressLine2,
        value.city,
        value.state,
        value.postalCode,
      ]
        .filter(Boolean)
        .join(", ") ||
      Object.entries(value)
        .map(([key, item]) => `${key}: ${displayContactValue(item)}`)
        .join(" · ")
    );
  }
  return String(value);
}

/** CSV/TSV parsing preserves quoted newlines, duplicate headers, empty cells, and leading zeros. */
export function parseContactDelimitedText(text, delimiter = ",") {
  if (![",", "\t", "|"].includes(delimiter))
    throw new Error("Choose a supported file format.");
  const input = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    value = "",
    quoted = false,
    closed = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        value += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else value += char;
    } else if (char === '"' && !value && !closed) quoted = true;
    else if (char === delimiter) {
      row.push(value);
      value = "";
      closed = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      closed = false;
    } else if (closed || char === '"')
      throw new Error(
        `Unexpected text after a quoted value on record ${rows.length + 1}.`,
      );
    else value += char;
  }
  if (quoted)
    throw new Error(
      "The file ends inside a quoted value. Check the export and try again.",
    );
  if (row.length || value || closed) {
    row.push(value);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  if (!headers.length || !headers.some((value) => value.trim()))
    throw new Error("The file needs a header row.");
  const records = rows.filter((row) => row.some((value) => value !== ""));
  for (let index = 0; index < records.length; index++) {
    if (records[index].length > headers.length)
      throw new Error(
        `Record ${index + 2} contains more values than the header. No contacts have been imported.`,
      );
    while (records[index].length < headers.length) records[index].push("");
  }
  return { headers, rows: records };
}

export function typedContactInput(value, definition) {
  if (value === "") return null;
  const type = definition?.type || "text";
  if (["boolean", "tri_state"].includes(type))
    return value === "true" ? true : value === "false" ? false : null;
  if (type === "number") {
    const result = Number(value);
    if (!Number.isFinite(result))
      throw new Error(`Enter a number for ${definition.label}.`);
    return result;
  }
  if (["multi_choice", "multiple_choice", "multiselect", "tags"].includes(type))
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  if (
    ["json", "address", "jurisdiction", "structured", "repeated"].includes(type)
  ) {
    try {
      const parsed = JSON.parse(value, (key, item) => {
        if (typeof item === "number" && !Number.isFinite(item))
          throw new Error("Non-finite number");
        return item;
      });
      if (
        ["address", "jurisdiction"].includes(type) &&
        (parsed === null || typeof parsed !== "object")
      )
        throw new Error("Use a JSON object or array");
      if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 65536)
        throw new Error("Value is too large");
      return parsed;
    } catch {
      throw new Error(`Check the structured value for ${definition.label}.`);
    }
  }
  return value;
}

export function contactFilterValue(value, definition, operator) {
  const multipleChoice = [
    "multi_choice",
    "multiple_choice",
    "multiselect",
    "tags",
  ].includes(definition?.type);
  if (["in", "not_in"].includes(operator))
    return String(value)
      .split(",")
      .map((item) =>
        typedContactInput(
          item.trim(),
          multipleChoice ? { ...definition, type: "text" } : definition,
        ),
      );
  return typedContactInput(
    String(value),
    multipleChoice && ["eq", "neq", "contains"].includes(operator)
      ? { ...definition, type: "text" }
      : definition,
  );
}

/** Neutralize spreadsheet formulas in a download without changing retained source values. */
export function contactCsvCell(value) {
  let text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  let first = 0;
  while (
    first < text.length &&
    (text.charCodeAt(first) < 32 || /\s/u.test(text[first]))
  )
    first++;
  if (["=", "+", "-", "@"].includes(text[first])) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
