# Contact Book interface

The shared Contact Book uses a compact contact table on desktop and contact cards on narrow screens. Its default columns are name/location, phone, texting status, and tags. View controls expose every authorized column, order, pinning, and density. Contact details retain the complete authorized field editor, source history, linked activity, geography review, and tag membership.

## Filters and selection

- Filters start with categories. Location puts state and districts first; city, address, and local districts expand below them. Choices come from the current authorized schema.
- Selected values within a choice field use any-match semantics; separate fields are combined with AND. Advanced rules preserve nested OR/NOT and repeated range constraints. Opening a category never changes a saved advanced rule.
- Sort and View are separate drawers. Saved views retain search, filter, sort, columns, pinning, sharing, and organization defaults. Saved audiences remain available in the same manager.
- Page sizes are 10, 25, 50, and 100, with 50 as the default. Changing size clears cursor history. An empty response with a continuation cursor says more contacts may match and keeps Next available. It never implies the search is complete or scans further automatically.
- Publication progress remains visible. Pending results are described as published matches, and cached pages preserve the existing authorization and publication version fences.
- Selection spans pages. Bulk tag actions, source removal, local geography refresh, exports, and other existing operations remain in contextual actions. All matching selections remain server evaluated.
- Create campaign carries a selection in memory within the same user and organization. The campaign screen rechecks permissions and rebuilds a local selection for explicit recipient review. Navigation alone does not create a campaign, bind its audience, or share contacts with a provider. User/organization changes, permission loss, or authentication rejection discard the handoff.

Filter checkboxes are square. The table shows a compact tag summary; its expansion opens contact details with every tag visible. Detail tag expansion also works independently of edit permission. No sample contacts are included in application source.

## October 1 refinements

- New filter, sort, and column choices omit country and map coordinates. Existing saved conditions, selected sorts, columns, and stored values remain intact. State-based city choices use the authenticated public Census catalog, cache only reference names for 24 hours, cancel obsolete loads, and retain saved cities absent from the catalog. Voter choices come from the authorized schema and preserve unfamiliar imported values.
- Texting and tag choices use two columns. Selection actions have a compact tag form, an authorized create-tag empty state, and actual usage-count ordering when counts are known. Unknown counts remain unknown. Congressional display uses state-prefixed codes without changing raw stored districts or precinct identifiers.
- New campaigns use two screens: select/review recipients, then write the message. Next appears above and below the recipient list. Returning to recipients retains the message and selection. The estimate uses the frozen eligible count and verified segment/MMS rate; provider preparation rechecks routing and consent before any sending.
- Whole-book navigation requires `readContactBook` or an authorized book schema. Organization and candidate role catalogs preserve `contact_book_view`, `contact_book_edit`, `contact_book_import`, `contact_book_tag`, and `contact_book_export`. Tag editing and campaign binding use their separate schema grants. The book remains available before texting-provider provisioning.
- Navigation remains client-side. First book entry reads the fresh schema and query; it loads only a configured default view before querying, and loads other saved views/audiences when their manager opens. Home, Campaigns, and Inbox retain fresh workspace authorization, then run independent billing and page reads together. Failures drain before private state is cleared. No authorization response is cached across navigation.
- A local ten-run controller fixture with 60 ms per asynchronous read measured book entry at about 187 ms before and 124 ms after (4 reads to 2). Home/Campaigns/Inbox each retain 3 reads; their fixture times decreased from about 186–187 ms to 124–125 ms. These measurements exclude HTTP, browser paint, and production backend latency and do not prove that all live navigation delay is resolved.
- Expired provider assignments hide Send/Skip and require provider review. Prompt owns assignment lifetime; its policy has no local lease duration or automatic return. Local opt-in expiry displays reclaim guidance only when the server confirms automatic reclaim. No UI claims that provider-held contacts automatically returned.

## Campaign preparation and navigation recovery

- The recipient review drawer includes **Continue to write message** after review. The existing top and bottom Next controls remain available, and returning to recipients preserves the selection. Continuing does not prepare or transfer contacts.
- Campaign preparation comes from the saved campaign DTO. Returning to an accepted preparation restores its status. The visible page polls for up to one hour or 180 reads, with intervals of 5, 15, then 30 seconds and up to three transient read retries. Hidden pages suspend polling. Route, account, organization, and permission changes stop the old controller.
- Only a server-authorized `ready_to_finalize` preparation may automatically call the revision-checked resume endpoint, at most once per preparation ID in the current controller. A lost resume response is reconciled through reads. Held or failed work requires explicit review/resume; opening a campaign never creates a provider approval or recipient transfer.
- **Image verified** describes attachment readiness only. While recipients are preparing, message readiness says that the message will be checked when recipient preparation finishes. Other blocked reasons remain visible.
- Texting navigation retains only two display permissions for the same signed-in actor and organization while fresh authorization loads. Fresh denials, logout, and identity changes clear them. These values never authorize requests or actions. Primary texting-link clicks use the existing client router; modified clicks keep browser link behavior.
- Volunteer search is debounced, cancelable, and limited to the authorized organization member endpoint. Selected people remain selected across searches. Existing assignments load through the campaign-scoped paginated team endpoint, fenced by campaign revision. Names, usernames, and available profile images replace user IDs; failed images show initials.

## Checks

```powershell
node --test tests/files/organization-contacts.spec.mjs tests/files/organization-contacts-performance.spec.mjs tests/files/contact-book-presentation.spec.mjs tests/files/contact-book-refinement.spec.mjs tests/texting/*.test.mjs
npx playwright test --config=tests/contact-book.playwright.config.cjs tests/files/contact-book.pw.spec.cjs tests/files/contact-book-redesign.pw.spec.cjs tests/files/contact-book-refinement.pw.spec.cjs --workers=1 --reporter=line
npm run lint
npm run build:frontend
```

Format only the changed files with Prettier to avoid rewriting unrelated source. Browser fixtures block external requests and use fictional contacts. They cover imports, retained values, resumed uploads, saved views, nested filters, page-size/cursor handling, full tag disclosure, campaign review, source and geography operations, and recovery.

Earlier redesign evidence and fictional desktop/mobile screenshots are kept outside the repository at `D:/CodexHome/artifacts/polis-contact-book-ui-20260930/website`. That release advanced the shared CSS/JavaScript asset version in backend source. Its backend startup check used isolated in-memory SQLite and no production configuration; the reused dependency installation lacks the native `sqlite3` binding for Node 24. Frontend validation does not imply that local backend startup passed.

Refinement evidence is kept at `D:/CodexHome/artifacts/polis-contact-book-refinement-20261001/website`; the navigation fixture includes source identity and explicit measurement limits. Local backend startup was rechecked with a synthetic session secret and in-memory database and has the same missing native SQLite binding. This refinement changes frontend assets only. No website deployment or provider actions are part of local validation.
