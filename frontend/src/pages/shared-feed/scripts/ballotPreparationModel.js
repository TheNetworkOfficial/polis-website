/** Local, bounded preparation of county files. No source data leaves this module. */
export const BALLOT_PREPARATION_LIMITS = Object.freeze({
  maxInputBytes: 512 * 1024 * 1024,
  maxOutputBytes: 50000000,
  maxRows: 50000,
  maxColumns: 55,
  maxRecordBytes: 60000,
  maxFieldBytes: 60000,
  maxElapsedMs: 10 * 60 * 1000,
  chunkBytes: 256 * 1024,
});

const DELIMITERS = { comma: ",", tab: "\t", pipe: "|" };
const ENCODINGS = new Set(["utf-8", "utf-16le", "utf-16be", "windows-1252"]);
const encoder = new TextEncoder();

function fail(message, code = "ballot_preparation_invalid") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/** Only lower limits are accepted, making small deterministic boundary tests safe. */
function context(file, options) {
  const limits = { ...BALLOT_PREPARATION_LIMITS };
  for (const [key, value] of Object.entries(options.limits || {})) {
    if (
      !Object.hasOwn(limits, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[key]
    )
      fail("Preparation limits must stay within the supported file limits.");
    limits[key] = value;
  }
  if (
    !file ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    typeof file.slice !== "function"
  )
    fail("Choose a nonempty county file.");
  if (file.size > limits.maxInputBytes)
    fail(
      "The source file exceeds the 512 MiB preparation limit.",
      "ballot_preparation_input_limit",
    );
  const encoding = String(options.encoding || "utf-8").toLowerCase();
  if (!ENCODINGS.has(encoding))
    fail("Choose UTF-8, UTF-16LE, UTF-16BE, or Windows-1252 encoding.");
  const delimiter = options.delimiter || "auto";
  if (delimiter !== "auto" && !Object.hasOwn(DELIMITERS, delimiter))
    fail("Choose comma, tab, or pipe separated input.");
  const startedAt = Date.now();
  const state = {
    limits,
    encoding,
    delimiter,
    bytesRead: 0,
    inputBytes: file.size,
    startedAt,
  };
  state.check = () => {
    if (options.signal?.aborted) {
      const error = new Error("File preparation was cancelled.");
      error.name = "AbortError";
      error.code = "ballot_preparation_cancelled";
      throw error;
    }
    if (Date.now() - startedAt > limits.maxElapsedMs)
      fail(
        "File preparation exceeded ten minutes. Prepare a smaller county file.",
        "ballot_preparation_timeout",
      );
  };
  state.progress = (extra = {}) => {
    state.check();
    options.onProgress?.({
      bytesRead: state.bytesRead,
      inputBytes: state.inputBytes,
      ...extra,
    });
  };
  state.check();
  return state;
}

function byteWidth(character, previousHighSurrogate = false) {
  const value = character.charCodeAt(0);
  if (value >= 0xdc00 && value <= 0xdfff && previousHighSurrogate) return 1;
  return value < 0x80 ? 1 : value < 0x800 ? 2 : 3;
}

function highSurrogate(character) {
  const value = character.charCodeAt(0);
  return value >= 0xd800 && value <= 0xdbff;
}

/** Decoder state survives chunk boundaries; the original Blob is never buffered. */
async function* decodedChunks(file, state) {
  const decoder = new TextDecoder(state.encoding, { fatal: true });
  // Three bytes suffice to identify every supported BOM, even with tiny test chunks.
  const first = new Uint8Array(
    await file.slice(0, Math.min(3, file.size)).arrayBuffer(),
  );
  state.check();
  const bom =
    first[0] === 0xef && first[1] === 0xbb && first[2] === 0xbf
      ? "utf-8"
      : first[0] === 0xff && first[1] === 0xfe
        ? "utf-16le"
        : first[0] === 0xfe && first[1] === 0xff
          ? "utf-16be"
          : null;
  if (bom && bom !== state.encoding)
    fail(
      "The file's byte order mark does not match the chosen encoding. Choose the matching encoding.",
    );
  try {
    for (
      let offset = 0;
      offset < file.size;
      offset += state.limits.chunkBytes
    ) {
      state.check();
      const bytes = await file
        .slice(offset, Math.min(file.size, offset + state.limits.chunkBytes))
        .arrayBuffer();
      state.check();
      state.bytesRead = Math.min(file.size, offset + state.limits.chunkBytes);
      yield decoder.decode(bytes, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } catch (error) {
    if (error instanceof TypeError)
      fail(
        "The file cannot be read using the chosen encoding. Review its encoding and try again.",
        "ballot_preparation_encoding",
      );
    throw error;
  }
}

/** Strict RFC-style quoted records, including multiline fields and split quotes/CRLF. */
function recordParser(delimiter, state, onRow) {
  let fields = [],
    field = "",
    mode = "start",
    recordBytes = 0,
    fieldBytes = 0,
    recordHighSurrogate = false,
    fieldHighSurrogate = false,
    touched = false,
    skipLF = false;
  const append = (character) => {
    fieldBytes += byteWidth(character, fieldHighSurrogate);
    fieldHighSurrogate = highSurrogate(character);
    if (fieldBytes > state.limits.maxFieldBytes)
      fail("A county field exceeds the supported 60,000 byte limit.");
    field += character;
  };
  const finishField = () => {
    fields.push(field);
    if (fields.length > state.limits.maxColumns)
      fail("County files may contain at most 55 columns.");
    field = "";
    fieldBytes = 0;
    fieldHighSurrogate = false;
    mode = "start";
  };
  const finishRow = () => {
    finishField();
    const row = fields;
    fields = [];
    recordBytes = 0;
    recordHighSurrogate = false;
    touched = false;
    return onRow(row);
  };
  return {
    feed(text) {
      for (let index = 0; index < text.length; index += 1) {
        if (index % 1024 === 0) state.check();
        const character = text[index];
        if (skipLF) {
          skipLF = false;
          if (character === "\n") continue;
        }
        touched = true;
        recordBytes += byteWidth(character, recordHighSurrogate);
        recordHighSurrogate = highSurrogate(character);
        if (recordBytes > state.limits.maxRecordBytes)
          fail("A county record exceeds the supported 60,000 byte limit.");
        if (character === "\u0000")
          fail(
            "The file contains unsupported control characters. Review its encoding.",
          );
        if (mode === "quoted") {
          if (character === '"') mode = "afterQuote";
          else append(character);
        } else if (mode === "afterQuote" && character === '"') {
          append('"');
          mode = "quoted";
        } else if (character === delimiter) {
          finishField();
        } else if (character === "\r" || character === "\n") {
          skipLF = character === "\r";
          if (finishRow() === false) return false;
        } else if (mode === "afterQuote") {
          fail("A quoted field has unexpected text after its closing quote.");
        } else if (character === '"') {
          if (mode !== "start")
            fail("A quote appears inside an unquoted county field.");
          mode = "quoted";
        } else {
          append(character);
          mode = "unquoted";
        }
      }
      return true;
    },
    finish() {
      state.check();
      if (mode === "quoted")
        fail("The county file ends inside a quoted field.");
      if (touched || fields.length) return finishRow();
      return true;
    },
  };
}

function detectDelimiter(header) {
  let quoted = false;
  const counts = { comma: 0, tab: 0, pipe: 0 };
  for (const character of header) {
    if (character === '"') quoted = !quoted;
    else if (!quoted) {
      for (const [name, value] of Object.entries(DELIMITERS))
        if (character === value) counts[name] += 1;
    }
  }
  const matches = Object.keys(counts).filter((name) => counts[name] > 0);
  // A header without separators is a valid one-column file. Data width is still strict.
  if (matches.length === 0) return "comma";
  if (matches.length !== 1)
    fail(
      "The separator is unclear. Choose comma, tab, or pipe explicitly.",
      "ballot_preparation_delimiter",
    );
  return matches[0];
}

/** Stops early for inspection, while preparation validates every source record. */
async function records(file, state, onRow) {
  let parser =
    state.delimiter === "auto"
      ? null
      : recordParser(DELIMITERS[state.delimiter], state, onRow);
  let prefix = "",
    quoted = false,
    prefixBytes = 0,
    prefixHighSurrogate = false;
  for await (const text of decodedChunks(file, state)) {
    state.check();
    if (!parser) {
      let index = 0;
      for (; index < text.length; index += 1) {
        const character = text[index];
        prefix += character;
        prefixBytes += byteWidth(character, prefixHighSurrogate);
        prefixHighSurrogate = highSurrogate(character);
        if (prefixBytes > state.limits.maxRecordBytes)
          fail("A county record exceeds the supported 60,000 byte limit.");
        if (character === '"') quoted = !quoted;
        if (!quoted && (character === "\r" || character === "\n")) {
          state.delimiter = detectDelimiter(prefix);
          parser = recordParser(DELIMITERS[state.delimiter], state, onRow);
          if (parser.feed(prefix) === false) return;
          prefix = "";
          index += 1;
          break;
        }
      }
      if (parser && parser.feed(text.slice(index)) === false) return;
    } else if (parser.feed(text) === false) return;
    state.progress({ phase: "reading" });
  }
  if (!parser) {
    state.delimiter = detectDelimiter(prefix);
    parser = recordParser(DELIMITERS[state.delimiter], state, onRow);
    if (parser.feed(prefix) === false) return;
  }
  parser.finish();
}

function validateHeaders(headers) {
  const unique = new Set();
  for (const header of headers) {
    const normalized = header.trim().toLowerCase();
    if (
      !normalized ||
      encoder.encode(header).length > 64 ||
      /\p{Cc}/u.test(header) ||
      unique.has(normalized)
    )
      fail(
        "The header row contains empty, repeated, or unsupported column names. Review the county layout.",
      );
    unique.add(normalized);
  }
}

function validateWidth(row, headers) {
  if (row.length !== headers.length)
    fail(
      "A county row has a different number of fields than its header. Review the separator and layout.",
    );
}

function validId(id) {
  return (
    typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(id)
  );
}

function retainedSet(ids, state) {
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > state.limits.maxRows ||
    ids.some((id) => !validId(id))
  )
    fail(
      "Choose a current retained voter-ID export containing at most 50,000 valid official IDs.",
    );
  if (new Set(ids).size !== ids.length)
    fail("The retained voter-ID list contains repeated IDs. Export it again.");
  return new Set(ids);
}

function csvRow(row) {
  return (
    row
      .map((value) =>
        /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value,
      )
      .join(",") + "\r\n"
  );
}

function sameBytes(first, second) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

export async function inspectBallotFile(file, options = {}) {
  const state = context(file, options);
  let headers;
  const sample = [];
  await records(file, state, (row) => {
    if (!headers) {
      validateHeaders(row);
      headers = row;
    } else {
      validateWidth(row, headers);
      sample.push(row);
      if (sample.length === 3) return false;
    }
    return true;
  });
  if (!headers) fail("The county file has no header row.");
  state.progress({ phase: "complete" });
  return {
    headers,
    sample,
    delimiter: state.delimiter,
    encoding: state.encoding,
    inputBytes: file.size,
  };
}

/** Preserves exact text and leading zeroes; returns are intersected before any upload. */
export async function prepareBallotFile(file, options = {}) {
  const state = context(file, options);
  const mode = options.mode || "baseline";
  if (mode !== "baseline" && mode !== "returns")
    fail("Choose baseline or returns preparation.");
  if (typeof options.idColumn !== "string" || !options.idColumn)
    fail("Choose the county's official voter-ID column.");
  const filters = options.filters || [];
  if (
    !Array.isArray(filters) ||
    filters.length > state.limits.maxColumns ||
    filters.some(
      (filter) =>
        !filter ||
        typeof filter.column !== "string" ||
        typeof filter.value !== "string",
    )
  )
    fail("Each county filter needs a column and an exact text value.");
  const retained =
    mode === "returns" ? retainedSet(options.retainedIds, state) : null;
  const receipt = {
    inputRows: 0,
    selectedRows: 0,
    matchedUnique: 0,
    excludedRows: 0,
    unknownRows: 0,
    duplicateRows: 0,
    outputBytes: 0,
    inputBytes: file.size,
    idColumn: options.idColumn,
    outputIdColumn: mode === "returns" ? "Voter ID" : options.idColumn,
    mode,
  };
  let headers, idIndex, preparedFilters;
  const parts = [],
    selected = new Map();
  const append = (bytes) => {
    if (receipt.outputBytes + bytes.length > state.limits.maxOutputBytes)
      fail(
        "The prepared file exceeds 50,000,000 bytes. Narrow the county filters.",
        "ballot_preparation_output_limit",
      );
    receipt.outputBytes += bytes.length;
    parts.push(bytes);
  };
  await records(file, state, (row) => {
    if (!headers) {
      validateHeaders(row);
      headers = row;
      idIndex = headers.indexOf(options.idColumn);
      if (idIndex < 0)
        fail(
          "The selected official voter-ID column is missing from this file.",
        );
      preparedFilters = filters.map((filter) => {
        const index = headers.indexOf(filter.column);
        if (index < 0)
          fail("A selected filter column is missing from this county file.");
        return { index, value: filter.value };
      });
      append(
        encoder.encode(csvRow(mode === "returns" ? ["Voter ID"] : headers)),
      );
      return;
    }
    validateWidth(row, headers);
    receipt.inputRows += 1;
    if (preparedFilters.some((filter) => row[filter.index] !== filter.value)) {
      receipt.excludedRows += 1;
      return;
    }
    const id = row[idIndex];
    if (!validId(id))
      fail(
        "A selected row has a missing or invalid official voter ID. Review the county layout.",
      );
    if (retained && !retained.has(id)) {
      receipt.unknownRows += 1;
      receipt.excludedRows += 1;
      return;
    }
    const bytes = encoder.encode(csvRow(mode === "returns" ? [id] : row));
    if (selected.has(id)) {
      if (!sameBytes(selected.get(id), bytes))
        fail(
          "Selected rows repeat an official voter ID with different data. Resolve the county duplicates before upload.",
          "ballot_preparation_duplicate",
        );
      receipt.duplicateRows += 1;
      receipt.excludedRows += 1;
      return;
    }
    if (receipt.selectedRows >= state.limits.maxRows)
      fail(
        "The prepared file exceeds 50,000 voters. Narrow the county filters.",
        "ballot_preparation_row_limit",
      );
    append(bytes);
    selected.set(id, bytes);
    receipt.selectedRows += 1;
    receipt.matchedUnique += 1;
  });
  if (!headers || (mode === "baseline" && receipt.selectedRows === 0))
    fail(
      "No county rows match the chosen scope. Review the ID column and exact filter values.",
      "ballot_preparation_empty",
    );
  state.check();
  receipt.delimiter = state.delimiter;
  receipt.encoding = state.encoding;
  receipt.elapsedMs = Date.now() - state.startedAt;
  state.progress({
    phase: "complete",
    inputRows: receipt.inputRows,
    selectedRows: receipt.selectedRows,
  });
  return { blob: new Blob(parts, { type: "text/csv;charset=utf-8" }), receipt };
}

/** Existing server exports use the exact ballotVoterId column name. */
export async function readRetainedBallotIds(file, options = {}) {
  const state = context(file, {
    ...options,
    delimiter: "comma",
    encoding: "utf-8",
    limits: {
      ...options.limits,
      maxInputBytes: Math.min(
        options.limits?.maxInputBytes ||
          BALLOT_PREPARATION_LIMITS.maxOutputBytes,
        BALLOT_PREPARATION_LIMITS.maxOutputBytes,
      ),
    },
  });
  let headers, idIndex;
  const ids = [];
  const seen = new Set();
  await records(file, state, (row) => {
    if (!headers) {
      validateHeaders(row);
      headers = row;
      idIndex = headers.indexOf("ballotVoterId");
      if (idIndex < 0)
        fail("Choose a Polis export containing the ballotVoterId column.");
      return;
    }
    validateWidth(row, headers);
    const id = row[idIndex];
    if (!validId(id) || seen.has(id))
      fail(
        "The retained export contains invalid or repeated voter IDs. Export it again.",
      );
    if (ids.length >= state.limits.maxRows)
      fail("The retained export exceeds 50,000 voter IDs.");
    seen.add(id);
    ids.push(id);
  });
  if (!ids.length) fail("The retained voter-ID export is empty.");
  state.progress({ phase: "complete", selectedRows: ids.length });
  return ids;
}

/** Never expose unexpected parser/runtime errors or source values in a worker error. */
export function ballotPreparationError(error) {
  if (
    typeof error?.code === "string" &&
    error.code.startsWith("ballot_preparation_")
  )
    return { message: error.message, code: error.code, name: error.name };
  return {
    message:
      "The county file could not be prepared. Review the layout and try again.",
    code: "ballot_preparation_failed",
    name: "Error",
  };
}
