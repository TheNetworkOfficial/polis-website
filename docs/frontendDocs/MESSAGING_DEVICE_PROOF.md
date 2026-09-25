# Browser messaging device proof

Authenticated `/api/messaging/` requests pass through one proof transport before
the shared JSON fetch function. Bootstrap is authenticated without a device
proof. Every other request carries an Ed25519 signature over the account,
device, server trust context, logical method/path, canonical JSON body/query,
timestamp, and a fresh nonce. WebSocket AUTH uses a separate signed proof for
`POST /api/messaging/realtime/auth` and waits for READY before subscriptions.

The browser uses native WebCrypto Ed25519 and X25519. Non-extractable private
CryptoKeys are persisted in IndexedDB under the signed-in account. A browser
without those algorithms or working IndexedDB receives a setup error; keys do
not fall back to localStorage. Concurrent tabs create one stored identity.

Old browser records contained random public-key strings without corresponding
private keys. They remain untouched. The user explicitly selects **Set up this
browser**, which creates a new device ID and real keys. Registration does not
inherit the old record's trust. Existing accounts follow the server's normal
pending-device approval requirements. This migration does not recover old
encrypted message history.

The previous web-v1 recovery/transfer format did not contain the private or
conversation keys needed to restore encrypted history. Those operations now
explain that recovery and transferring encrypted keys require the updated Polis
app, before submitting a recovery/approval mutation. Existing local records and
server recovery data are preserved.

Only a successful legacy bootstrap permits the legacy signing context
`rootPresent=false`, epoch 1, trust-set version 1. That context is not treated
as a trust decision. Observing a modern capability or server context disables
legacy fallback for the account session. Context updates cannot regress.
Only a 403 `invalid_device_proof` or `device_proof_stale` response receives one
bootstrap refresh and a newly signed retry. Requests never retry unsigned.
Account changes fence in-flight HTTP/bootstrap/key/socket work.

## Validation

Run `node --test tests/messaging/device-proof.spec.mjs`, `npm run lint`, and
`npm run build:frontend`. Format only the touched files with Prettier to avoid
changing unrelated source. Tests include an independently generated signature
vector, real key/prekey verification, stale-proof handling, account isolation,
legacy preservation, and WebSocket trust rejection.

Local Chromium checks also verify actual IndexedDB CryptoKey persistence,
concurrent tabs, and switching accounts during key generation. These checks
do not establish Safari/Firefox or production-device acceptance.

## Release prerequisites

This source/build is not a website deployment. Release the reviewed backend
compatibility runtime and ensure the **actual API Gateway preflight** allows
all `X-Messaging-Device-*` proof headers before deploying this browser bundle.
A Lambda CORS header list alone is insufficient if API Gateway answers OPTIONS.
Verify the served bundle and signed HTTP/WebSocket flows using approved test
identities before enforcing proof for all clients. Keep recovery activation
separate from compatibility, and do not reset any real account automatically.
