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

## Checks

```powershell
node --test tests/files/organization-contacts.spec.mjs tests/files/organization-contacts-performance.spec.mjs tests/files/contact-book-presentation.spec.mjs tests/texting/*.test.mjs
npx playwright test --config=tests/contact-book.playwright.config.cjs tests/files/contact-book.pw.spec.cjs tests/files/contact-book-redesign.pw.spec.cjs --workers=1 --reporter=line
npm run lint
npm run build:frontend
```

Format only the changed files with Prettier to avoid rewriting unrelated source. Browser fixtures block external requests and use fictional contacts. They cover imports, retained values, resumed uploads, saved views, nested filters, page-size/cursor handling, full tag disclosure, campaign review, source and geography operations, and recovery.

Local verification evidence and fictional desktop/mobile screenshots are kept outside the repository at `D:/CodexHome/artifacts/polis-contact-book-ui-20260930/website`. The full backend startup check was attempted with isolated in-memory SQLite and no production configuration; the reused dependency installation lacks the native `sqlite3` binding for Node 24. Frontend validation does not imply that local backend startup passed. This release changes backend source only to advance the shared CSS/JavaScript asset version.
