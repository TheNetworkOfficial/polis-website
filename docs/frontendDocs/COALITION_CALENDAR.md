# Organization Calendar

The coalition Calendar follows the approved October 26 v3 review: a full-width month that fits the available viewport, with a 280px selected-day agenda at the right. The agenda scrolls independently. Mobile keeps the complete month and opens selected-day details in a drawer. The existing organization navigation and theme remain active.

`coalitionCalendar.js` owns a persistent, scoped workspace. `coalitionCalendarModel.js` normalizes API records, timezone conversion, all-day dates, permissions and creation bodies. `coalition-calendar.css` contains the approved presentation, scoped to the new Calendar host and route; it does not restyle other tabs. Candidate Calendar and the separate field-event/transport workflows retain their existing implementations.

## Behavior

- Month, week and agenda views share date navigation, Today, Refresh, text search, type and status filters. Agenda has editable From/Through bounds and Show whole month.
- The month handles four-, five- and six-week layouts. Visible event chips adapt to row height; the date and +count controls expose every item in the day agenda or mobile drawer.
- Event details include status, source, location, labels, shared display, and provider-write state. Requested/queued writes are not presented as delivered; partial failures remain visible.
- Active administrators and members with `calendar_manage` or `calendar_promotion_manage` can create items. `calendar_view` grants read access. Pending/inactive membership never grants either. Connected-calendar access is independently enforced by the API.
- Creation supports the current type/status enums, timed or all-day intervals, description, location, labels, privacy and fresh authorized calendar destinations. Busy only controls shared presentation; authorized organization Calendar viewers retain details.
- Timed values use the explicitly displayed organization or browser timezone. DST gaps and repeated-hour values are rejected with a useful error. All-day dates use canonical floating UTC day boundaries and an exclusive final midnight.
- Calendar destinations are reloaded before a write. A definite failed save preserves the draft. An uncertain transport/server result is fenced against automatic duplicate POSTs and offers a read-only calendar recheck.
- Actor, credential, workspace, navigation generation and permissions are checked before dispatch and after every response. Focus/visibility/storage resume reloads credentials and authoritative membership. A previous account's draft or late response cannot enter the current Calendar.
- Field event, transportation and territory links retain organization scope and the separate field-access requirement.

## Read contract

The controller uses the optional coalition-only overlap list:

```text
GET /api/coalitions/:id/calendar/items?overlap=true&from=<milliseconds>&to=<milliseconds>
```

It follows opaque continuation cursors, including empty filtered pages, and requires the explicit `overlap: true` response marker. Calendar intervals include events that began before the visible range. A refresh obtains subsequent changes; pagination is not a database snapshot. Forty pages or 10,000 evaluated/returned records trigger an explicit incomplete-results notice rather than a false complete calendar.

Existing `POST .../calendar/items` and `GET .../calendar/connections` remain the write and connection contracts. There are no invented edit/delete, RSVP, approval, recurrence or connection-management controls.

## Validation

```powershell
node --test tests/calendar-model.test.mjs
node node_modules/@playwright/test/cli.js test --config tests/coalition-calendar.playwright.config.cjs
npm run lint
npm run build:frontend
```

Browser tests use actual built frontend assets with isolated fictional API responses. They cover both roles, responsive month fit, calendar views, data/filter/date functions, field handoffs, real request bodies, DST/all-day handling, connection permissions, save recovery, pagination and stale actor/workspace responses. The release artifact records served-asset/source/build/test hashes before and after verification and audits the API isolation of every trace.

Release evidence and the separately tested backend overlap contract are under `D:/CodexHome/artifacts/polis-calendar-approved-20261026/`. Production deployment and mocked business-action tests are reported separately.
