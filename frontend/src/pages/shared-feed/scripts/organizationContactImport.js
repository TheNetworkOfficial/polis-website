/** Stream delimited source rows without converting phone, ZIP, or identifier cells. */
export const CONTACT_IMPORT_MAX_ROWS = 1000000;
export const CONTACT_IMPORT_MAX_REQUEST_BYTES = 900000;
const encodedBytes = (value) => new TextEncoder().encode(value).byteLength;

export function assertContactImportHeaders(headers, columns) {
  if (!columns) return;
  const original = columns.map((column) =>
    typeof column === "object" ? column.header : column,
  );
  if (JSON.stringify(headers) !== JSON.stringify(original))
    throw new Error(
      "This file has different columns or column order. Reselect the original file to resume this import.",
    );
}
export async function* contactFileRows(
  file,
  delimiter = ",",
  encoding = "utf-8",
) {
  if (![",", "\t", "|"].includes(delimiter))
    throw new Error("Choose a supported file format.");
  const reader = file.stream().getReader();
  const decoder = new TextDecoder(encoding, { fatal: true });
  let row = [],
    cell = "",
    quoted = false,
    afterQuote = false,
    skipLf = false,
    start = true;
  let record = 1,
    recordCharacters = 0;
  try {
    let ended = false;
    while (!ended) {
      const next = await reader.read();
      ended = next.done;
      const chunk = ended
        ? decoder.decode()
        : decoder.decode(next.value, { stream: true });
      for (const char of chunk) {
        if (++recordCharacters > CONTACT_IMPORT_MAX_REQUEST_BYTES)
          throw new Error(
            `Record ${record} is too large for one import request. Import paused; no value was truncated.`,
          );
        if (start) {
          start = false;
          if (char === "\uFEFF") continue;
        }
        if (skipLf) {
          skipLf = false;
          if (char === "\n") continue;
        }
        if (quoted && !afterQuote) {
          if (char === '"') afterQuote = true;
          else cell += char;
          continue;
        }
        if (quoted && afterQuote && char === '"') {
          cell += '"';
          afterQuote = false;
          continue;
        }
        if (quoted && afterQuote) quoted = false;
        if (char === delimiter) {
          row.push(cell);
          cell = "";
          afterQuote = false;
        } else if (char === "\n" || char === "\r") {
          row.push(cell);
          yield row;
          row = [];
          cell = "";
          afterQuote = false;
          record++;
          recordCharacters = 0;
          skipLf = char === "\r";
        } else if (char === '"' && !cell && !afterQuote) quoted = true;
        else if (afterQuote || char === '"')
          throw new Error(`Check the quoted value on record ${record}.`);
        else cell += char;
      }
    }
    if (quoted && !afterQuote)
      throw new Error("The file ends inside a quoted value.");
    if (row.length || cell || afterQuote) {
      row.push(cell);
      yield row;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function previewContactFile(file, delimiter, encoding) {
  const rows = [];
  let headers;
  for await (const row of contactFileRows(file, delimiter, encoding)) {
    if (!headers) {
      headers = row;
      continue;
    }
    rows.push(row);
    if (rows.length === 8) break;
  }
  if (!headers?.length || !headers.some((value) => value.trim()))
    throw new Error("The file needs a header row.");
  if (headers.length > 512 || headers.some((value) => value.length > 500))
    throw new Error(
      "Use at most 512 columns with headers no longer than 500 characters. No columns were dropped.",
    );
  return { headers, rows };
}

/** Bound the read-only match sample to the same UTF-8 API budget as ingestion. */
export function boundedContactImportPreview(payload) {
  const result = { ...payload, rows: [] },
    encoder = new TextEncoder();
  if (
    encoder.encode(JSON.stringify(result)).byteLength >
    CONTACT_IMPORT_MAX_REQUEST_BYTES
  )
    throw new Error(
      "The source headers exceed the preview request limit. Shorten column headers before importing.",
    );
  for (const row of payload.rows.slice(0, 25)) {
    result.rows.push(row);
    if (
      encoder.encode(JSON.stringify(result)).byteLength >
      CONTACT_IMPORT_MAX_REQUEST_BYTES
    ) {
      result.rows.pop();
      if (!result.rows.length)
        throw new Error(
          "The first source record exceeds the preview request limit. Existing imports remain saved; review this record before continuing.",
        );
      break;
    }
  }
  return result;
}

/** Retrying an interrupted file uses the same operation IDs and row positions. */
export async function uploadSharedContactRows({
  file,
  delimiter,
  encoding,
  job,
  api,
  guard,
  progress,
}) {
  let headers,
    buffer = [],
    startRow = 0,
    bufferBytes = 0;
  const flush = async () => {
    if (!buffer.length) return;
    guard();
    const result = await api(
      `/imports/${encodeURIComponent(job.importId)}/rows`,
      {
        rows: buffer,
        startRow,
        operationId: `${job.operationId}:rows:${startRow}`,
      },
    );
    guard();
    startRow += buffer.length;
    buffer = [];
    bufferBytes = 0;
    progress({ ...result, processed: startRow });
  };
  for await (const row of contactFileRows(file, delimiter, encoding)) {
    if (!headers) {
      headers = row;
      assertContactImportHeaders(headers, job.columns);
      continue;
    }
    if (!row.some((value) => value !== "")) continue;
    if (row.length > headers.length)
      throw new Error(
        `Record ${startRow + buffer.length + 2} has more cells than its header. Import paused; existing rows remain saved.`,
      );
    if (startRow + buffer.length >= CONTACT_IMPORT_MAX_ROWS)
      throw new Error(
        `This file exceeds the supported ${CONTACT_IMPORT_MAX_ROWS.toLocaleString()} contact records. Import paused; existing rows remain saved.`,
      );
    const bytes = encodedBytes(JSON.stringify(row)) + 1;
    if (bytes + 2000 > CONTACT_IMPORT_MAX_REQUEST_BYTES)
      throw new Error(
        `Record ${startRow + buffer.length + 2} is too large for one import request. Import paused; no value was truncated.`,
      );
    if (
      buffer.length &&
      bufferBytes + bytes + 2000 > CONTACT_IMPORT_MAX_REQUEST_BYTES
    )
      await flush();
    buffer.push(row);
    bufferBytes += bytes;
    if (buffer.length === 100) await flush();
  }
  await flush();
  if (startRow < (Number(job.accepted) || 0) + (Number(job.conflicts) || 0))
    throw new Error(
      "This file is shorter than the records already saved. Reselect the original complete file to finish this import.",
    );
  guard();
  return api(`/imports/${encodeURIComponent(job.importId)}/complete`, {
    operationId: `${job.operationId}:complete`,
  });
}
