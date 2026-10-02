# Contact book numbered pagination

The contact book and campaign recipient picker show the same page controls above and below their contact rows: First, Previous, up to five nearby page numbers, Next, and Last. The current page uses `aria-current="page"`; each navigation region has a distinct accessible label. The controls wrap into two rows on narrow screens. Existing page sizes remain 10, 25, 50, and 100.

When the schema advertises both `queryCounts` and `numberedPages`, the client requests `POST /query-counts` with `{query, pages: true}`. It keeps reading the count job while its page directory builds, including when an exact total was already cached. A page jump reads `GET /query-counts/:countId/page?page=N&limit=SIZE`; it never walks every preceding cursor. Whole pages can open from a partial directory. The final short page waits for completion.

If a requested page is still being prepared, the current rows remain visible and the page opens automatically when ready. Last stays disabled until the exact total is known. A page target that turns out to exceed the final total is cleared. The current page button can cancel a waiting jump. Expired or unavailable page lists show a refresh instruction. Changed filters, sorting, page size, refreshes, and disposed views fence obsolete requests. Fresh read-access failures clear the displayed rows; stale publication results require a refresh.

Changing pages preserves selected contacts, exclusions, and the frozen all-matching query. Numbered browsing does not prepare or transfer campaign recipients. Existing recipient review and campaign preparation requirements remain in force. Older backends retain bounded sequential browsing rather than simulating distant jumps by scanning the book.

## Validation

- Ten focused pagination cases cover distant and short final pages, all page sizes, pending-page completion, final count boundaries, request cancellation, access denial, selected-contact retention, and bounded nearby page windows.
- 166 contact/texting regression tests and ESLint passed.
- Local browser fixtures verified a 100,003-contact book with 2,001 pages, one-request Last navigation, retained selection, and responsive controls at 390 pixels. No real contacts, provider requests, messages, or financial actions were used.
