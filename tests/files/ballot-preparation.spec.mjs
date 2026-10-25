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
  inspectBallotReturnStatuses,
  prepareBallotFile,
  readRetainedBallotIds,
  ballotPreparationError,
  BALLOT_PREPARATION_LIMITS,
  BALLOT_PREPARATION_MAX_ROWS,
  ballotPreparationPolicyLimits,
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
    prepareBallotFile(input, { ...options, limits: { maxRows: 125001 } }),
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

const returnStatus = {
  column: "BALSTATUS",
  mappings: [
    { value: "R", meaning: "returned" },
    { value: "X", meaning: "voided" },
  ],
};
const returnOptions = {
  mode: "returns",
  idColumn: "VOTERID",
  retainedIds: ["0001", "0002", "0003", "0004", "0005"],
  returnStatus,
};

test("status inspection scans the whole bounded file and preserves exact codes including blanks", async () => {
  const input = boundedFile(
    file(
      "VOTERID,BALSTATUS\r\n0001,R\r\n0002,R\r\n0003,R\r\n0004,X\r\n0005,\r\n0006,r\r\n",
    ),
  );
  const result = await inspectBallotReturnStatuses(input, {
    idColumn: "VOTERID",
    statusColumn: "BALSTATUS",
    limits: { chunkBytes: 5 },
  });
  assert.deepEqual(result, {
    statusColumn: "BALSTATUS",
    inputRows: 6,
    statuses: [
      { value: "R", count: 3 },
      { value: "X", count: 1 },
      { value: "", count: 1 },
      { value: "r", count: 1 },
    ],
    delimiter: "comma",
    encoding: "utf-8",
  });
  assert.equal(input.reads.at(-1)[1], input.size);
});

test("return status inspection rejects the wrong column, invalid IDs and unbounded status choices", async () => {
  const inspectOptions = { idColumn: "VOTERID", statusColumn: "BALSTATUS" };
  await assert.rejects(
    inspectBallotReturnStatuses(file("VOTERID\n0001\n"), {
      idColumn: "VOTERID",
      statusColumn: "VOTERID",
    }),
    /separate official voter-ID and ballot-status columns/,
  );
  await assert.rejects(
    inspectBallotReturnStatuses(
      file("VOTERID,BALSTATUS\ninvalid id,R\n"),
      inspectOptions,
    ),
    /invalid official voter ID/,
  );
  const rows = Array.from(
    { length: 32 },
    (_, index) => `00${index},code${index}\n`,
  ).join("");
  assert.equal(
    (
      await inspectBallotReturnStatuses(
        file("VOTERID,BALSTATUS\n" + rows),
        inspectOptions,
      )
    ).statuses.length,
    32,
  );
  await assert.rejects(
    inspectBallotReturnStatuses(
      file("VOTERID,BALSTATUS\n" + rows + "0032,code32\n"),
      inspectOptions,
    ),
    /more than 32 status values/,
  );
  await assert.rejects(
    inspectBallotReturnStatuses(
      file(`VOTERID,BALSTATUS\n0001,${"é".repeat(81)}\n`),
      inspectOptions,
    ),
    /160 bytes/,
  );
  const controller = new AbortController();
  const input = boundedFile(
    file("VOTERID,BALSTATUS\n0001,R\n0002,X\n"),
    (start) => {
      if (start > 0) controller.abort();
    },
  );
  await assert.rejects(
    inspectBallotReturnStatuses(input, {
      ...inspectOptions,
      signal: controller.signal,
      limits: { chunkBytes: 5 },
    }),
    { name: "AbortError" },
  );
});

test("returned and voided rows are classified before deduplicating retained voter IDs", async () => {
  const rows = [
    "0001,R",
    "0001,R",
    "0002,X",
    "0003,R",
    "0003,X",
    "0004,X",
    "0004,R",
    "0005,I",
    "0005,R",
    "9999,R",
  ];
  for (const values of [rows, [...rows].reverse()]) {
    const prepared = await prepareBallotFile(
      boundedFile(file("VOTERID,BALSTATUS\r\n" + values.join("\r\n") + "\r\n")),
      {
        ...returnOptions,
        returnStatus: {
          ...returnStatus,
          mappings: [
            ...returnStatus.mappings,
            { value: "I", meaning: "ignore" },
          ],
        },
        limits: { chunkBytes: 3 },
      },
    );
    const outputIds = (await prepared.blob.text())
      .trim()
      .split("\r\n")
      .slice(1)
      .sort();
    assert.deepEqual(outputIds, ["0001", "0005"]);
    assert.deepEqual(
      Object.fromEntries(
        [
          "inputRows",
          "selectedRows",
          "matchedUnique",
          "excludedRows",
          "unknownRows",
          "duplicateRows",
          "returnedRows",
          "voidedRows",
          "ignoredStatusRows",
          "conflictingIds",
          "voidedIds",
        ].map((key) => [key, prepared.receipt[key]]),
      ),
      {
        inputRows: 10,
        selectedRows: 2,
        matchedUnique: 2,
        excludedRows: 8,
        unknownRows: 1,
        duplicateRows: 3,
        returnedRows: 6,
        voidedRows: 3,
        ignoredStatusRows: 1,
        conflictingIds: 2,
        voidedIds: 3,
      },
    );
  }
});

test("all voided, ignored or outside-cohort records produce no returned IDs", async () => {
  const prepared = await prepareBallotFile(
    file("VOTERID,BALSTATUS\n0001,X\n0002,I\n9999,R\n"),
    {
      ...returnOptions,
      returnStatus: {
        ...returnStatus,
        mappings: [...returnStatus.mappings, { value: "I", meaning: "ignore" }],
      },
    },
  );
  assert.equal(await prepared.blob.text(), "Voter ID\r\n");
  assert.equal(prepared.receipt.selectedRows, 0);
  assert.equal(prepared.receipt.voidedRows, 1);
  assert.equal(prepared.receipt.voidedIds, 1);
  assert.equal(prepared.receipt.ignoredStatusRows, 1);
  assert.equal(prepared.receipt.excludedRows, 3);
});

test("unmapped and blank statuses fail without exposing source values, while explicit blank exclusion works", async () => {
  for (const value of ["Private Name", ""]) {
    await assert.rejects(
      prepareBallotFile(
        file(`VOTERID,BALSTATUS\n0001,R\n0002,${value}\n`),
        returnOptions,
      ),
      (error) => {
        assert.equal(error.code, "ballot_preparation_return_status_unmapped");
        assert.equal(error.message.includes("Private Name"), false);
        return true;
      },
    );
  }
  const prepared = await prepareBallotFile(
    file("VOTERID,BALSTATUS\n0001,R\n0002,\n"),
    {
      ...returnOptions,
      returnStatus: {
        ...returnStatus,
        mappings: [...returnStatus.mappings, { value: "", meaning: "ignore" }],
      },
    },
  );
  assert.equal(await prepared.blob.text(), "Voter ID\r\n0001\r\n");
  assert.equal(prepared.receipt.ignoredStatusRows, 1);
});

test("return meanings are explicit, disjoint and bounded; confirmed returned-only files remain supported", async () => {
  const input = file("VOTERID,BALSTATUS\n0001,R\n");
  for (const invalid of [
    null,
    { returnedOnly: false },
    { returnedOnly: true, column: "BALSTATUS" },
    { column: "BALSTATUS", mappings: [{ value: "R", meaning: "accepted" }] },
    {
      column: "BALSTATUS",
      mappings: [
        { value: "R", meaning: "returned" },
        { value: "R", meaning: "voided" },
      ],
    },
    {
      column: "BALSTATUS",
      mappings: Array.from({ length: 33 }, (_, index) => ({
        value: String(index),
        meaning: "ignore",
      })),
    },
    { column: "VOTERID", mappings: [] },
  ])
    await assert.rejects(
      prepareBallotFile(input, { ...returnOptions, returnStatus: invalid }),
    );
  const prepared = await prepareBallotFile(
    file("VOTERID\r\n0001\r\n0001\r\n"),
    {
      ...returnOptions,
      returnStatus: { returnedOnly: true },
    },
  );
  assert.equal(await prepared.blob.text(), "Voter ID\r\n0001\r\n");
  assert.equal(prepared.receipt.returnedRows, 2);
  assert.equal(prepared.receipt.duplicateRows, 1);
  assert.deepEqual(prepared.receipt.returnStatus, { returnedOnly: true });
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
    /1 voter IDs/,
  );
});

test("party alternatives are exact OR values while district remains an AND condition", async () => {
  const input = file(
    "Official ID,Party,District,Name\r\n0001,IND,8,One\r\n0002,PND,8,Two\r\n0003,NOL,8,Three\r\n0004,IND,3,Four\r\n0005,ind,8,Five\r\n0006,PND,08,Six\r\n",
  );
  const prepared = await prepareBallotFile(input, {
    ...options,
    filters: [
      { column: "District", value: "8" },
      { column: "Party", values: ["IND", "PND", "IND"] },
    ],
  });
  assert.equal(
    await prepared.blob.text(),
    "Official ID,Party,District,Name\r\n0001,IND,8,One\r\n0002,PND,8,Two\r\n",
  );
  assert.equal(prepared.receipt.selectedRows, 2);
  assert.equal(prepared.receipt.excludedRows, 4);
  for (const values of [[], "IND", ["IND", 4], Array(17).fill("IND")]) {
    await assert.rejects(
      prepareBallotFile(input, {
        ...options,
        filters: [{ column: "Party", values }],
      }),
      /supported exact text values/,
    );
  }
  await assert.rejects(
    prepareBallotFile(input, {
      ...options,
      filters: [{ column: "Party", value: "IND", values: ["PND"] }],
    }),
    /supported exact text values/,
  );
});

test("approved capacity preserves the legacy default and admits exactly 125,000 rows", async () => {
  const rows = Array.from(
    { length: BALLOT_PREPARATION_MAX_ROWS },
    (_, index) => `${String(index).padStart(6, "0")},One\r\n`,
  ).join("");
  const input = file("Official ID,Name\r\n" + rows);
  await assert.rejects(
    prepareBallotFile(input, options),
    /50,000-voter capacity/,
  );
  const prepared = await prepareBallotFile(input, {
    ...options,
    limits: { maxRows: BALLOT_PREPARATION_MAX_ROWS },
  });
  assert.equal(prepared.receipt.selectedRows, 125000);
  assert.match((await prepared.blob.text()).slice(0, 40), /000000,One/);
  await assert.rejects(
    prepareBallotFile(file("Official ID,Name\r\n" + rows + "125000,Two\r\n"), {
      ...options,
      limits: { maxRows: BALLOT_PREPARATION_MAX_ROWS },
    }),
    /125,000-voter capacity/,
  );
});

test("fresh supported policy bounds are validated and retained-ID reads use their row limit", async () => {
  const policy = {
    enabled: true,
    policy: "bounded_v1",
    maxRows: 125000,
    maxSourceBytes: 50000000,
    maxColumns: 55,
    maxHeaderBytes: 64,
  };
  assert.equal(ballotPreparationPolicyLimits(policy).maxRows, 125000);
  assert.equal(
    ballotPreparationPolicyLimits({ ...policy, maxRows: 50000 }).maxRows,
    50000,
  );
  for (const invalid of [
    { maxRows: 125001 },
    { maxRows: "125000" },
    { maxRows: 0 },
    { enabled: false },
    { policy: "other" },
    { maxSourceBytes: 50000001 },
    { maxColumns: 56 },
    { maxHeaderBytes: 65 },
  ])
    assert.equal(
      ballotPreparationPolicyLimits({ ...policy, ...invalid }),
      null,
    );
  const ids = Array.from({ length: 125000 }, (_, index) => String(index));
  const input = file("ballotVoterId\r\n" + ids.join("\r\n") + "\r\n");
  assert.equal(
    (await readRetainedBallotIds(input, { limits: { maxRows: 125000 } }))
      .length,
    125000,
  );
  await assert.rejects(readRetainedBallotIds(input), /50,000 voter IDs/);
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
    for (const action of ["inspect", "prepare", "ids", "return-statuses"]) {
      messages.length = 0;
      await handler({
        data: {
          id: action,
          action,
          file: file(
            action === "ids"
              ? "ballotVoterId\n0001\n"
              : action === "return-statuses"
                ? "Official ID,BALSTATUS\n0001,R\n"
                : "Official ID,Name\n0001,One\n",
          ),
          options: { ...options, statusColumn: "BALSTATUS" },
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
