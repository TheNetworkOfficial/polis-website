# Isolated campaign setup

The hidden organization route `/organizations/:organizationId/texting/setup`
uses the separately deployed setup API. Existing campaign, queue, recipient
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

The client retains only an opaque actor/organization-scoped creation request ID
in tab storage, with an opaque URL fallback. After response loss or reload it
uses authenticated `GET /requests/:requestId` to recover the same saved setup.
An unresolved request blocks another creation. Even after a missing lookup, an
explicit Save retains the same request ID so a slow previous request cannot
produce a second operation. No draft body, contact, amount, approval or token is
stored in this recovery record.

An explicit Open action publishes the reviewed graph, requests a fresh handoff,
then uses the manager's current session at the existing activation endpoint.
The client accepts only the exact organization/campaign path, original revision
and `activate` body. Readback never substitutes a newer revision. Lost responses,
edits and unknown outcomes require saved-status checks; no automatic activation
or upload retry occurs. An accepted activation shows progress; Start texting is
shown only after completion.

The existing team page now keeps confirmation and Continue to campaign review
beside Save team. An unchanged team reports that it is already saved. Saving
assignments does not prepare, open or send. Purchase processing remains separate
from reserved message charges: status checks retain the same purchase and never
credit funds from a return URL. Finite rate deadlines remain visible; null or
invalid expiries are not rendered as tax-renewal dates.

For initial rollout, keep new admissions disabled. After any operation is
accepted, rollback means pausing *new admissions* while retaining the setup API,
runtime, configuration and versioned client for existing operations. Disabling
the entire client configuration or reverting all HTML to an older client is
only a pre-admission rollback. Existing send/reply sessions require no update.

Focused coverage is in `tests/texting/setup-prevention.test.mjs`,
`tests/files/texting-prevention.pw.spec.cjs`, and the existing billing, assignment,
candidate, ballot autosave and queue/session suites.
