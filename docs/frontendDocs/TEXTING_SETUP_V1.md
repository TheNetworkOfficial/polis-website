# Isolated campaign setup

The Campaigns page connects **New campaign** to the organization route
`/organizations/:organizationId/texting/setup/new` when fresh discovery explicitly
advertises enabled `contact_book_single` creation and current billing access.
**Saved setups** remains visible to campaign managers while admissions are paused.
Unsupported organizations have an explicit **Other campaign types** choice;
unavailable or unknown setup status never silently creates through the old API.
The guided route uses the separately deployed setup API. Existing campaign, queue, recipient
confirmation, reply and payment routes retain their current owners. Opening a
setup page never allocates recipients or sends messages.

The public `/texting-setup-config.json` must have schema
`POLIS_TEXTING_SETUP_CONFIG_V1`, `enabled: true`, and the exact dedicated
`https://<api-id>.execute-api.us-west-2.amazonaws.com/prod` origin. The client
rejects other origins and redirects. Missing or disabled configuration leaves
existing campaigns available. Tokens are sent only after normal session and
actor/route checks, and are never saved in setup records.

Only advertised setup actions appear. Creation requires billing access and at
least one currently eligible volunteer selected by name. Saving freezes the
message, reviewed recipient selection, team, window and limit. Prepare, manager
takeover, provider reconciliation, publication and opening are separate actions.
Each individual text still requires the existing person's exact confirmation.

Before a creation POST, the client saves and reads back the exact original draft
and its SHA-256 fingerprint in actor/organization-scoped tab storage. This record
contains the reviewed message, selection identity, assigned volunteer identities,
window and spending limit; it contains no raw contact rows or authentication tokens.
Only the opaque request ID appears in the URL fallback. After response loss or reload it
uses authenticated `GET /requests/:requestId` to recover the same saved setup.
An unresolved request blocks another creation. After an authoritative missing lookup,
the original draft is restored for an explicit retry with the same ID and exact body.
Edits are rejected and the original values restored. A missing, corrupt or unavailable
tab record cannot dispatch a replacement body. Failed persistence stops before POST;
only confirmed server readback or creation clears this recovery record. Reads never
retry automatically. Closing the tab removes its local draft; saved server operations
remain available through Saved setups.

An explicit Open action publishes the reviewed graph, requests a fresh handoff,
then uses the manager's current session at the existing activation endpoint.
The client accepts only the exact organization/campaign path, original revision
and `activate` body. Readback never substitutes a newer revision. Lost responses,
edits and unknown outcomes require saved-status checks; no automatic activation
or upload retry occurs. An accepted activation shows progress; Start texting is
shown only after completion.

The existing team page now reconstructs its saved team and Continue to campaign review
beside Save team after a reload or a confirmed response-loss recovery. An unchanged team reports that it is already saved. Saving
assignments does not prepare, open or send. Purchase processing remains separate
from reserved message charges: status checks retain the same purchase and never
credit funds from a return URL. Finite rate deadlines remain visible; null or
invalid expiries are not rendered as tax-renewal dates.

For initial rollout, keep new admissions disabled. After any operation is
accepted, rollback means pausing _new admissions_ while retaining the setup API,
runtime, configuration and versioned client for existing operations. Disabling
the entire client configuration or reverting all HTML to an older client is
only a pre-admission rollback. Existing send/reply sessions require no update.

Focused coverage is in `tests/texting/setup-prevention.test.mjs`,
`tests/files/texting-prevention.pw.spec.cjs`, and the existing billing, assignment,
candidate, ballot autosave and queue/session suites.

Before a website release, capture the currently served frontend source/build-input
manifest, then pin an independently reviewed manifest of changed/new source hashes.
Run `node scripts/verify-frontend-preservation.mjs <release-root> <baseline.json>
<reviewed.json>` before building the combined release. It rejects missing live
overlay files, unreviewed changes and unreviewed additions. A clean-main build is
not a replacement for this proof while older production overlays remain separate.
Keep the source manifest, reviewed delta, public build configuration and old/new
asset hashes with the release. Do not bulk-merge unrelated preserved work to make
the hashes appear clean.
