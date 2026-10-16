import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const urls = new Map();
async function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let source = await readFile(
    new URL(
      `../../frontend/src/pages/shared-feed/scripts/${name}.js`,
      import.meta.url,
    ),
    "utf8",
  );
  for (const match of [
    ...source.matchAll(/from "\.\/(organizationContact\w+)"/g),
  ])
    source = source.replace(match[0], `from "${await moduleUrl(match[1])}"`);
  const result = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  urls.set(name, result);
  return result;
}
const names = await import(await moduleUrl("organizationContactImportNames"));
const review = await import(await moduleUrl("organizationContactNameReview"));
const imports = await import(await moduleUrl("organizationContactImport"));
const mapping = { 0: "displayName", 1: "phone", 2: "postalCode" };
const csvName = (name) => `"${name.replaceAll('"', '""')}"`;

test("the shared name corpus keeps browser and service policy aligned", async () => {
  const corpus = JSON.parse(
    await readFile(
      new URL("../fixtures/contact-import-name-cases.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(corpus.cases.length, 46);
  for (const fixture of corpus.cases) {
    const result = names.deriveImportNames(fixture.fields, fixture.namePolicy);
    assert.equal(result.analysis.status, fixture.status, fixture.id);
    assert.equal(
      result.analysis.suggestedFormat,
      fixture.suggestedFormat,
      fixture.id,
    );
    const parts = Object.fromEntries(
      names.NAME_PARTS.filter((field) =>
        Object.hasOwn(result.fields, field),
      ).map((field) => [field, result.fields[field]]),
    );
    assert.deepEqual(parts, fixture.expectedParts, fixture.id);
    for (const field of ["displayName", "fullName"])
      if (Object.hasOwn(fixture.fields, field))
        assert.equal(result.fields[field], fixture.fields[field], fixture.id);
  }
});

test("comma order preserves raw names and explicit parts while filling blank imported parts", () => {
  const input = {
    displayName: "  Example, Alice B.  ",
    firstName: "Alice",
    middleName: " ",
    postalCode: "00007",
  };
  const result = names.deriveImportNames(input, {
    version: 1,
    format: "family_given",
  });
  assert.equal(result.fields.displayName, input.displayName);
  assert.equal(result.fields.firstName, "Alice");
  assert.equal(result.fields.middleName, "B.");
  assert.equal(result.fields.lastName, "Example");
  assert.equal(result.fields.postalCode, "00007");
  assert.equal(input.middleName, " ");
  const conflict = names.deriveImportNames(
    { ...input, firstName: "Different" },
    { version: 1, format: "family_given" },
  );
  assert.equal(conflict.analysis.status, "ambiguous");
  assert.equal(conflict.fields.firstName, "Different");
  assert.equal(conflict.fields.lastName, undefined);
});

test("unclear initial-only, household, suffix and incompatible formats keep originals", () => {
  for (const [original, format] of [
    ["Example, A B", "family_given"],
    ["The Example Household", "given_family"],
    ["Example Jr., Alice B", "family_given"],
    ["Example, Alice B", "given_family"],
    ["Alice Beth Example", "given_family"],
  ]) {
    const result = names.deriveImportNames(
      { displayName: original },
      { version: 1, format },
    );
    assert.equal(result.analysis.status, "ambiguous");
    assert.deepEqual(result.fields, { displayName: original });
  }
  const explicit = names.deriveImportNames({
    firstName: "Alice",
    lastName: "Example",
  });
  assert.equal(explicit.analysis.status, "explicit");
  assert.equal(
    names.deriveImportNames({ displayName: "Alice Example" }).analysis.reason,
    "format_confirmation_required",
  );
});

test("whole-file mixed orders beyond the first 25 select keep and retain a bounded sample", async () => {
  const text =
    "Name,Cell Phone,ZIP Code\n" +
    Array(30)
      .fill(`${csvName("Example, Alice B")},(202) 555-0123,00007`)
      .join("\n") +
    "\nAlice Example,,00008\n";
  const result = await review.reviewContactFile(
    new Blob([text]),
    ",",
    "utf-8",
    { mapping },
  );
  assert.equal(result.rowCount, 31);
  assert.equal(result.rows.length, 25);
  assert.equal(result.suggestedFormat, "keep");
  assert.deepEqual(review.reviewedNamePolicy(result), {
    version: 1,
    format: "keep",
  });
  assert.equal(result.nameReviews.family_given.counts.derived, 30);
  assert.equal(result.nameReviews.family_given.counts.ambiguous, 1);
  assert.equal(result.nameReviews.keep.counts.kept, 31);
  assert.equal(result.phoneEntries, 30);
  assert.equal(result.missingPhones, 1);
  assert.equal(result.rows[0][2], "00007");
  assert.equal(result.nameReviews.keep.examples.length, 8);
});

test("whole-file suggestions accept unambiguous order and leave uncertain rows intact", async () => {
  const file = new Blob([
    `Name\n${csvName("Example, Alice É.")}\n${csvName("Example, A B")}\n`,
  ]);
  const result = await review.reviewContactFile(file, ",", "utf-8", {
    mapping: { 0: "displayName" },
  });
  assert.deepEqual(review.reviewedNamePolicy(result), {
    version: 1,
    format: "family_given",
  });
  const analysis = review.contactNameReview(result);
  assert.equal(analysis.counts.derived, 1);
  assert.equal(analysis.counts.ambiguous, 1);
  assert.equal(analysis.sampleOnly, false);
  assert.equal(review.contactNameReview(result, "keep").counts.kept, 2);
});

test("whole-file scan rejects a malformed late row before creating an import", async () => {
  const file = new Blob([
    "Name,ZIP\n" +
      Array(30).fill("Example Person,00007").join("\n") +
      "\nBad,00008,extra\n",
  ]);
  await assert.rejects(
    imports.inspectContactFile(file, ",", "utf-8"),
    /more cells/,
  );
  const invalidEncoding = new Blob([new Uint8Array([0xff, 0xfe, 0xfa])]);
  await assert.rejects(
    imports.inspectContactFile(invalidEncoding, ",", "utf-8"),
  );
});

test("TSV, UTF-16, multiline quotes and whitespace blanks retain exact source cells", async () => {
  const text =
    'Name\tZIP\tNotes\r\n"Example, Alice B"\t00007\t"two\nlines"\r\n';
  const bytes = Buffer.from("\ufeff" + text, "utf16le");
  const result = await imports.inspectContactFile(
    new Blob([bytes]),
    "\t",
    "utf-16le",
  );
  assert.deepEqual(result.rows, [["Example, Alice B", "00007", "two\nlines"]]);
  assert.equal(result.rowCount, 1);
});
