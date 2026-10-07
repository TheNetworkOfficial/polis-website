import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { moduleUrl } from "./module-fixture.mjs";

test("ordinary web forms never ask users to enter internal Polis user IDs", async () => {
  const source = await readFile(
    new URL(
      "../../frontend/src/pages/shared-feed/shared-feed.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.deepEqual(
    source.match(
      /<span>[^<]*user[ -]?ids?[^<]*<\/span>\s*<(?:input|textarea)\b/giu,
    ) || [],
    [],
  );
  assert.doesNotMatch(source, /<textarea\b[^>]*name="memberUserIds"/u);
  assert.match(source, /renderOrganizationPersonField\("fromUserId"/u);
  assert.match(source, /renderOrganizationPersonField\("toUserId"/u);
});

test("shared person field keeps current identity internal and escapes display controls", async () => {
  const { renderOrganizationPersonField } = await import(
    await moduleUrl("organizationPersonField")
  );
  const markup = renderOrganizationPersonField("leadUserId", "Choose lead", {
    value: "internal-id",
  });
  assert.match(markup, /type="hidden" name="leadUserId" value="internal-id"/u);
  assert.doesNotMatch(markup, />internal-id</u);
  assert.match(markup, /data-person-choose/u);
});
