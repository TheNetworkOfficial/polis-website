import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/textingSession.js",
    import.meta.url,
  ),
  "utf8",
);
const { createTextingSessionRequest } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("texting refreshes an expired session once before requests without retrying a mutation", async () => {
  let session = { userId: "admin", expiresAt: 0, token: "old-test-token" },
    restoreCount = 0,
    complete;
  const calls = [];
  const request = createTextingSessionRequest({
    request: async (path, options) => {
      calls.push({ path, options, token: session.token });
      if (options.method === "POST") throw new TypeError("Failed to fetch");
      return { ok: true };
    },
    getSession: () => session,
    restoreSession: () => {
      restoreCount++;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    saveSession: (next) => {
      session = next;
    },
    userId: (value) => value?.userId,
    contextKey: () => "/organizations/example/texting/contacts/import-one",
  });
  const read = request("/workspace", { auth: true });
  const mutation = request("/provider-sync", {
    auth: true,
    method: "POST",
    body: {},
  });
  const rejected = assert.rejects(mutation, /Failed to fetch/);
  await Promise.resolve();
  assert.equal(calls.length, 0);
  assert.equal(restoreCount, 1);
  complete({
    userId: "admin",
    expiresAt: Date.now() + 3600000,
    token: "new-test-token",
  });
  await read;
  await rejected;
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.token === "new-test-token"));
  assert.equal(calls.filter((c) => c.options.method === "POST").length, 1);
});

test("texting blocks transport when session recovery fails or the route or operation changed", async () => {
  for (const change of ["expired", "actor", "route", "operation"]) {
    let session = { userId: "admin" },
      route = "original",
      complete;
    const request = createTextingSessionRequest({
      request: () => assert.fail("Old-context transport must not run"),
      getSession: () => session,
      restoreSession: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      saveSession: (next) => {
        session = next;
      },
      userId: (value) => value?.userId,
      contextKey: () => route,
    });
    const pending = request("/provider-sync", {
      auth: true,
      method: "POST",
      body: {},
      beforeRequest: () => {
        if (change === "operation") throw new Error("Workspace changed");
      },
    });
    const rejection = assert.rejects(
      pending,
      change === "expired" ? { status: 401 } : /Workspace changed/,
    );
    await Promise.resolve();
    if (change === "actor") session = { userId: "other-admin" };
    if (change === "route") route = "other-organization";
    complete(change === "expired" ? null : { userId: "admin" });
    await rejection;
  }
});
