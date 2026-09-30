# Shared contact book: website implementation and local evidence

September 30, 2026. Local source, fictional fixtures, and mock verification only; no deployment, real-contact transfer, or provider requests.

## Implemented

The Contacts route reads the organization contact-book API before loading a texting provider workspace. The schema controls every available standard/custom field and permission. The default table remains compact; additional fields, filters, source records, and advanced controls are expandable.

| Surface                 | Behavior                                                                                                                                                                                                                                                                                                     | Implementation                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Contact details         | Typed primitive and complete structured JSON editing; invalid imported values remain untouched until explicitly corrected; expected revisions protect concurrent edits; archive/restore; per-contact Saved/Updating related views status.                                                                    | `frontend/src/pages/shared-feed/scripts/organizationContactBook.js`, `organizationContactsModel.js` |
| Fields and tags         | Create/rename/archive fields and tags; reviewed type conversion; tag group create/select/clear; editable individual tag columns and readable group columns. Group filters become existing tag predicates.                                                                                                    | `frontend/src/pages/shared-feed/scripts/organizationContactBook.js`                                 |
| Views and audiences     | Column visibility, ordering and desktop pinning; nested AND/OR/NOT filters; paginated saved-view/audience loading; search/filter/sort persistence; private or organization visibility; layout editing/archiving; manager-published organization defaults.                                                    | `frontend/src/pages/shared-feed/scripts/organizationContactBook.js`                                 |
| Import retention        | Streaming CSV/TSV/pipe-separated files with encoding selection; all accepted columns retained; custom-field mapping; explicit sample-only match/conflict review; exact-header and receipt-protected reload/reselect-file resume; outcomes and original/current source comparison.                            | `frontend/src/pages/shared-feed/scripts/organizationContactImport.js`, `organizationContactBook.js` |
| Identity and evidence   | Search and review possible duplicates; explicit per-field current/source choices; guarded merge undo; complete structured source/history records; reviewed editable source-value correction; live authorized visits/requests/notes/campaign/property activity with pagination.                               | `frontend/src/pages/shared-feed/scripts/organizationContactBook.js`                                 |
| Bulk actions            | Frozen full-result or explicit selections; tag add/remove with outcomes and guarded undo; source-membership removal; a two-step source replacement guide preserves other memberships and history.                                                                                                            | `frontend/src/pages/shared-feed/scripts/organizationContactBook.js`                                 |
| District updates        | Individual local enrichment; manager-reviewed frozen-selection refresh preview, before/after results, potentially affected saved views/audiences, explicit apply, bounded continuation, and truthful coverage gaps.                                                                                          | `frontend/src/pages/shared-feed/scripts/organizationContactBook.js`                                 |
| Campaigns               | Full-result selection across uploads; manual include/exclude and phone choices; duplicate-endpoint blocking; reviewed local campaign binding; separate explicit provider preparation. A zero provisional eligible count does not bypass the authoritative sender-consent check or incorrectly block binding. | `frontend/src/pages/shared-feed/scripts/textingCampaigns.js`, `organizationContactBook.js`          |
| Shared-tool integration | Voter registry retains spatial/permission routes and links shared records by contactId. Admin sync status shows pending contact/restriction updates and runs both repair phases with failed-cursor retention; managers can take over interrupted field/district updates and finish their guarded jobs.       | `frontend/src/pages/shared-feed/shared-feed.js`, `organizationContactBook.js`                       |

`textingShell.js` restores focus within the original form, including repeated field names; campaign draft edits update only the changed control. A browser assertion forces a redraw before checking that the campaign name and focus survive.

`organizationContactsApi.js` checks route ownership before and after asynchronous requests. Browsing, imports, saved audiences, selection, and local binding do not call a provider. Existing selected-recipient preparation handles its asynchronous 409 response with status/retry; there is no list-sync fallback. Addresses are never submitted to an external geocoder.

## Local validation

- Ten helper tests pass: retained false/zero/unknown values; CSV parsing; bounded chunks and retry receipts; scoped API guards; formula-safe downloads; exact resume headers and shorter-file rejection; adaptive UTF-8 limits; full structured JSON validation; bounded preview samples; tag-group summaries.
- Fifteen contact-book mock browser scenarios cover contact/custom/tag edits, the three-source MT House 22 campaign selection, import retention/sample review/source correction, nested filters, reviewed conversions, reload resume, duplicate phones, invalid raw values, bulk undo/source retraction, two-phase repair, structured edit/merge choices, private/reordered layouts, pinned organization defaults, reviewed district refresh/current activity, tag groups, and manager takeover of interrupted schema work. The separate existing texting send/reply/opt-out regression is included.
- ESLint and the production frontend build pass; the build reports its existing bundle-size warnings.
- Desktop and 390px mobile contact views are visually checked. Browser screenshots and results are local ignored artifacts under `output/playwright/contact-book-results`.
- Website backend startup with a disposable SQLite database, isolated port and no Redis is blocked by the existing linked dependency installation lacking the native `node_sqlite3.node` binding for Node 24. No website backend code or shared dependency installation was changed.

Commands:

```powershell
node --test tests/files/organization-contacts.spec.mjs
node tests/files/contact-import-capacity.mjs
npm run lint
npm run build:frontend
npx --no-install playwright test tests/files/contact-book.pw.spec.cjs tests/files/texting-workspace.pw.spec.cjs --config tests/contact-book.playwright.config.cjs --workers=1
```

## Evidence boundaries

Browser results use mocked APIs and fictional records. They do not establish production ingestion throughput, migration completeness, deployed permissions, native-device behavior, live provider readiness, or cross-tool propagation against deployed services. Boundary package installation remains an explicitly controlled backend operation; the Montana package is prepared locally and honestly marked `needs_review` until effective-date evidence is supplied. Local public polygon downloads contain no contact data.

Import matching before submission is a bounded sample, prominently labeled as such. Full ingestion outcomes are reviewed afterward. Source replacement is an explicit add/update upload followed by frozen-selection removal of the old source memberships. It is not whole-book deletion. Automatic duplicate ranking remains conservative: users search, inspect both records, and choose their field values. Structured values use validated JSON editors so every nested property remains available; dedicated address/phone form widgets can be added without changing retention.

## Parser capacity evidence

Supported per-file ceiling is 1,000,000 nonblank data records. The generated fictional-stream check completed that count in 1.248 seconds with 10,000 stub requests, at most 100 records per request, and observed peak heap 48.9 MB / RSS 136.2 MB. The 1,000,001-record case rejected the extra record before transmitting it and did not complete the import. Both runs used a local stub and no backend/network/storage. These figures measure parser capacity only, not deployed ingestion throughput. Separate long-Unicode-value tests verify the 900 KB request bound, including sample preview payloads. Metrics: `D:/CodexHome/artifacts/polis-contact-book-montana-boundaries-20260930-v3/website-parser-capacity.json`.
