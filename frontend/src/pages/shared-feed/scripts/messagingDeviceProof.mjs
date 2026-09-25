const DOMAIN = "polis-messaging-device-proof-v1";
const BOOTSTRAP = "/api/messaging/bootstrap";
const REGISTER = "/api/messaging/devices/register";

export function proofBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function proofDecodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
    (char) => char.charCodeAt(0),
  );
}

export function canonicalProofJson(value) {
  function normalize(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number" && Number.isSafeInteger(item))
      return Object.is(item, -0) ? 0 : item;
    if (Array.isArray(item)) return item.map(normalize);
    if (
      item &&
      typeof item === "object" &&
      Object.getPrototypeOf(item) === Object.prototype
    ) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])]),
      );
    }
    throw new Error("messaging_proof_invalid_json");
  }
  if (
    !value ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("messaging_proof_object_required");
  return JSON.stringify(normalize(value));
}

/** Generate actual key pairs; the non-extractable private keys stay in IndexedDB. */
export async function generateBrowserMessagingDevice(
  crypto,
  deviceLabel = "Browser device",
) {
  let signing;
  let identity;
  let prekey;
  try {
    [signing, identity, prekey] = await Promise.all([
      crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]),
      crypto.subtle.generateKey("X25519", false, ["deriveBits"]),
      crypto.subtle.generateKey("X25519", false, ["deriveBits"]),
    ]);
  } catch {
    throw new Error("messaging_browser_crypto_unsupported");
  }
  const publicBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", prekey.publicKey),
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    signing.privateKey,
    publicBytes,
  );
  const oneTimePreKeys = await Promise.all(
    Array.from({ length: 24 }, async () => {
      const pair = await crypto.subtle.generateKey("X25519", false, [
        "deriveBits",
      ]);
      return {
        prekeyId: `otk_${crypto.randomUUID()}`,
        publicKey: proofBase64Url(
          await crypto.subtle.exportKey("raw", pair.publicKey),
        ),
        privateKey: pair.privateKey,
      };
    }),
  );
  return {
    materialVersion: 2,
    deviceId: crypto.randomUUID(),
    platform: "web",
    deviceLabel,
    identityKey: proofBase64Url(
      await crypto.subtle.exportKey("raw", identity.publicKey),
    ),
    signingKey: proofBase64Url(
      await crypto.subtle.exportKey("raw", signing.publicKey),
    ),
    signingPrivateKey: signing.privateKey,
    identityPrivateKey: identity.privateKey,
    signedPreKey: {
      prekeyId: `spk_${crypto.randomUUID()}`,
      publicKey: proofBase64Url(publicBytes),
      signature: proofBase64Url(signature),
      privateKey: prekey.privateKey,
    },
    oneTimePreKeys,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function signMessagingRequest({
  crypto,
  device,
  userId,
  context,
  method = "GET",
  path,
  body = {},
  now = Date.now(),
  nonce = crypto.randomUUID(),
}) {
  const uri = new URL(path, "https://messaging.invalid");
  if (
    !path.startsWith("/api/messaging/") ||
    uri.hash ||
    !userId ||
    !device?.signingPrivateKey ||
    !context ||
    typeof context.rootPresent !== "boolean" ||
    !Number.isSafeInteger(context.trustEpoch) ||
    context.trustEpoch < 1 ||
    !Number.isSafeInteger(context.trustSetVersion) ||
    context.trustSetVersion < 1 ||
    !Number.isSafeInteger(now) ||
    now < 1 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)
  )
    throw new Error("messaging_proof_not_ready");
  const query = {};
  for (const [key, value] of uri.searchParams) {
    if (Object.hasOwn(query, key))
      throw new Error("messaging_proof_duplicate_query");
    Object.defineProperty(query, key, {
      value,
      enumerable: true,
      configurable: true,
    });
  }
  const normalizedMethod = method.toUpperCase();
  const purpose =
    `${normalizedMethod.toLowerCase()}:${uri.pathname}`.toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:/-]{2,159}$/.test(purpose))
    throw new Error("messaging_proof_invalid_purpose");
  const digest = async (bytes) =>
    proofBase64Url(await crypto.subtle.digest("SHA-256", bytes));
  const encode = (value) => new TextEncoder().encode(value);
  const [fingerprint, bodyDigest, queryDigest] = await Promise.all([
    digest(proofDecodeBase64Url(device.signingKey)),
    digest(encode(canonicalProofJson(body))),
    digest(encode(canonicalProofJson(query))),
  ]);
  const signed = [
    DOMAIN,
    userId,
    device.deviceId,
    context.rootPresent ? "1" : "0",
    `${context.trustEpoch}`,
    `${context.trustSetVersion}`,
    fingerprint,
    purpose,
    normalizedMethod,
    uri.pathname,
    bodyDigest,
    queryDigest,
    `${now}`,
    nonce,
  ].join("\n");
  const signature = await crypto.subtle.sign(
    "Ed25519",
    device.signingPrivateKey,
    encode(signed),
  );
  return {
    "X-Messaging-Device-Id": device.deviceId,
    "X-Messaging-Device-Proof-Version": "1",
    "X-Messaging-Device-Proof-Root-Present": context.rootPresent ? "1" : "0",
    "X-Messaging-Device-Proof-Trust-Epoch": `${context.trustEpoch}`,
    "X-Messaging-Device-Proof-Trust-Set-Version": `${context.trustSetVersion}`,
    "X-Messaging-Device-Proof-Key-Fingerprint": fingerprint,
    "X-Messaging-Device-Proof-Purpose": purpose,
    "X-Messaging-Device-Proof-Timestamp": `${now}`,
    "X-Messaging-Device-Proof-Nonce": nonce,
    "X-Messaging-Device-Proof-Signature": proofBase64Url(signature),
  };
}

function readContext(payload) {
  const source =
    payload?.deviceProofContext || payload?.config?.deviceProofContext;
  if (
    !source ||
    typeof source.rootPresent !== "boolean" ||
    !Number.isSafeInteger(source.trustEpoch) ||
    source.trustEpoch < 1 ||
    !Number.isSafeInteger(source.trustSetVersion) ||
    source.trustSetVersion < 1
  )
    return null;
  return {
    rootPresent: source.rootPresent,
    trustEpoch: source.trustEpoch,
    trustSetVersion: source.trustSetVersion,
  };
}

/** Protect every authenticated Messenger request at the shared fetch boundary. */
export function createMessagingProofTransport({
  getUserId,
  sendRequest,
  deviceStore,
  crypto = globalThis.crypto,
}) {
  let session = null;
  function currentSession() {
    const userId = String(getUserId() || "").trim();
    if (!userId) {
      session = null;
      throw new Error("messaging_account_required");
    }
    if (session?.userId !== userId)
      session = {
        userId,
        modern: false,
        context: null,
        highWater: null,
        legacy: false,
        bootstrap: null,
        registering: null,
        registered: false,
      };
    return session;
  }
  function fence(state) {
    if (session !== state || String(getUserId() || "").trim() !== state.userId)
      throw new Error("messaging_account_changed");
  }
  function record(state, payload, bootstrap = false) {
    fence(state);
    const config = payload?.config;
    const capability =
      config?.capabilities?.deviceRequestProofV1 === true ||
      payload?.capabilities?.deviceRequestProofV1 === true;
    state.modern ||=
      capability ||
      Object.hasOwn(payload || {}, "deviceProofContext") ||
      Object.hasOwn(config || {}, "deviceProofContext");
    const context = readContext(payload);
    const previous = state.highWater;
    if (
      context &&
      (!previous ||
        context.trustEpoch > previous.trustEpoch ||
        (context.trustEpoch === previous.trustEpoch &&
          context.trustSetVersion >= previous.trustSetVersion &&
          !(previous.rootPresent && !context.rootPresent)))
    ) {
      state.context = context;
      state.highWater = context;
    }
    if (bootstrap) {
      state.legacy =
        !state.modern &&
        payload?.ok === true &&
        config?.capabilities &&
        typeof config.capabilities === "object" &&
        !Array.isArray(config.capabilities) &&
        Object.keys(config.capabilities).length > 0;
      if ((!state.modern && !state.legacy) || (state.modern && !state.context))
        throw new Error("messaging_protection_unavailable");
    }
  }
  async function bootstrap(state, refresh = false) {
    if (state.bootstrap) return state.bootstrap;
    if (refresh) {
      state.context = null;
      state.legacy = false;
    }
    if (!refresh && (state.context || state.legacy)) return null;
    const pending = (async () => {
      const payload = await sendRequest(BOOTSTRAP, { auth: true });
      record(state, payload, true);
      return payload;
    })();
    state.bootstrap = pending;
    try {
      return await pending;
    } finally {
      if (state.bootstrap === pending) state.bootstrap = null;
    }
  }
  async function signedHeaders(state, path, options = {}) {
    await bootstrap(state);
    const device = await deviceStore.currentDevice();
    fence(state);
    const headers = await signMessagingRequest({
      crypto,
      device,
      userId: state.userId,
      context:
        state.context ||
        (state.legacy && !state.modern
          ? { rootPresent: false, trustEpoch: 1, trustSetVersion: 1 }
          : null),
      method: options.method || "GET",
      path,
      body: options.body ?? {},
    });
    fence(state);
    return headers;
  }
  async function protectedSend(state, path, options) {
    // Sign and transmit the same immutable JSON representation. JSON transport
    // omits optional undefined object members before the server canonicalizes it.
    const wireOptions = {
      ...options,
      ...(options.body === undefined
        ? {}
        : { body: JSON.parse(JSON.stringify(options.body)) }),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const proof = await signedHeaders(state, path, wireOptions);
      fence(state);
      try {
        const result = await sendRequest(path, {
          ...wireOptions,
          headers: { ...(wireOptions.headers || {}), ...proof },
        });
        record(state, result);
        return result;
      } catch (error) {
        fence(state);
        const code =
          error?.payload?.error || error?.payload?.message || error?.message;
        if (
          attempt ||
          error?.status !== 403 ||
          !["invalid_device_proof", "device_proof_stale"].includes(code)
        )
          throw error;
        await bootstrap(state, true);
      }
    }
  }
  async function register(state) {
    if (state.registered) return;
    if (state.registering) return state.registering;
    const pending = (async () => {
      await bootstrap(state);
      const body = await deviceStore.buildRegistrationPayload();
      fence(state);
      await protectedSend(state, REGISTER, {
        auth: true,
        method: "POST",
        body,
      });
      fence(state);
      state.registered = true;
    })();
    state.registering = pending;
    try {
      await pending;
    } finally {
      if (state.registering === pending) state.registering = null;
    }
  }
  return {
    async request(path, options = {}) {
      if (!options.auth || !path.startsWith("/api/messaging/"))
        return sendRequest(path, options);
      const state = currentSession();
      if (new URL(path, "https://messaging.invalid").pathname === BOOTSTRAP) {
        return bootstrap(state, true);
      }
      if (new URL(path, "https://messaging.invalid").pathname !== REGISTER)
        await register(state);
      const result = await protectedSend(state, path, options);
      if (new URL(path, "https://messaging.invalid").pathname === REGISTER)
        state.registered = true;
      return result;
    },
    async realtimeAuth() {
      const state = currentSession();
      await bootstrap(state, true);
      await register(state);
      const deviceId = await deviceStore.currentDeviceId();
      const deviceProof = await signedHeaders(
        state,
        "/api/messaging/realtime/auth",
        { method: "POST", body: { deviceId } },
      );
      fence(state);
      return { deviceId, deviceProof };
    },
    reset() {
      session = null;
    },
    resetDevice() {
      const state = currentSession();
      session = {
        ...state,
        bootstrap: null,
        registering: null,
        registered: false,
      };
    },
  };
}
