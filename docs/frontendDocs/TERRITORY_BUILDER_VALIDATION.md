# Territory builder website validation

Validated locally on 2026-10-13 for the coordinated backend, app, and website
redesign. These results cover local behavior, not deployed organization data.
Source integration does not authorize deployment or store distribution.

## Behavior and integration

The existing coalition and candidate territory-admin routes now open the
Area → Cut → Assign builder. Existing territory editing, assignments, and
schedules remain available through **Existing territories**. Returning to the
builder preserves its local draft; leaving the route or changing the actor or
organization clears it. Existing navigation and legacy API routes remain intact.

The real MapLibre map renders authorized geometry and address coordinates from
the builder bootstrap. Auto, Guided, Split, coverage, and final review use server
geometry and counts. Manual drawing, vertex editing, whole-boundary movement,
trim masks, undo, draft saving, assignment, and optional start time send the
approved shared API contract. Detailed boundaries preserve their full geometry
while exposing at most 64 globally sampled editing handles.

Only `excludeDoNotKnock` and `excludeReportedDanger` are sent as contact
exclusions. Both default to false and can be independently deselected. The blank
dropdown is disabled, has one empty option, and has no behavior or payload field.
Assignees come from the authorized named roster. Review requires every territory
to have eligible staff; publication additionally requires positive server address
counts for every territory. Unassigned plans can still be saved as drafts.

Coalition API prefix:
`/api/coalitions/{coalitionId}/voter-map/territory-builder`.
Candidate API prefix:
`/api/candidate-dashboard/voter-map/territory-builder?candidateId={candidateId}`.
Actions are GET bootstrap, POST `/preview`, PUT `/draft`, and POST `/publish`
(candidate query follows the action suffix). Requests use the existing
authenticated request wrapper plus expected-actor fencing. Revisions prevent
stale writes; explicit publish retries retain one idempotency key. Edits clear
review state. Access revocation clears private data, and incomplete bootstrap
data blocks planning.

Deploy the matching shared backend before exposing this website change. The
website Express server serves the existing page routes; it does not implement
the territory-builder APIs. Production API availability has not been claimed.

## Checks and evidence

- `node --test tests/territory-builder-model.test.mjs tests/texting/person-selection-standard.test.mjs`:
  **20 passed**. Covers actor/scope changes, stale dispatch, incomplete data,
  reversible filters, restricted payloads, undo, draft revision conflicts,
  idempotent retry, revoked access, campaign-boundary validation, publish
  assignment/count gates, holes/islands, trim translation, and a 20,000-vertex
  multipolygon sampled to 64 valid handles without geometry loss.
- `node node_modules/@playwright/test/cli.js test --config playwright.territory.config.cjs`:
  **7 passed**. Covers coalition and candidate routes, both reversible exclusions,
  blank dropdown, named assignments, explicit review/publish, conflict recovery,
  real MapLibre drawing and pointer/keyboard corner edits, undo, trim, saved draft
  reload, desktop/phone layout, incomplete data, and legacy management entry/back.
- `npm run lint`: passed repository-wide.
- Scoped Prettier formatting and `git diff --check`: passed. Unrelated repository
  files were not reformatted.
- `npm run build:frontend`: passed with three webpack performance warnings for
  existing large shared-feed/files bundles and font assets.
- `npm run start:public --prefix backend`: passed. Built coalition and candidate
  territory-admin routes returned HTTP 200 with the shared-feed shell. This is
  the server target in `deploy/lightsail/polis-website.service`.
- Required full `npm run start:backend`: blocked by the existing local `sqlite3`
  native binding missing from the shared canonical dependencies under Node
  24.16.0. The same `require('sqlite3')` failure was reproduced in the unchanged
  canonical backend checkout. The attempted local startup used in-memory SQLite,
  disabled schema synchronization, and an isolated process environment; no
  production database was contacted. Shared dependencies were not rebuilt.

Browser API calls are intercepted with synthetic local fixtures. Screenshots
demonstrate actual website controls and the MapLibre renderer, not production
territories or residents. Backend correctness is validated separately in the
shared backend repository.

Set `TERRITORY_BUILDER_ARTIFACTS` to choose a browser evidence directory; the
portable default is `test-results/territory-builder`. This run used
`D:/CodexHome/artifacts/territory-builder-20261013/website`, containing
`browser-tests.txt`, `model-tests.txt`, `lint.txt`, `build.txt`,
`backend-start.txt`, `public-server.txt`, `desktop-cut.png`, and
`phone-assign.png`.
