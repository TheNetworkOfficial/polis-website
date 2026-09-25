import assert from "node:assert/strict";
import { webcrypto, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalProofJson,
  createMessagingProofTransport,
  generateBrowserMessagingDevice,
  proofDecodeBase64Url,
  signMessagingRequest,
} from "../../frontend/src/pages/shared-feed/scripts/messagingDeviceProof.mjs";

const modulePath = new URL(
  "../../frontend/src/pages/shared-feed/scripts/webMessaging.js",
  import.meta.url,
);
const proofPath = new URL(
  "../../frontend/src/pages/shared-feed/scripts/messagingDeviceProof.mjs",
  import.meta.url,
);
const source = (await readFile(modulePath, "utf8")).replace(
  '"./messagingDeviceProof.mjs"',
  JSON.stringify(proofPath.href),
);
const { createMessagingBrowserDevice, createMessagingSocketClient } =
  await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
const context = { rootPresent: true, trustEpoch: 2, trustSetVersion: 3 };
const modern = {
  ok: true,
  config: {
    capabilities: { deviceRequestProofV1: true },
    deviceProofContext: context,
  },
};
const legacy = { ok: true, config: { capabilities: { rooms: true } } };
const prefix = "X-Messaging-Device-Proof-";
const generated = await generateBrowserMessagingDevice(webcrypto);

function browser() {
  const local = new Map();
  const timers = new Map();
  let timerId = 0;
  globalThis.window = {
    crypto: webcrypto,
    navigator: { platform: "Test browser" },
    localStorage: {
      getItem: (key) => local.get(key) ?? null,
      setItem: (key, value) => local.set(key, value),
      removeItem: (key) => local.delete(key),
    },
    setTimeout: (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearInterval: (id) => timers.delete(id),
  };
  return { local, timers };
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    read: async (key) => values.get(key) ?? null,
    write: async (key, value, { createOnly } = {}) => {
      if (!createOnly || !values.has(key)) values.set(key, value);
      return values.get(key);
    },
  };
}

function transportFixture(handler = async () => ({})) {
  let userId = "user-a";
  let bootstrapPayload = modern;
  const requests = [];
  const deviceStore = {
    currentDevice: async () => generated,
    currentDeviceId: async () => generated.deviceId,
    buildRegistrationPayload: async () => ({
      deviceId: generated.deviceId,
      signingKey: generated.signingKey,
    }),
  };
  const transport = createMessagingProofTransport({
    crypto: webcrypto,
    deviceStore,
    getUserId: () => userId,
    sendRequest: async (path, options) => {
      requests.push({ path, options });
      if (path === "/api/messaging/bootstrap")
        return typeof bootstrapPayload === "function"
          ? bootstrapPayload()
          : bootstrapPayload;
      return handler(path, options);
    },
  });
  return {
    transport,
    requests,
    setUser: (next) => {
      userId = next;
    },
    setBootstrap: (next) => {
      bootstrapPayload = next;
    },
  };
}

test("Ed25519 proof exactly matches the independent backend/mobile signing vector", async () => {
  const seed = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  const signingPrivateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    "Ed25519",
    false,
    ["sign"],
  );
  const headers = await signMessagingRequest({
    crypto: webcrypto,
    device: {
      deviceId: "browser-proof-fixture",
      signingKey: "A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg",
      signingPrivateKey,
    },
    userId: "11111111-1111-4111-8111-111111111111",
    context,
    method: "GET",
    path: "/api/messaging/setup-state",
    now: 1700000000000,
    nonce: "fixture_nonce_00000001",
  });
  assert.equal(
    headers[`${prefix}Key-Fingerprint`],
    "Vkdap1RjR0wChd9dvyvKtz2mUTWIOem3dIGy6rEHcIw",
  );
  assert.equal(
    headers[`${prefix}Signature`],
    "GwAnkdsWUs0HeK2KyVWI9mDVettDGx8tKa98ezgFE32dYipO5-VAFBK6caR0YDtfZ-3ZK9irRAqCgg48-OMNBw",
  );
});

test("browser device has real signed X25519 prekeys and non-extractable private keys", async () => {
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      proofDecodeBase64Url(generated.signingKey),
    ]),
    format: "der",
    type: "spki",
  });
  assert.equal(
    verify(
      null,
      proofDecodeBase64Url(generated.signedPreKey.publicKey),
      publicKey,
      proofDecodeBase64Url(generated.signedPreKey.signature),
    ),
    true,
  );
  assert.equal(generated.signingPrivateKey.extractable, false);
  assert.equal(generated.identityPrivateKey.extractable, false);
  assert.equal(generated.oneTimePreKeys.length, 24);
  assert.equal(
    new Set(generated.oneTimePreKeys.map((key) => key.publicKey)).size,
    24,
  );
  await assert.rejects(
    webcrypto.subtle.exportKey("pkcs8", generated.signingPrivateKey),
  );
});

test("canonical JSON sorts nested objects, preserves arrays, and rejects unsafe data", () => {
  assert.equal(
    canonicalProofJson({ z: [-0, { y: 2, a: 1 }], a: true }),
    '{"a":true,"z":[0,{"a":1,"y":2}]}',
  );
  for (const value of [
    { a: 1.5 },
    { a: Number.MAX_SAFE_INTEGER + 1 },
    { a: undefined },
    { a: NaN },
    [],
    null,
  ])
    assert.throws(() => canonicalProofJson(value));
});

test("proof binds decoded query values and rejects duplicate keys", async () => {
  const input = {
    crypto: webcrypto,
    device: generated,
    userId: "user-a",
    context,
    now: 1700000000000,
    nonce: "fixture_nonce_00000001",
  };
  const first = await signMessagingRequest({
    ...input,
    path: "/api/messaging/conversations?q=hello+world&z=%2B",
  });
  const same = await signMessagingRequest({
    ...input,
    path: "/api/messaging/conversations?z=%2B&q=hello%20world",
  });
  const changed = await signMessagingRequest({
    ...input,
    path: "/api/messaging/conversations?q=hello&z=%2B",
  });
  assert.equal(first[`${prefix}Signature`], same[`${prefix}Signature`]);
  assert.notEqual(first[`${prefix}Signature`], changed[`${prefix}Signature`]);
  await assert.rejects(
    signMessagingRequest({
      ...input,
      path: "/api/messaging/conversations?a=1&a=2",
    }),
    /duplicate_query/,
  );
});

test("legacy defaults require a successful old bootstrap and still sign requests", async () => {
  const fixture = transportFixture();
  fixture.setBootstrap(legacy);
  await fixture.transport.request("/api/messaging/devices", { auth: true });
  const sent = fixture.requests.filter(
    ({ path }) => path !== "/api/messaging/bootstrap",
  );
  assert.equal(sent.length, 2);
  for (const { options } of sent) {
    assert.equal(options.headers[`${prefix}Root-Present`], "0");
    assert.equal(options.headers[`${prefix}Trust-Epoch`], "1");
    assert.ok(options.headers[`${prefix}Signature`]);
  }
});

test("empty or failed bootstrap never permits an unsigned fallback", async () => {
  for (const payload of [
    {},
    { ok: false, config: legacy.config },
    { ok: true, config: {} },
    { ok: true, config: { capabilities: {} } },
  ]) {
    const fixture = transportFixture();
    fixture.setBootstrap(payload);
    await assert.rejects(
      fixture.transport.request("/api/messaging/devices", { auth: true }),
      /protection_unavailable/,
    );
    assert.equal(fixture.requests.length, 1);
  }
});

test("modern observation is sticky and rejects absent/regressing refreshed context", async () => {
  for (const downgraded of [
    legacy,
    {
      ...modern,
      config: {
        ...modern.config,
        deviceProofContext: { ...context, trustEpoch: 1 },
      },
    },
    {
      ...modern,
      config: {
        ...modern.config,
        deviceProofContext: { ...context, rootPresent: false },
      },
    },
  ]) {
    const fixture = transportFixture();
    await fixture.transport.request("/api/messaging/devices", { auth: true });
    fixture.setBootstrap(downgraded);
    await assert.rejects(
      fixture.transport.request("/api/messaging/bootstrap", { auth: true }),
      /protection_unavailable/,
    );
  }
});

test("stale proof retries once after bootstrap and signs a fresh nonce", async () => {
  let attempts = 0;
  const fixture = transportFixture(async (path) => {
    if (path === "/api/messaging/devices" && attempts++ === 0)
      throw Object.assign(new Error("stale"), {
        status: 403,
        payload: { error: "device_proof_stale" },
      });
    return {};
  });
  await fixture.transport.request("/api/messaging/devices", { auth: true });
  assert.equal(
    fixture.requests.filter(({ path }) => path === "/api/messaging/bootstrap")
      .length,
    2,
  );
  const attemptsSent = fixture.requests.filter(
    ({ path }) => path === "/api/messaging/devices",
  );
  assert.equal(attemptsSent.length, 2);
  assert.notEqual(
    attemptsSent[0].options.headers[`${prefix}Nonce`],
    attemptsSent[1].options.headers[`${prefix}Nonce`],
  );
});

test("replay and trust failures never trigger stale-proof retry", async () => {
  for (const [status, error] of [
    [409, "device_proof_replay"],
    [403, "device_not_trusted"],
    [401, "unauthorized"],
  ]) {
    const fixture = transportFixture(async (path) => {
      if (path === "/api/messaging/devices")
        throw Object.assign(new Error(error), { status, payload: { error } });
      return {};
    });
    await assert.rejects(
      fixture.transport.request("/api/messaging/devices", { auth: true }),
    );
    assert.equal(
      fixture.requests.filter(({ path }) => path === "/api/messaging/devices")
        .length,
      1,
    );
  }
});

test("parallel requests coalesce bootstrap and registration", async () => {
  const fixture = transportFixture();
  await Promise.all([
    fixture.transport.request("/api/messaging/devices", { auth: true }),
    fixture.transport.request("/api/messaging/recovery/status", { auth: true }),
  ]);
  assert.equal(
    fixture.requests.filter(({ path }) => path === "/api/messaging/bootstrap")
      .length,
    1,
  );
  assert.equal(
    fixture.requests.filter(({ path }) => path.endsWith("/register")).length,
    1,
  );
});

test("account switch fences pending bootstrap and restarts proof state", async () => {
  let resolveBootstrap;
  const fixture = transportFixture();
  fixture.setBootstrap(
    () =>
      new Promise((resolve) => {
        resolveBootstrap = resolve;
      }),
  );
  const pending = fixture.transport.request("/api/messaging/devices", {
    auth: true,
  });
  fixture.setUser("user-b");
  resolveBootstrap(modern);
  await assert.rejects(pending, /account_changed/);
  assert.equal(fixture.requests.length, 1);
  fixture.setBootstrap(legacy);
  await fixture.transport.request("/api/messaging/devices", { auth: true });
  assert.equal(
    fixture.requests.at(-1).options.headers[`${prefix}Root-Present`],
    "0",
  );
});

test("non-messaging and unauthenticated requests preserve their exact options", async () => {
  const fixture = transportFixture();
  const options = { auth: true, body: { value: 1 } };
  await fixture.transport.request("/api/profiles/me", options);
  await fixture.transport.request("/api/messaging/bootstrap", { auth: false });
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.requests[0].options, options);
});

test("legacy browser material is preserved and requires explicit new-device setup", async () => {
  const { local } = browser();
  const secureStorage = memoryStorage();
  const old = JSON.stringify({
    deviceId: "legacy-trusted-id",
    signingKey: "random-with-no-secret",
  });
  local.set("device", old);
  const device = createMessagingBrowserDevice({
    getUserId: () => "user-a",
    secureStorage,
  });
  await assert.rejects(device.currentDevice(), /browser_setup_required/);
  assert.equal(device.requiresSetup(), true);
  assert.equal(secureStorage.values.size, 0);
  await device.prepareNewBrowserDevice();
  const current = await device.currentDevice();
  assert.notEqual(current.deviceId, "legacy-trusted-id");
  assert.equal(local.get("device"), old);
  const registration = await device.buildRegistrationPayload();
  assert.equal(registration.signingKey, current.signingKey);
  assert.equal(JSON.stringify(registration).includes("privateKey"), false);
  assert.equal(device.requiresSetup(), false);
});

test("browser devices are account-scoped and persist across device-store instances", async () => {
  browser();
  const secureStorage = memoryStorage();
  let userId = "a";
  const device = createMessagingBrowserDevice({
    getUserId: () => userId,
    secureStorage,
  });
  const first = await device.currentDeviceId();
  userId = "b";
  assert.notEqual(await device.currentDeviceId(), first);
  userId = "a";
  const restarted = createMessagingBrowserDevice({
    getUserId: () => userId,
    secureStorage,
  });
  assert.equal(await restarted.currentDeviceId(), first);
  assert.equal(secureStorage.values.size, 2);
});

test("unavailable secure storage fails closed without generating a replacement", async () => {
  browser();
  let writes = 0;
  const device = createMessagingBrowserDevice({
    getUserId: () => "a",
    secureStorage: {
      read: async () => {
        throw new Error("storage unavailable");
      },
      write: async () => {
        writes++;
      },
    },
  });
  await assert.rejects(device.currentDevice(), /storage unavailable/);
  assert.equal(writes, 0);
  const noIndexedDb = createMessagingBrowserDevice({ getUserId: () => "a" });
  await assert.rejects(noIndexedDb.currentDevice(), /storage_required/);
});

test("browser cannot create placeholder recovery backups or transfer encrypted keys", async () => {
  browser();
  const secureStorage = memoryStorage();
  const device = createMessagingBrowserDevice({
    getUserId: () => "a",
    secureStorage,
  });
  await device.currentDevice();
  for (const operation of [
    () => device.createRecoveryEnrollment(),
    () => device.restoreFromRecoveryBundle(),
    () => device.currentRecoveryRestoreProof(),
    () => device.buildTrustedDeviceTransferPayload(),
    () => device.importTrustedDeviceTransferPayload(),
  ]) {
    await assert.rejects(operation(), /updated Polis app/);
  }
  assert.equal(secureStorage.values.size, 1);
});

function socketFixture() {
  const { timers } = browser();
  const sockets = [];
  let account = "a";
  let failures = 0;
  const events = [];
  class Socket {
    handlers = {};
    sent = [];
    closed = false;
    constructor() {
      sockets.push(this);
    }
    addEventListener(type, listener) {
      this.handlers[type] = listener;
    }
    async emit(type, value = {}) {
      await this.handlers[type]?.(value);
    }
    send(value) {
      this.sent.push(JSON.parse(value));
    }
    close() {
      this.closed = true;
      this.handlers.close?.({ code: 1000 });
    }
  }
  window.WebSocket = Socket;
  const client = createMessagingSocketClient({
    getAccountId: () => account,
    getAuthToken: async () => "synthetic-token",
    getDeviceProof: async () => ({
      deviceId: "test-device",
      deviceProof: { signed: true },
    }),
    onProtocolError: () => {
      failures++;
    },
    onEvent: (event) => events.push(event),
  });
  return {
    client,
    sockets,
    timers,
    events,
    failures: () => failures,
    setAccount: (value) => {
      account = value;
    },
  };
}

test("WebSocket AUTH contains proof and subscriptions wait for READY", async () => {
  const fixture = socketFixture();
  fixture.client.subscribeInbox();
  await fixture.client.retainSession("wss://example.invalid");
  const socket = fixture.sockets[0];
  await socket.emit("open");
  assert.deepEqual(socket.sent, [
    {
      type: "AUTH",
      token: "synthetic-token",
      deviceId: "test-device",
      deviceProof: { signed: true },
    },
  ]);
  assert.equal(fixture.client.getStateSnapshot().connectionState, "connecting");
  await socket.emit("message", { data: JSON.stringify({ type: "READY" }) });
  assert.equal(fixture.client.getStateSnapshot().connectionState, "connected");
  assert.equal(socket.sent.at(-1).type, "SUBSCRIBE_INBOX");
  fixture.client.dispose();
});

test("WebSocket trust rejection stops automatic reconnect", async () => {
  for (const viaClose of [true, false]) {
    const fixture = socketFixture();
    await fixture.client.retainSession("wss://example.invalid");
    const socket = fixture.sockets[0];
    await socket.emit("open");
    await socket.emit(
      viaClose ? "close" : "message",
      viaClose
        ? { code: 4003 }
        : {
            data: JSON.stringify({
              type: "ERROR",
              code: "DEVICE_SETUP_REQUIRED",
            }),
          },
    );
    assert.equal(fixture.failures(), 1);
    assert.equal(fixture.timers.size, 0);
    await fixture.client.ensureConnected();
    assert.equal(fixture.sockets.length, 1);
    fixture.client.dispose();
  }
});

test("old-account socket cannot authenticate, deliver events, or retain conversation subscriptions", async () => {
  const fixture = socketFixture();
  await fixture.client.retainSession("wss://example.invalid");
  const socket = fixture.sockets[0];
  fixture.client.subscribeConversation("old-conversation");
  fixture.setAccount("b");
  await socket.emit("open");
  await socket.emit("message", { data: JSON.stringify({ type: "READY" }) });
  assert.equal(socket.sent.length, 0);
  assert.equal(fixture.events.length, 0);
  await fixture.client.ensureConnected();
  assert.equal(socket.closed, true);
  assert.deepEqual(
    fixture.client.getStateSnapshot().conversationSubscriptions,
    [],
  );
  fixture.client.dispose();
});
