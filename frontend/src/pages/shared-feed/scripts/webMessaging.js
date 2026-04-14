const DB_NAME = "polis-web-messaging";
const DB_VERSION = 1;
const DB_STORE_NAME = "kv";
const DEVICE_STATE_KEY = "device";
const RECOVERY_STATE_KEY = "recovery";
const CACHE_STATE_KEY = "cache";
const RECOVERY_CODE_GROUPS = 5;
const RECOVERY_CODE_GROUP_LENGTH = 4;
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_KEY_ITERATIONS = 210000;
const DISCONNECT_GRACE_MS = 4000;

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return new Uint8Array();
  }
  const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const decoded = atob(padded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length = 32) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

function randomBase64Url(length = 32) {
  return bytesToBase64Url(randomBytes(length));
}

function buildRecoveryCode() {
  let code = "";
  for (let groupIndex = 0; groupIndex < RECOVERY_CODE_GROUPS; groupIndex += 1) {
    if (groupIndex > 0) {
      code += "-";
    }
    for (
      let charIndex = 0;
      charIndex < RECOVERY_CODE_GROUP_LENGTH;
      charIndex += 1
    ) {
      const randomIndex = Math.floor(
        (window.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) *
          RECOVERY_CODE_ALPHABET.length,
      );
      code += RECOVERY_CODE_ALPHABET[randomIndex];
    }
  }
  return code;
}

async function sha256Base64Url(value) {
  const input = new TextEncoder().encode(normalizeString(value));
  const digest = await window.crypto.subtle.digest("SHA-256", input);
  return bytesToBase64Url(new Uint8Array(digest));
}

async function deriveRecoveryKey(recoveryCode, saltBase64Url) {
  const encoder = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizeString(recoveryCode)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: RECOVERY_KEY_ITERATIONS,
      salt: base64UrlToBytes(saltBase64Url),
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptJsonWithRecoveryKey(value, key) {
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return {
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
  };
}

async function decryptJsonWithRecoveryKey(payload, key) {
  const ciphertextBytes = base64UrlToBytes(payload?.ciphertext);
  const ivBytes = base64UrlToBytes(payload?.iv);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    ciphertextBytes,
  );
  const text = new TextDecoder().decode(decrypted);
  return JSON.parse(text);
}

function openMessagingDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
        database.createObjectStore(DB_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  }).catch(() => null);
}

async function readIndexedValue(key) {
  const database = await openMessagingDatabase();
  if (!database) {
    return null;
  }
  return new Promise((resolve) => {
    const transaction = database.transaction(DB_STORE_NAME, "readonly");
    const request = transaction.objectStore(DB_STORE_NAME).get(key);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result?.value ?? null);
  }).finally(() => {
    database.close();
  });
}

async function writeIndexedValue(key, value) {
  const database = await openMessagingDatabase();
  if (!database) {
    return false;
  }
  return new Promise((resolve) => {
    const transaction = database.transaction(DB_STORE_NAME, "readwrite");
    const request = transaction.objectStore(DB_STORE_NAME).put({ key, value });
    request.onerror = () => resolve(false);
    request.onsuccess = () => resolve(true);
  }).finally(() => {
    database.close();
  });
}

async function removeIndexedValue(key) {
  const database = await openMessagingDatabase();
  if (!database) {
    return false;
  }
  return new Promise((resolve) => {
    const transaction = database.transaction(DB_STORE_NAME, "readwrite");
    const request = transaction.objectStore(DB_STORE_NAME).delete(key);
    request.onerror = () => resolve(false);
    request.onsuccess = () => resolve(true);
  }).finally(() => {
    database.close();
  });
}

function readLocalValue(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalValue(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeLocalValue(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

async function readPersistentValue(key) {
  const indexed = await readIndexedValue(key);
  if (indexed !== null && indexed !== undefined) {
    return indexed;
  }
  return readLocalValue(key);
}

async function writePersistentValue(key, value) {
  const indexed = await writeIndexedValue(key, value);
  if (!indexed) {
    writeLocalValue(key, value);
  }
}

async function removePersistentValue(key) {
  await removeIndexedValue(key);
  removeLocalValue(key);
}

function buildOneTimePreKeys(count = 24) {
  return Array.from({ length: count }, (_, index) => ({
    prekeyId: `otk_${index + 1}_${randomBase64Url(6)}`,
    publicKey: randomBase64Url(32),
  }));
}

function createDeviceMaterial() {
  const deviceId =
    typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `web-${randomBase64Url(12)}`;
  return {
    deviceId,
    platform: "web",
    deviceLabel:
      normalizeString(window.navigator?.platform) || "Browser device",
    identityKey: randomBase64Url(32),
    signingKey: randomBase64Url(32),
    signedPreKey: {
      prekeyId: `spk_${randomBase64Url(6)}`,
      publicKey: randomBase64Url(32),
      signature: randomBase64Url(64),
    },
    oneTimePreKeys: buildOneTimePreKeys(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Lightweight browser-side messaging device and recovery store. The browser
 * persists state in IndexedDB when available, with localStorage as a fallback.
 */
export function createMessagingBrowserDevice() {
  let deviceStatePromise = null;

  async function loadState() {
    if (deviceStatePromise) {
      return deviceStatePromise;
    }
    deviceStatePromise = Promise.all([
      readPersistentValue(DEVICE_STATE_KEY),
      readPersistentValue(RECOVERY_STATE_KEY),
      readPersistentValue(CACHE_STATE_KEY),
    ]).then(([device, recovery, cache]) => ({
      device:
        device && typeof device === "object" ? device : createDeviceMaterial(),
      recovery: recovery && typeof recovery === "object" ? recovery : null,
      cache: cache && typeof cache === "object" ? cache : {},
    }));
    return deviceStatePromise;
  }

  async function saveDevice(device) {
    const current = await loadState();
    current.device = device;
    await writePersistentValue(DEVICE_STATE_KEY, device);
    return current.device;
  }

  async function saveRecovery(recovery) {
    const current = await loadState();
    current.recovery = recovery;
    if (recovery) {
      await writePersistentValue(RECOVERY_STATE_KEY, recovery);
    } else {
      await removePersistentValue(RECOVERY_STATE_KEY);
    }
    return current.recovery;
  }

  async function currentDevice() {
    const current = await loadState();
    if (!normalizeString(current.device?.deviceId)) {
      current.device = createDeviceMaterial();
      await saveDevice(current.device);
    }
    return current.device;
  }

  async function currentDeviceId() {
    return normalizeString((await currentDevice()).deviceId) || null;
  }

  async function buildDeviceHeaders() {
    const deviceId = await currentDeviceId();
    return deviceId ? { "X-Messaging-Device-Id": deviceId } : {};
  }

  async function buildRegistrationPayload() {
    const device = await currentDevice();
    return {
      deviceId: device.deviceId,
      platform: device.platform,
      deviceLabel: device.deviceLabel,
      identityKey: device.identityKey,
      signingKey: device.signingKey,
      signedPreKey: device.signedPreKey,
      oneTimePreKeys: Array.isArray(device.oneTimePreKeys)
        ? device.oneTimePreKeys
        : [],
    };
  }

  async function buildTrustedDeviceTransferPayload(targetDevice = {}) {
    const device = await currentDevice();
    return {
      envelope: {
        version: "web-v1",
        issuedAt: Date.now(),
        sourceDeviceId: device.deviceId,
        targetDeviceId: normalizeString(targetDevice.deviceId) || null,
        deviceMaterial: {
          identityKey: device.identityKey,
          signingKey: device.signingKey,
          signedPreKey: device.signedPreKey,
        },
      },
      conversationKeyCount: 0,
    };
  }

  async function importTrustedDeviceTransferPayload(envelope = {}) {
    const normalizedEnvelope =
      envelope && typeof envelope === "object" ? envelope : {};
    if (!normalizedEnvelope.deviceMaterial) {
      return false;
    }
    const device = await currentDevice();
    const nextDevice = {
      ...device,
      importedTransferAt: Date.now(),
      importedTransferFrom:
        normalizeString(normalizedEnvelope.sourceDeviceId) || null,
      importedDeviceMaterial:
        normalizedEnvelope.deviceMaterial &&
        typeof normalizedEnvelope.deviceMaterial === "object"
          ? normalizedEnvelope.deviceMaterial
          : null,
    };
    await saveDevice(nextDevice);
    return true;
  }

  async function createRecoveryEnrollment({
    backupVersion = 1,
    deviceVersion = null,
    trustVersion = null,
    rotate = false,
  } = {}) {
    const device = await currentDevice();
    const recoveryCode = buildRecoveryCode();
    const recoveryRoot = randomBase64Url(32);
    const salt = bytesToBase64Url(randomBytes(16));
    const key = await deriveRecoveryKey(recoveryCode, salt);
    const now = Date.now();
    const keyringSnapshot = {
      version: "web-v1",
      deviceId: device.deviceId,
      deviceMaterial: {
        identityKey: device.identityKey,
        signingKey: device.signingKey,
        signedPreKey: device.signedPreKey,
      },
      exportedAt: now,
    };
    const wrappedRecoveryRoot = await encryptJsonWithRecoveryKey(
      { recoveryRoot },
      key,
    );
    const wrappedKeyring = await encryptJsonWithRecoveryKey(
      keyringSnapshot,
      key,
    );
    const restoreProof = await sha256Base64Url(
      `${recoveryRoot}:${device.deviceId}:${backupVersion}`,
    );
    const recoveryState = {
      recoveryCode,
      recoveryRoot,
      restoreProof,
      backupVersion,
      keyringVersion: 1,
      createdAt: now,
      updatedAt: now,
      deviceVersion,
      trustVersion,
      rotate,
      recoveryKit: {
        version: "web-v1",
        wrappedRecoveryRoot,
        wrappedKeyring,
        kdf: {
          algorithm: "PBKDF2-SHA-256",
          iterations: RECOVERY_KEY_ITERATIONS,
          salt,
        },
        backupVersion,
        backupUpdatedAt: now,
        keyringVersion: 1,
        conversationKeyCount: 0,
        deviceVersion,
        trustVersion,
      },
    };
    await saveRecovery(recoveryState);
    return {
      recoveryCode,
      recoveryKit: recoveryState.recoveryKit,
      uploadPayload: {
        wrappedRecoveryRoot,
        wrappedKeyring,
        restoreProof,
        kdf: recoveryState.recoveryKit.kdf,
        backupVersion,
        backupUpdatedAt: now,
        keyringVersion: 1,
        conversationKeyCount: 0,
        deviceVersion,
        trustVersion,
      },
    };
  }

  async function currentRecoveryRestoreProof() {
    const current = await loadState();
    return normalizeString(current.recovery?.restoreProof) || null;
  }

  async function markRecoveryVerified({ verifiedAt = Date.now() } = {}) {
    const current = await loadState();
    if (!current.recovery) {
      return null;
    }
    current.recovery = {
      ...current.recovery,
      verifiedAt,
      updatedAt: Date.now(),
    };
    await saveRecovery(current.recovery);
    return current.recovery;
  }

  async function buildRecoveryKit(recoveryBundle = null) {
    if (recoveryBundle && typeof recoveryBundle === "object") {
      return recoveryBundle;
    }
    const current = await loadState();
    return current.recovery?.recoveryKit || null;
  }

  async function revealRecoveryCode() {
    const current = await loadState();
    return normalizeString(current.recovery?.recoveryCode) || null;
  }

  async function restoreFromRecoveryBundle({
    recoveryCode,
    recoveryBundle,
  } = {}) {
    const bundle =
      recoveryBundle && typeof recoveryBundle === "object"
        ? recoveryBundle
        : {};
    const kdf = bundle.kdf && typeof bundle.kdf === "object" ? bundle.kdf : {};
    const salt = normalizeString(kdf.salt);
    if (!salt) {
      throw new Error("recovery_bundle_missing_salt");
    }
    const key = await deriveRecoveryKey(recoveryCode, salt);
    const wrappedRecoveryRoot = await decryptJsonWithRecoveryKey(
      bundle.wrappedRecoveryRoot || {},
      key,
    );
    const wrappedKeyring = await decryptJsonWithRecoveryKey(
      bundle.wrappedKeyring || {},
      key,
    );
    const device = await currentDevice();
    const recoveryRoot = normalizeString(wrappedRecoveryRoot?.recoveryRoot);
    const backupVersion = Number(bundle.backupVersion) || 1;
    const restoreProof = await sha256Base64Url(
      `${recoveryRoot}:${device.deviceId}:${backupVersion}`,
    );
    const recoveryState = {
      recoveryCode,
      recoveryRoot,
      restoreProof,
      backupVersion,
      keyringVersion: Number(bundle.keyringVersion) || 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      recoveredAt: Date.now(),
      recoveryKit: bundle,
      importedKeyring:
        wrappedKeyring && typeof wrappedKeyring === "object"
          ? wrappedKeyring
          : {},
    };
    await saveRecovery(recoveryState);
    return restoreProof;
  }

  async function clearCache() {
    const current = await loadState();
    current.cache = {};
    await writePersistentValue(CACHE_STATE_KEY, current.cache);
  }

  return {
    buildDeviceHeaders,
    buildRegistrationPayload,
    buildRecoveryKit,
    buildTrustedDeviceTransferPayload,
    clearCache,
    createRecoveryEnrollment,
    currentDevice,
    currentDeviceId,
    currentRecoveryRestoreProof,
    importTrustedDeviceTransferPayload,
    markRecoveryVerified,
    restoreFromRecoveryBundle,
    revealRecoveryCode,
  };
}

/**
 * Browser messaging websocket client mirroring the mobile contract: AUTH,
 * inbox/conversation subscriptions, typing events, heartbeat, and reconnects.
 */
export function createMessagingSocketClient({
  getAuthToken,
  getDeviceId,
  onEvent,
  onStateChange,
} = {}) {
  let channel = null;
  let connectionState = "disconnected";
  let wsUrl = "";
  let disposed = false;
  let inboxSubscriptionCount = 0;
  let activeSessionCount = 0;
  let reconnectAttemptCount = 0;
  let disconnectedAt = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let disconnectTimer = null;
  const conversationSubscriptions = new Set();

  function emitState() {
    if (typeof onStateChange === "function") {
      onStateChange({
        connectionState,
        wsUrl,
        disconnectedAt,
        reconnectAttemptCount,
        hasInboxSubscription: inboxSubscriptionCount > 0,
        conversationSubscriptions: Array.from(conversationSubscriptions),
      });
    }
  }

  function setConnectionState(next) {
    if (connectionState === next) {
      return;
    }
    connectionState = next;
    emitState();
  }

  function clearReconnectMetadata() {
    disconnectedAt = null;
    reconnectAttemptCount = 0;
    emitState();
  }

  function send(payload) {
    if (connectionState !== "connected" || !channel) {
      return;
    }
    try {
      channel.send(JSON.stringify(payload));
    } catch {
      // Ignore websocket send failures and let reconnect logic recover.
    }
  }

  function scheduleReconnect() {
    if (disposed || activeSessionCount <= 0 || !wsUrl) {
      return;
    }
    if (channel) {
      channel.close();
      channel = null;
    }
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    disconnectedAt = disconnectedAt || new Date().toISOString();
    reconnectAttemptCount += 1;
    setConnectionState("disconnected");
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      if (disposed) {
        return;
      }
      setConnectionState("connecting");
      open().catch(() => {});
    }, 2000);
  }

  async function open() {
    if (disposed || !wsUrl) {
      setConnectionState("disconnected");
      return;
    }
    try {
      const token =
        typeof getAuthToken === "function" ? await getAuthToken() : "";
      if (!normalizeString(token)) {
        setConnectionState("disconnected");
        return;
      }
      channel = new window.WebSocket(wsUrl);
      channel.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data || "{}"));
          const type = normalizeString(payload?.type);
          if (!type) {
            return;
          }
          if (typeof onEvent === "function") {
            onEvent({ type, payload });
          }
        } catch {
          // Ignore malformed socket payloads.
        }
      });
      channel.addEventListener("close", () => scheduleReconnect());
      channel.addEventListener("error", () => scheduleReconnect());
      channel.addEventListener(
        "open",
        async () => {
          setConnectionState("connected");
          clearReconnectMetadata();
          const deviceId =
            typeof getDeviceId === "function" ? await getDeviceId() : "";
          send({
            type: "AUTH",
            token,
            ...(normalizeString(deviceId) ? { deviceId } : {}),
          });
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = window.setInterval(() => {
            send({ type: "HEARTBEAT" });
          }, 20000);
          if (inboxSubscriptionCount > 0) {
            send({ type: "SUBSCRIBE_INBOX" });
          }
          conversationSubscriptions.forEach((conversationId) => {
            send({
              type: "SUBSCRIBE_CONVERSATION",
              conversationId,
            });
          });
        },
        { once: true },
      );
    } catch {
      scheduleReconnect();
    }
  }

  async function ensureConnected(nextUrl) {
    const normalized = normalizeString(nextUrl || wsUrl);
    if (normalized) {
      wsUrl = normalized;
    }
    if (
      !wsUrl ||
      connectionState === "connected" ||
      connectionState === "connecting"
    ) {
      return;
    }
    window.clearTimeout(disconnectTimer);
    disconnectTimer = null;
    setConnectionState("connecting");
    await open();
  }

  async function disconnect() {
    window.clearTimeout(disconnectTimer);
    window.clearTimeout(reconnectTimer);
    window.clearInterval(heartbeatTimer);
    disconnectTimer = null;
    reconnectTimer = null;
    heartbeatTimer = null;
    clearReconnectMetadata();
    setConnectionState("disconnected");
    if (channel) {
      try {
        channel.close();
      } catch {
        // ignore close failures
      }
      channel = null;
    }
  }

  async function retainSession(nextUrl) {
    const normalized = normalizeString(nextUrl);
    window.clearTimeout(disconnectTimer);
    disconnectTimer = null;
    activeSessionCount += 1;
    if (!normalized) {
      await disconnect();
      return;
    }
    const needsReconnect =
      normalizeString(wsUrl) &&
      normalizeString(wsUrl) !== normalized &&
      connectionState === "connected";
    wsUrl = normalized;
    if (needsReconnect) {
      await disconnect();
    }
    await ensureConnected(normalized);
  }

  function releaseSession() {
    if (activeSessionCount > 0) {
      activeSessionCount -= 1;
    }
    if (activeSessionCount > 0 || disposed) {
      return;
    }
    window.clearTimeout(disconnectTimer);
    disconnectTimer = window.setTimeout(() => {
      if (!disposed && activeSessionCount <= 0) {
        disconnect().catch(() => {});
      }
    }, DISCONNECT_GRACE_MS);
  }

  function subscribeInbox() {
    inboxSubscriptionCount += 1;
    if (inboxSubscriptionCount === 1) {
      send({ type: "SUBSCRIBE_INBOX" });
    }
    emitState();
  }

  function unsubscribeInbox() {
    if (inboxSubscriptionCount <= 0) {
      inboxSubscriptionCount = 0;
      return;
    }
    inboxSubscriptionCount -= 1;
    if (inboxSubscriptionCount === 0) {
      send({ type: "UNSUBSCRIBE_INBOX" });
    }
    emitState();
  }

  function subscribeConversation(conversationId) {
    const normalized = normalizeString(conversationId);
    if (!normalized) {
      return;
    }
    conversationSubscriptions.add(normalized);
    send({ type: "SUBSCRIBE_CONVERSATION", conversationId: normalized });
    emitState();
  }

  function unsubscribeConversation(conversationId) {
    const normalized = normalizeString(conversationId);
    if (!normalized) {
      return;
    }
    conversationSubscriptions.delete(normalized);
    send({ type: "UNSUBSCRIBE_CONVERSATION", conversationId: normalized });
    emitState();
  }

  function typingStart(conversationId) {
    const normalized = normalizeString(conversationId);
    if (!normalized) {
      return;
    }
    send({ type: "TYPING_START", conversationId: normalized });
  }

  function typingStop(conversationId) {
    const normalized = normalizeString(conversationId);
    if (!normalized) {
      return;
    }
    send({ type: "TYPING_STOP", conversationId: normalized });
  }

  function dispose() {
    disposed = true;
    disconnect().catch(() => {});
  }

  return {
    connect: ensureConnected,
    disconnect,
    dispose,
    ensureConnected,
    getStateSnapshot() {
      return {
        connectionState,
        wsUrl,
        disconnectedAt,
        reconnectAttemptCount,
        hasInboxSubscription: inboxSubscriptionCount > 0,
        conversationSubscriptions: Array.from(conversationSubscriptions),
      };
    },
    releaseSession,
    retainSession,
    subscribeConversation,
    subscribeInbox,
    typingStart,
    typingStop,
    unsubscribeConversation,
    unsubscribeInbox,
  };
}
