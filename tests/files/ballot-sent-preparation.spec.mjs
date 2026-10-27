import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/ballotPreparationModel.js",
    import.meta.url,
  ),
  "utf8",
);
const { prepareBallotFile, BALLOT_PREPARATION_LIMITS } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const columns = [
  "VOTERID",
  "FRSTNAME",
  "CONDIST",
  "PARTY",
  "BALSTATUS",
  "ELECTDATE",
];
const policy = {
  enabled: true,
  maxRows: 5000,
  maxSourceBytes: 5000000,
  idColumn: "VOTERID",
  districtColumn: "CONDIST",
  districtValue: "8",
  partyColumn: "PARTY",
  partyValues: ["IND", "PND"],
  statusColumn: "BALSTATUS",
  issuedValue: "S",
  electionDateColumn: "ELECTDATE",
};
const options = (extra = {}) => ({
  mode: "sent",
  idColumn: "VOTERID",
  sentPolicy: policy,
  outputColumns: columns,
  retainedIds: ["0001"],
  electionDate: "2026-11-03",
  ...extra,
});
const file = (rows, headers = columns) =>
  new Blob([
    [
      headers,
      ...rows.map((row) =>
        headers.at(-1) === "ELECTDATE" && row.length === headers.length - 1
          ? [...row, "11/03/2026"]
          : row,
      ),
    ]
      .map((row) => row.join(","))
      .join("\r\n"),
  ]);

test("sent preparation adds both target parties, skips tracked voters and keeps canonical columns", async () => {
  const headers = [
    "PARTY",
    "BALSTATUS",
    "FRSTNAME",
    "VOTERID",
    "CONDIST",
    "ELECTDATE",
  ];
  const input = file(
    [
      ["IND", "S", "Changed existing name", "0001", "8"],
      ["IND", "S", "First new", "0002", "8"],
      ["PND", "S", "Second new", "0003", "8"],
      ["IND", "S", "First new", "0002", "8"],
      ["DEM", "S", "Other party", "0004", "8"],
      ["PND", "S", "Other district", "0005", "7"],
      ["IND", "X", "Voided", "0006", "8"],
    ],
    headers,
  );
  const result = await prepareBallotFile(input, options());
  assert.equal(
    await result.blob.text(),
    columns.join(",") +
      "\r\n0002,First new,8,IND,S,11/03/2026\r\n0003,Second new,8,PND,S,11/03/2026\r\n",
  );
  assert.equal(result.receipt.selectedRows, 2);
  assert.equal(result.receipt.existingRows, 1);
  assert.equal(result.receipt.outsideRows, 2);
  assert.equal(result.receipt.voidedRows, 1);
  assert.equal(result.receipt.duplicateRows, 1);
  assert.equal(result.receipt.conflictingIds, 0);
});

test("conflicting sent/voided and disagreeing sent records are withheld independent of row order", async () => {
  for (const rows of [
    [
      ["0002", "New", "8", "IND", "S"],
      ["0002", "New", "8", "IND", "X"],
      ["0003", "Old address", "8", "PND", "S"],
      ["0003", "New address", "8", "PND", "S"],
    ],
    [
      ["0002", "New", "8", "IND", "X"],
      ["0002", "New", "8", "IND", "S"],
      ["0003", "New address", "8", "PND", "S"],
      ["0003", "Old address", "8", "PND", "S"],
    ],
  ]) {
    const result = await prepareBallotFile(file(rows), options());
    assert.equal(result.receipt.conflictingIds, 2);
    assert.equal(result.receipt.selectedRows, 0);
    assert.equal(await result.blob.text(), columns.join(",") + "\r\n");
  }
});

test("unknown and blank statuses for new eligible voters fail before an upload can be prepared", async () => {
  for (const status of ["", "R", "UNKNOWN"]) {
    await assert.rejects(
      prepareBallotFile(file([["0002", "New", "8", "IND", status]]), options()),
      (error) => error.code === "ballot_preparation_sent_status",
    );
  }
});

test("the original election date is verified rather than inferred from a report date", async () => {
  for (const date of ["11/03/2025", "", "03/11/2026"]) {
    await assert.rejects(
      prepareBallotFile(
        file([["0002", "New", "8", "IND", "S", date]]),
        options(),
      ),
      (error) => error.code === "ballot_preparation_sent_election",
    );
  }
  assert.equal(
    (
      await prepareBallotFile(
        file([["0002", "New", "8", "IND", "S", "2026-11-03"]]),
        options(),
      )
    ).receipt.selectedRows,
    1,
  );
});

test("a later sent master never includes already tracked returned voters", async () => {
  const result = await prepareBallotFile(
    file([["0001", "Replacement packet", "8", "IND", "R"]]),
    options(),
  );
  assert.equal(result.receipt.existingRows, 1);
  assert.equal(result.receipt.selectedRows, 0);
  assert.equal(await result.blob.text(), columns.join(",") + "\r\n");
});

test("total cohort capacity is checked before returning any prepared additions", async () => {
  await assert.rejects(
    prepareBallotFile(
      file([
        ["0003", "New", "8", "IND", "S"],
        ["0004", "New", "8", "PND", "S"],
      ]),
      options({ retainedIds: ["0001", "0002"], limits: { maxRows: 3 } }),
    ),
    (error) => error.code === "ballot_preparation_row_limit",
  );
});

test("the 5,000-new-voter limit does not limit the county source's already tracked rows", async () => {
  const existing = Array.from({ length: 5100 }, (_, i) => `old_${i}`);
  const input = file([
    ...existing.map((id) => [id, "Tracked", "8", "IND", "S"]),
    ["0002", "New", "8", "PND", "S"],
  ]);
  const result = await prepareBallotFile(
    input,
    options({ retainedIds: existing }),
  );
  assert.equal(result.receipt.existingRows, 5100);
  assert.equal(result.receipt.selectedRows, 1);
});

test("5,000 additions fit and 5,001 fail without silent truncation", async () => {
  const rows = Array.from({ length: 5001 }, (_, i) => [
    `new_${i}`,
    "New",
    "8",
    "IND",
    "S",
  ]);
  assert.equal(
    (await prepareBallotFile(file(rows.slice(0, 5000)), options())).receipt
      .selectedRows,
    5000,
  );
  await assert.rejects(
    prepareBallotFile(file(rows), options()),
    (error) => error.code === "ballot_preparation_row_limit",
  );
});

test("sent-specific byte limits still use bounded source reads", async () => {
  const input = file(
    Array.from({ length: 900 }, (_, i) => [
      `new_${i}`,
      "x".repeat(6000),
      "8",
      "PND",
      "S",
    ]),
  );
  const bounded = {
    size: input.size,
    text: () => assert.fail("Whole-file source reads are forbidden"),
    arrayBuffer: () => assert.fail("Whole-file source reads are forbidden"),
    slice: (start, end) => {
      assert.ok(end - start <= BALLOT_PREPARATION_LIMITS.chunkBytes);
      return input.slice(start, end);
    },
  };
  await assert.rejects(
    prepareBallotFile(bounded, options()),
    (error) => error.code === "ballot_preparation_output_limit",
  );
});

test("missing or extra columns and an unavailable or altered target policy are rejected", async () => {
  for (const headers of [columns.slice(0, -1), [...columns, "EXTRA"]]) {
    await assert.rejects(
      prepareBallotFile(file([], headers), options()),
      (error) => error.code === "ballot_preparation_sent_columns",
    );
  }
  for (const sentPolicy of [
    undefined,
    { ...policy, enabled: false },
    { ...policy, districtValue: "7" },
    { ...policy, partyValues: ["IND", "DEM"] },
    { ...policy, maxRows: 5001 },
  ]) {
    await assert.rejects(
      prepareBallotFile(file([]), options({ sentPolicy })),
      /not enabled/,
    );
  }
});
