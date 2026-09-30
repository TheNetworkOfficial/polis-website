import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const load = async (name) =>
  import(
    `data:text/javascript;base64,${Buffer.from(await readFile(new URL(`../../frontend/src/pages/shared-feed/scripts/${name}.js`, import.meta.url))).toString("base64")}`
  );
const acknowledge = (body) =>
  body.rows
    ? {
        processedRows: body.rows.length,
        nextRow: body.startRow + body.rows.length,
        remainingRows: 0,
        complete: true,
      }
    : { import: { status: "complete" } };
const model = await load("organizationContactsModel");
const imports = await load("organizationContactImport");
const { createOrganizationContactsApi } = await load("organizationContactsApi");

test("contact fields retain unknown/false/zero, structured values, and tag columns", () => {
  const contact = {
    fields: {
      postalCode: "00123",
      specialTax: "0007",
      volunteered: false,
      amount: 0,
    },
    tags: ["volunteer"],
  };
  assert.equal(model.contactValue(contact, "postalCode"), "00123");
  assert.equal(
    model.displayContactValue(model.contactValue(contact, "volunteered")),
    "No",
  );
  assert.equal(
    model.displayContactValue(model.contactValue(contact, "amount")),
    "0",
  );
  assert.equal(model.displayContactValue(null), "Not recorded");
  assert.equal(model.contactValue(contact, "tag:volunteer"), true);
  assert.equal(model.contactValue(contact, "tag:absent"), false);
  assert.deepEqual(
    model.typedContactInput("water, tax", { type: "multiple_choice" }),
    ["water", "tax"],
  );
});

test("CSV handles quoted multiline values, duplicate headers, leading zeros and malformed cells", async () => {
  const text =
    '\uFEFFname,tax,tax,notes\r\n"Example, Person",0007,0012,"two\nlines and ""quotes"""\r\n';
  const parsed = model.parseContactDelimitedText(text);
  assert.deepEqual(parsed.headers, ["name", "tax", "tax", "notes"]);
  assert.deepEqual(parsed.rows, [
    ["Example, Person", "0007", "0012", 'two\nlines and "quotes"'],
  ]);
  const bytes = new TextEncoder().encode(text);
  const file = {
    stream: () =>
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 3)
            controller.enqueue(bytes.slice(i, i + 3));
          controller.close();
        },
      }),
  };
  const rows = [];
  for await (const row of imports.contactFileRows(file)) rows.push(row);
  assert.deepEqual(rows, [parsed.headers, ...parsed.rows]);
  assert.throws(
    () => model.parseContactDelimitedText('a,b\n"unfinished,b'),
    /quoted/,
  );
  assert.throws(
    () => model.parseContactDelimitedText("a,b\nx,y,z"),
    /more values/,
  );
});

test("streamed imports use bounded chunks and stable retry receipts with no provider calls", async () => {
  const text =
    "name,tax\n" +
    Array.from({ length: 205 }, (_, index) => `Person ${index},0007`).join(
      "\n",
    );
  const file = new Blob([text]);
  const calls = [];
  const api = async (path, body) => {
    calls.push({ path, body });
    return {
      ok: true,
      accepted: body.rows?.length || 0,
      import: { importId: "import-1", status: "complete" },
      ...acknowledge(body),
    };
  };
  const options = {
    file,
    delimiter: ",",
    encoding: "utf-8",
    job: { importId: "import-1", operationId: "retry-1" },
    api,
    guard() {},
    progress() {},
  };
  await imports.uploadSharedContactRows(options);
  assert.deepEqual(
    calls.slice(0, 3).map((call) => call.body.rows.length),
    [100, 100, 5],
  );
  assert.deepEqual(
    calls.slice(0, 3).map((call) => call.body.startRow),
    [0, 100, 200],
  );
  assert.ok(calls.every((call) => call.path.startsWith("/imports/import-1/")));
  assert.equal(calls[0].body.rows[0][1], "0007");
  const receipts = calls.map((call) => call.body.operationId);
  calls.length = 0;
  await imports.uploadSharedContactRows(options);
  assert.deepEqual(
    calls.map((call) => call.body.operationId),
    receipts,
  );
});

test("contact API binds scope, checks async ownership, and never uses the Prompt route", async () => {
  let active = true;
  const calls = [];
  const guard = () => {
    if (!active) throw new Error("scope changed");
  };
  const api = createOrganizationContactsApi({
    scopeKey: "coalition:org-1",
    guard,
    request: async (path, options) => {
      calls.push({ path, options });
      return { ok: true };
    },
  });
  await api("/selections", { includeIds: ["contact-1"], mode: "explicit" });
  assert.equal(
    calls[0].path,
    "/api/contact-book/scopes/coalition%3Aorg-1/selections",
  );
  assert.equal(calls[0].options.auth, true);
  active = false;
  await assert.rejects(api("/schema"), /scope changed/);
  assert.equal(calls.length, 1);
});

test("CSV downloads preserve data and prevent spreadsheet formula evaluation", () => {
  assert.equal(model.contactCsvCell("0007"), '"0007"');
  assert.equal(model.contactCsvCell(0), '"0"');
  assert.equal(model.contactCsvCell(false), '"false"');
  assert.equal(
    model.contactCsvCell('=HYPERLINK("example")'),
    '"\'=HYPERLINK(""example"")"',
  );
  assert.equal(model.contactCsvCell("\t+12025550121"), '"\'\t+12025550121"');
});

test("resume rejects changed headers and truncated files without closing the original job", async () => {
  const calls = [];
  const options = {
    file: new Blob(["name,tax\nExample One,0007\n"]),
    job: {
      importId: "original",
      operationId: "resume:original",
      columns: ["name", "tax"],
      accepted: 2,
      conflicts: 0,
    },
    api: async (path, body) => {
      calls.push({ path, body });
      return acknowledge(body);
    },
    guard() {},
    progress() {},
  };
  await assert.rejects(imports.uploadSharedContactRows(options), /shorter/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.startRow, 0);
  calls.length = 0;
  await assert.rejects(
    imports.uploadSharedContactRows({
      ...options,
      file: new Blob(["tax,name\n0007,Example One\n"]),
    }),
    /different columns/,
  );
  assert.equal(calls.length, 0);
});

test("UTF8 payload limit adaptively flushes long records and preserves absent trailing cells", async () => {
  const calls = [];
  const options = {
    file: new Blob([
      "name,notes\n" +
        Array(10)
          .fill("Example," + "界".repeat(40000))
          .join("\n") +
        "\nOnly name\n",
    ]),
    job: {
      importId: "large",
      operationId: "large-1",
      columns: ["name", "notes"],
    },
    api: async (path, body) => {
      calls.push({ path, body });
      return acknowledge(body);
    },
    guard() {},
    progress() {},
  };
  await imports.uploadSharedContactRows(options);
  const requests = calls.filter((call) => call.body.rows);
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every(
      (call) => Buffer.byteLength(JSON.stringify(call.body)) < 900000,
    ),
  );
  assert.deepEqual(requests.at(-1).body.rows.at(-1), ["Only name"]);
  calls.length = 0;
  await assert.rejects(
    imports.uploadSharedContactRows({
      ...options,
      file: new Blob(["name,notes\nExample," + "界".repeat(300000)]),
    }),
    /too large/,
  );
  assert.equal(calls.length, 0);
});

test("structured editors round-trip nested properties and reject malformed or oversized JSON", () => {
  const original = {
    line1: "12 Fictional Lane",
    unit: "0002",
    flags: { visited: false },
    taxDistricts: ["0007", "0012"],
  };
  assert.deepEqual(
    model.typedContactInput(JSON.stringify(original), {
      type: "json",
      label: "Address details",
    }),
    original,
  );
  assert.throws(
    () =>
      model.typedContactInput('{"broken":', {
        type: "json",
        label: "Address details",
      }),
    /structured/,
  );
  assert.throws(
    () =>
      model.typedContactInput('"not an address object"', {
        type: "address",
        label: "Address",
      }),
    /structured/,
  );
  assert.throws(
    () =>
      model.typedContactInput('{"number":1e400}', {
        type: "json",
        label: "Notes",
      }),
    /structured/,
  );
  assert.throws(
    () =>
      model.typedContactInput(JSON.stringify({ text: "x".repeat(65536) }), {
        type: "json",
        label: "Notes",
      }),
    /structured/,
  );
});

test("match previews bound UTF8 sample payloads without altering retained values", () => {
  const cell = "🌲".repeat(80000);
  const input = {
    columns: ["Original"],
    mapping: { 0: "__custom__" },
    rows: [[cell], [cell], [cell]],
    sourceNamespace: "fictional",
    sourcePolicy: { permittedPurpose: "not_for_sms" },
  };
  const preview = imports.boundedContactImportPreview(input);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0][0], cell);
  assert.equal(input.rows.length, 3);
  assert.ok(
    Buffer.byteLength(JSON.stringify(preview)) <=
      imports.CONTACT_IMPORT_MAX_REQUEST_BYTES,
  );
  assert.throws(
    () =>
      imports.boundedContactImportPreview({
        ...input,
        rows: [["🌲".repeat(300000)]],
      }),
    /first source record exceeds/,
  );
});

test("tag group columns summarize underlying memberships without duplicating values", () => {
  const definition = {
    fieldId: "tag_group:interests",
    memberTags: [
      { tagId: "t1", label: "Volunteer" },
      { tagId: "t2", label: "Events" },
    ],
  };
  assert.deepEqual(model.contactValue({ tags: ["t1"] }, definition), [
    "Volunteer",
  ]);
  assert.deepEqual(model.contactValue({ tags: ["unrelated"] }, definition), []);
});
