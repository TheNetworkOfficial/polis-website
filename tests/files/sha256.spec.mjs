import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL(
  "../../frontend/src/pages/files/scripts/sha256.js",
  import.meta.url,
);
const source = await readFile(sourceUrl, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { checksumBlob } = await import(moduleUrl);

function expectedBase64(value) {
  return createHash("sha256").update(value).digest("base64");
}

test("incremental SHA-256 matches the empty known vector", async () => {
  assert.equal(
    await checksumBlob(new Blob([])),
    expectedBase64(Buffer.alloc(0)),
  );
});

test("incremental SHA-256 matches the abc known vector", async () => {
  assert.equal(await checksumBlob(new Blob(["abc"])), expectedBase64("abc"));
});

test("incremental SHA-256 matches Node across many uneven chunks", async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 137);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * 31 + 17) % 256;
  }
  const progress = [];
  const actual = await checksumBlob(new Blob([bytes]), {
    chunkSize: 8191,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(actual, expectedBase64(bytes));
  assert.equal(progress.at(-1), 1);
  assert.ok(
    progress.length > 200,
    "fixture should exercise incremental boundaries",
  );
});
