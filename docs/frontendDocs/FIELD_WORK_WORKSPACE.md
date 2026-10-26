# Coalition Field Work

Field Work uses the approved People/Missions shell and its own persistent
`.polis-field-work` surface. The previous Voter Map dashboard, metric cards and
navigation grid are not rendered on Field Work routes.

Managers have Map, Territories and Assignments. Members have Map and My areas.
The server's current capabilities control actions; role labels do not grant
territory authoring. My areas comes from current assignment geometry, not the
map's default territory or an assumption that map access implies canvassing
access.

## Existing links and tool ownership

| Existing route                                     | Destination                                              |
| -------------------------------------------------- | -------------------------------------------------------- |
| `/coalitions/:id/voter-map` and `/map`             | New map and matching voter list                          |
| `/voter-map/connected`                             | New voter list                                           |
| `/voter-map/add`                                   | Contextual add-voter dialog                              |
| `/voter-map/notes?recordId=...`                    | Selected voter and notes drawer                          |
| `/voter-map/territories`                           | Territory cards                                          |
| `/voter-map/territories/admin`                     | Capability-gated territory planning                      |
| `/voter-map/members`                               | `/coalitions/:id/members/directory`                      |
| `/voter-map/cta`                                   | `/coalitions/:id/calendar/field-events`                  |
| `/voter-map/cta/transport`                         | Calendar field-event transportation; preserves `eventId` |
| `/voter-map/outreach-scripts` and template aliases | `/coalitions/:id/admin/edit/outreach`                    |

Directory contacts retain their original directory records. They are not
converted into Polis accounts, coalition memberships or shared voter/contact
records. People exposes the directory link separately from its membership tabs.
Calendar and Administration expose their corresponding moved tools. Existing
API paths and stores remain unchanged.

The shared Contacts destination is
`/workspace/coalition/:id/people/contacts`. Follow-ups and task review remain in
Missions. The Doorknocker action uses the registered native route
`/coalitions/:id/voter-map/door-knocker`; the app performs its own readiness and
boundary checks. Its router does not accept a voter/territory preselection, so
the website does not imply one was transferred.

## Data and safety contracts

- The map queries actual scoped voter points and clusters. Cluster selection
  zooms the map. A list record without a returned pin status is shown as unknown,
  not as completed outreach.
- Pin colors mean **Outreach remaining**, **Reserved**, and **No pending
  outreach**. They do not represent door-knocking outcomes. Partial map results
  and loading failures remain explicit.
- Notes use the selected record identity, `contactType`, body and tags. Draft
  text survives drawer closure and failed saves; it clears after a successful
  save. Native dialog state survives shared-shell renders.
- Assignment management uses current V2 assignment contracts and authorized
  people selected by name. Revoking an assignment does not remove membership.
- Add/import retain duplicate handling, CSV upload/preview, scoped validation,
  import creation and status polling. Signed file uploads do not send the Polis
  authorization header to storage.
- Territory planning reuses the revision-aware territory builder model,
  authenticated source, draft, preview and publish services. Publication requires
  the server's authoring capability and an eligible lead on every territory.
  New plans default to excluding do-not-knock and reported-danger addresses;
  saved policies remain visible and are preserved.
- Requests and queued mutations are fenced by actor, session, workspace and
  current request generation. A changed scope cannot receive a late result.
  Refreshing authentication invalidates the old surface and reloads current
  access. Repeated viewport events do not repeatedly fetch an unchanged map.
- Event loading follows the supported global events cursor and filters every
  page by coalition. The backend has no coalition CTA-list GET route. Repeated
  cursors or the explicit traversal limit produce an error instead of an
  apparently complete empty event list.
- Empty optional pickup coordinates are omitted. Supplied coordinates must be a
  complete, finite latitude/longitude pair within geographic bounds. A failed
  directory list is displayed as an error, independently of catalog success.

## Verification

Run from the repository on D: in the Windows workspace:

```powershell
node --test tests/fieldwork-model.test.mjs tests/fieldwork-legacy.test.mjs
node --test tests/territory-builder-model.test.mjs tests/territory-development-access.test.mjs tests/texting/person-selection-standard.test.mjs
node node_modules/@playwright/test/cli.js test --config tests/fieldwork.playwright.config.cjs
npm run lint
npm run build:frontend
```

The browser configuration supports `POLIS_TEST_BASE_URL`,
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `POLIS_FIELDWORK_OUTPUT_DIR`. Browser
fixtures use fictional records expressed through the actual API contracts.
They do not write production records. Build configuration must retain the
existing public authentication/map settings and populated Street View tiles
configuration; a successful source build alone does not authorize deployment
or enable a held production capability.
