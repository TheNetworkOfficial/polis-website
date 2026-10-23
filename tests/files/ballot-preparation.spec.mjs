import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scripts = new URL(
  "../../frontend/src/pages/shared-feed/scripts/",
  import.meta.url,
);
const source = await readFile(
  new URL("ballotPreparationModel.js", scripts),
  "utf8",
);
const modelUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const {
  inspectBallotFile,
  prepareBallotFile,
  readRetainedBallotIds,
  ballotPreparationError,
  BALLOT_PREPARATION_LIMITS,
} = await import(modelUrl);
const file = (text) => new Blob([text]);
const options = { idColumn: "Official ID", mode: "baseline", filters: [] };

/** A proxy fails immediately if a caller ever reads the entire source Blob. */
function boundedFile(blob, onRead = () => {}) {
  const reads = [];
  return {
    size: blob.size,
    reads,
    arrayBuffer() {
      throw new Error("Whole source reads are forbidden");
    },
    text() {
      throw new Error("Whole source reads are forbidden");
    },
    slice(start, end) {
      assert.ok(end - start <= BALLOT_PREPARATION_LIMITS.chunkBytes);
      reads.push([start, end]);
      return {
        async arrayBuffer() {
          await onRead(start, end);
          return blob.slice(start, end).arrayBuffer();
        },
      };
    },
  };
}

test("inspection strictly detects comma/tab/pipe and limits preview to three records", async () => {
  for (const [name, separator] of [
    ["comma", ","],
    ["tab", "\t"],
    ["pipe", "|"],
  ]) {
    const data = boundedFile(
      file(
        [
          `Official ID${separator}Name`,
          ...Array.from({ length: 20 }, (_, i) => `000${i}${separator}Person`),
        ].join("\r\n"),
      ),
    );
    const result = await inspectBallotFile(data, {
      limits: { chunkBytes: 16 },
    });
    assert.equal(result.delimiter, name);
    assert.deepEqual(result.headers, ["Official ID", "Name"]);
    assert.equal(result.sample.length, 3);
    assert.ok(data.reads.at(-1)[1] < data.size);
  }
});

test("auto detection refuses ambiguous separators, and explicit choice resolves it", async () => {
  const input = file("Official ID,County|Party\n001,A|ind\n");
  await assert.rejects(inspectBallotFile(input), /separator is unclear/);
  assert.deepEqual(
    (await inspectBallotFile(input, { delimiter: "comma" })).headers,
    ["Official ID", "County|Party"],
  );
});

test("single-column return files use auto detection and the canonical ID-only header", async () => {
  const input = file("Return ID\r\n0001\r\n9999\r\n");
  assert.deepEqual((await inspectBallotFile(input)).headers, ["Return ID"]);
  const result = await prepareBallotFile(input, {
    mode: "returns",
    idColumn: "Return ID",
    retainedIds: ["0001"],
    limits: { chunkBytes: 2 },
  });
  assert.equal(await result.blob.text(), "Voter ID\r\n0001\r\n");
  assert.equal(result.receipt.unknownRows, 1);
});

test("streamed quoted multiline CSV preserves strings and applies exact AND filters", async () => {
  const input = file(
    'Official ID,Party,District,Name\r\n0001,ind,08,"A,""B""\r\nC"\r\n0002,IND,08,D\r\n0003,ind,8,E\r\n0004,ind,08,F\r\n',
  );
  const result = await prepareBallotFile(boundedFile(input), {
    ...options,
    filters: [
      { column: "Party", value: "ind" },
      { column: "District", value: "08" },
    ],
    limits: { chunkBytes: 1 },
  });
  assert.equal(
    await result.blob.text(),
    'Official ID,Party,District,Name\r\n0001,ind,08,"A,""B""\r\nC"\r\n0004,ind,08,F\r\n',
  );
  assert.equal(result.receipt.inputRows, 4);
  assert.equal(result.receipt.selectedRows, 2);
  assert.equal(result.receipt.excludedRows, 2);
  assert.equal(result.receipt.outputBytes, result.blob.size);
});

test("tab and pipe source produce canonical CSV without losing empty cells or zeroes", async () => {
  for (const [delimiter, separator] of [
    ["tab", "\t"],
    ["pipe", "|"],
  ]) {
    const result = await prepareBallotFile(
      file(
        `Official ID${separator}Postal${separator}Empty\n00001${separator}00007${separator}\n`,
      ),
      { ...options, delimiter },
    );
    assert.equal(
      await result.blob.text(),
      "Official ID,Postal,Empty\r\n00001,00007,\r\n",
    );
  }
});

test("returns intersect exact retained IDs before producing ID-only output", async () => {
  const result = await prepareBallotFile(
    file(
      "Official ID,Party,Name\n0001,ind,One\n0002,ind,Two\n0001,other,Changed\n0003,ind,Three\n",
    ),
    { ...options, mode: "returns", retainedIds: ["0001", "0003"] },
  );
  assert.equal(await result.blob.text(), "Voter ID\r\n0001\r\n0003\r\n");
  assert.deepEqual(
    Object.fromEntries(
      [
        "inputRows",
        "selectedRows",
        "matchedUnique",
        "excludedRows",
        "unknownRows",
        "duplicateRows",
      ].map((key) => [key, result.receipt[key]]),
    ),
    {
      inputRows: 4,
      selectedRows: 2,
      matchedUnique: 2,
      excludedRows: 2,
      unknownRows: 1,
      duplicateRows: 1,
    },
  );
  assert.equal(result.receipt.mode, "returns");
  assert.equal(result.receipt.idColumn, "Official ID");
  assert.equal(result.receipt.outputIdColumn, "Voter ID");
});

test("baseline skips exact duplicate rows and rejects conflicting selected IDs", async () => {
  const result = await prepareBallotFile(
    file("Official ID,Name\n001,One\n001,One\n"),
    options,
  );
  assert.equal(result.receipt.selectedRows, 1);
  assert.equal(result.receipt.duplicateRows, 1);
  assert.equal(result.receipt.excludedRows, 1);
  await assert.rejects(
    prepareBallotFile(file("Official ID,Name\n001,One\n001,Two\n"), options),
    /different data/,
  );
});

test("returns reject absent, unbounded, repeated, or malformed retained ID lists", async () => {
  for (const retainedIds of [
    undefined,
    [],
    "001",
    ["001", 2],
    ["001", "001"],
    ["bad id"],
    ["é1"],
    ["=formula"],
    Array.from({ length: 50001 }, (_, i) => String(i)),
  ]) {
    await assert.rejects(
      prepareBallotFile(file("Official ID,Name\n001,One\n"), {
        ...options,
        mode: "returns",
        retainedIds,
      }),
    );
  }
});

test("official IDs use a bounded ASCII identity grammar in both modes", async () => {
  for (const id of [
    "",
    "a b",
    "é",
    "=formula",
    "'001",
    "a".repeat(161),
    "a\t1",
  ]) {
    for (const mode of ["baseline", "returns"]) {
      await assert.rejects(
        prepareBallotFile(file(`Official ID,Name\n${id},One\n`), {
          ...options,
          mode,
          retainedIds: ["001"],
        }),
        /official voter ID/,
      );
    }
  }
  const result = await prepareBallotFile(
    file("Official ID,Name\nA01._-x,One\n"),
    options,
  );
  assert.match(await result.blob.text(), /A01\._-x/);
});

test("invalid shapes, ambiguous headers, and malformed quotes fail without source values", async () => {
  for (const input of [
    "Official ID,Name\n001,One,Extra\n",
    "Official ID,Name\n001\n",
    'Official ID,Name\n001,"Unclosed\n',
    'Official ID,Name\n001,One"Two\n',
    'Official ID,Name\n001,"One"suffix\n',
    "Official ID,official id\n001,One\n",
    "Official ID,\n001,One\n",
    `Official ID,${"é".repeat(33)}\n001,One\n`,
    "Official ID,Na\u0000me\n001,One\n",
  ]) {
    await assert.rejects(
      prepareBallotFile(file(input), options),
      (error) =>
        !error.message.includes("001") && !error.message.includes("Unclosed"),
    );
  }
});

test("UTF-8 default is fatal and UTF-16 requires a matching explicit encoding", async () => {
  const invalidUtf8 = file(new Uint8Array([0x49, 0x44, 0x2c, 0xe9, 0x0a]));
  await assert.rejects(inspectBallotFile(invalidUtf8), /chosen encoding/);
  for (const encoding of ["utf-16le", "utf-16be"]) {
    const bytes = Buffer.from("\ufeffOfficial ID,Name\n001,Café\n", "utf16le");
    if (encoding === "utf-16be") bytes.swap16();
    const input = file(bytes);
    await assert.rejects(inspectBallotFile(input), /byte order mark/);
    const result = await prepareBallotFile(input, {
      ...options,
      encoding,
      limits: { chunkBytes: 3 },
    });
    assert.equal(await result.blob.text(), "Official ID,Name\r\n001,Café\r\n");
  }
  const mismatch = file(new Uint8Array([0xef, 0xbb, 0xbf, 0x49, 0x44]));
  await assert.rejects(
    inspectBallotFile(mismatch, { encoding: "windows-1252" }),
    /byte order mark/,
  );
});

test("explicit Windows-1252 and split UTF-8 multibyte characters are preserved", async () => {
  const cp = file(Buffer.from("Official ID,Name\n001,Caf\xe9\n", "latin1"));
  assert.equal(
    await (
      await prepareBallotFile(cp, {
        ...options,
        encoding: "windows-1252",
        limits: { chunkBytes: 2 },
      })
    ).blob.text(),
    "Official ID,Name\r\n001,Café\r\n",
  );
  const utf8 = file("\ufeffOfficial ID,Name\n001,🙂Café\n");
  assert.equal(
    await (
      await prepareBallotFile(utf8, { ...options, limits: { chunkBytes: 1 } })
    ).blob.text(),
    "Official ID,Name\r\n001,🙂Café\r\n",
  );
});

test("record and field byte caps count a surrogate pair as four UTF-8 bytes", async () => {
  const result = await prepareBallotFile(file("ID,N\n1,🙂\n"), {
    idColumn: "ID",
    limits: { maxFieldBytes: 4, maxRecordBytes: 8, chunkBytes: 1 },
  });
  assert.equal(await result.blob.text(), "ID,N\r\n1,🙂\r\n");
});

test("source reads remain bounded for a file larger than one read", async () => {
  const input = boundedFile(
    file(
      "Official ID,Name\n" +
        Array.from(
          { length: 25000 },
          (_, i) => `${String(i).padStart(6, "0")},Person\n`,
        ).join(""),
    ),
  );
  assert.ok(input.size > BALLOT_PREPARATION_LIMITS.chunkBytes);
  const result = await prepareBallotFile(input, options);
  assert.equal(result.receipt.selectedRows, 25000);
  assert.ok(input.reads.length >= 3);
  assert.equal(input.reads.at(-1)[1], input.size);
});

test("input size, column, record, field, output byte, and output row caps fail closed", async () => {
  await assert.rejects(
    inspectBallotFile({
      size: BALLOT_PREPARATION_LIMITS.maxInputBytes + 1,
      slice() {
        throw new Error("Must not read");
      },
    }),
    /512 MiB/,
  );
  const input = file("Official ID,Name\n001,Person\n002,Other\n");
  for (const limits of [
    { maxInputBytes: 5 },
    { maxColumns: 1 },
    { maxRecordBytes: 10 },
    { maxFieldBytes: 3 },
    { maxOutputBytes: 25 },
    { maxRows: 1 },
  ]) {
    await assert.rejects(prepareBallotFile(input, { ...options, limits }));
  }
  await assert.rejects(
    prepareBallotFile(input, { ...options, limits: { maxRows: 50001 } }),
    /within the supported file limits/,
  );
  await assert.rejects(
    prepareBallotFile(
      file(`Official ID,Name\n001,${"a".repeat(60001)}\n`),
      options,
    ),
    /60,000 byte/,
  );
  await assert.rejects(
    prepareBallotFile(
      file(Array.from({ length: 56 }, (_, i) => `c${i}`).join(",") + "\n"),
      { ...options, idColumn: "c0" },
    ),
    /55 columns/,
  );
});

test("cancellation is checked before and between reads, and elapsed work is bounded", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    prepareBallotFile(file("Official ID,Name\n001,One\n"), {
      ...options,
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  const during = new AbortController();
  const input = boundedFile(
    file("Official ID,Name\n001,One\n002,Two\n"),
    async (start) => {
      if (start > 0) during.abort();
    },
  );
  await assert.rejects(
    prepareBallotFile(input, {
      ...options,
      signal: during.signal,
      limits: { chunkBytes: 8 },
    }),
    { name: "AbortError" },
  );
  const slow = boundedFile(
    file("Official ID,Name\n001,One\n"),
    () => new Promise((resolve) => setTimeout(resolve, 10)),
  );
  await assert.rejects(
    prepareBallotFile(slow, { ...options, limits: { maxElapsedMs: 1 } }),
    /exceeded ten minutes/,
  );
});

test("zero matches and missing selected columns cannot produce uploadable files", async () => {
  const input = file("Official ID,Party\n001,ind\n");
  await assert.rejects(
    prepareBallotFile(input, {
      ...options,
      filters: [{ column: "Party", value: "IND" }],
    }),
    /No county rows match/,
  );
  await assert.rejects(
    prepareBallotFile(input, { ...options, idColumn: "Wrong" }),
    /column is missing/,
  );
  await assert.rejects(
    prepareBallotFile(input, {
      ...options,
      filters: [{ column: "Wrong", value: "ind" }],
    }),
    /filter column is missing/,
  );
});

test("zero-match returns keep unknown and excluded counts in a local header-only result", async () => {
  const result = await prepareBallotFile(
    file("Official ID,Party\n001,ind\n003,other\n"),
    {
      ...options,
      mode: "returns",
      retainedIds: ["002"],
      filters: [{ column: "Party", value: "ind" }],
    },
  );
  assert.equal(await result.blob.text(), "Voter ID\r\n");
  assert.equal(result.receipt.inputRows, 2);
  assert.equal(result.receipt.selectedRows, 0);
  assert.equal(result.receipt.matchedUnique, 0);
  assert.equal(result.receipt.excludedRows, 2);
  assert.equal(result.receipt.unknownRows, 1);
  assert.equal(result.receipt.duplicateRows, 0);
  assert.equal(result.receipt.outputBytes, 10);
  assert.equal(result.receipt.outputIdColumn, "Voter ID");
});

test("retained ID exports require the exact server header and preserve leading zeroes", async () => {
  assert.deepEqual(
    await readRetainedBallotIds(file("ballotVoterId\r\n00001\r\nA02-x\r\n")),
    ["00001", "A02-x"],
  );
  assert.deepEqual(
    await readRetainedBallotIds(
      file(
        "displayName,ballotVoterId,ballotStatus\nOne,0001,returned\nTwo,0002,issued\n",
      ),
    ),
    ["0001", "0002"],
  );
  for (const text of [
    "Voter ID\n001\n",
    "Official voter ID\n001\n",
    "ballotVoterId\n001\n001\n",
    "ballotVoterId\n",
    "ballotVoterId\ninvalid id\n",
  ]) {
    await assert.rejects(readRetainedBallotIds(file(text)));
  }
  await assert.rejects(
    readRetainedBallotIds(file("ballotVoterId\n001\n002\n"), {
      limits: { maxRows: 1 },
    }),
    /50,000 voter IDs/,
  );
});

test("worker error sanitization never forwards unexpected exception text", () => {
  assert.equal(
    ballotPreparationError(new Error("Private Name 000123")).message.includes(
      "Private",
    ),
    false,
  );
});

test("worker supports inspection, preparation, retained IDs, progress and friendly errors", async () => {
  let handler;
  const messages = [];
  const previous = globalThis.self;
  globalThis.self = {
    addEventListener(name, callback) {
      assert.equal(name, "message");
      handler = callback;
    },
    postMessage(message) {
      messages.push(message);
    },
  };
  try {
    const worker = (
      await readFile(new URL("ballotPreparation.worker.js", scripts), "utf8")
    ).replace('"./ballotPreparationModel.js"', JSON.stringify(modelUrl));
    await import(
      `data:text/javascript;base64,${Buffer.from(worker).toString("base64")}`
    );
    for (const action of ["inspect", "prepare", "ids"]) {
      messages.length = 0;
      await handler({
        data: {
          id: action,
          action,
          file: file(
            action === "ids"
              ? "ballotVoterId\n0001\n"
              : "Official ID,Name\n0001,One\n",
          ),
          options,
        },
      });
      assert.ok(messages.some((message) => message.type === "progress"));
      assert.equal(messages.at(-1).type, "result");
      assert.equal(messages.at(-1).id, action);
    }
    messages.length = 0;
    await handler({
      data: {
        id: "bad",
        action: "prepare",
        file: {
          size: 5,
          slice() {
            throw new Error("Private Name");
          },
        },
        options,
      },
    });
    assert.equal(messages.at(-1).type, "error");
    assert.equal(messages.at(-1).error.message.includes("Private"), false);
    messages.length = 0;
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const delayedBlob = file("Official ID,Name\n0001,One\n");
    const delayedFile = {
      size: delayedBlob.size,
      slice(start, end) {
        return {
          async arrayBuffer() {
            await blocked;
            return delayedBlob.slice(start, end).arrayBuffer();
          },
        };
      },
    };
    const running = handler({
      data: { id: "cancelled", action: "prepare", file: delayedFile, options },
    });
    await handler({
      data: { id: "busy", action: "inspect", file: delayedBlob },
    });
    assert.equal(messages.at(-1).error.code, "ballot_preparation_busy");
    await handler({ data: { id: "cancelled", action: "cancel" } });
    release();
    await running;
    assert.equal(messages.at(-1).id, "cancelled");
    assert.equal(messages.at(-1).error.code, "ballot_preparation_cancelled");
  } finally {
    globalThis.self = previous;
  }
});
