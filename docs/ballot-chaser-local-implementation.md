# Organization Ballot Chaser: local implementation

October 14, 2026. Source and fictional fixture validation only. No deployment,
real-contact import, provider transfer, messages, turf publication, commit, or
store release was performed.

The organization overview has a Work tile and the shared Contact Book has a
GOTV / Ballot Chaser shortcut. The neutral route is
`/workspace/coalition/:organizationId/work/ballot-chaser`; it works independently
of texting setup.

County CSV, TSV and XLSX reports use the shared backend's protected signed upload,
worksheet inspection, reviewed identity/status/contact mappings, staged full-file
outcomes, explicit apply, upload resume and history. Original values remain
retained; blank contact cells preserve existing values. A county-confirmed numeric
ID width can be reviewed when Excel lost string formatting. Missing rows never
imply a returned ballot. Report dates are submitted as UTC instants and displayed
in the viewer's timezone. The last completed report stays active while a new
report processes.
Request-only and return-only files can explicitly map the meaning of each row
when no status/date/flag columns supply it. The default remains Use mapped
columns, and missing voters still never imply a return.

Election setup explicitly reviews permitted source use, defaulting to Needs
review. A manager can revise it before the baseline; pending or completed
publication locks it while retaining the saved policy. Text Banking retains
sender consent, opt-in and opt-out checks. A county
row that may match an existing person without an official voter ID requires a
human choice of the labeled candidate, a separate person, or exclusion. A
candidate already linked to another official identity cannot be selected. Blank
cells preserve data unless specific original columns are explicitly selected to
clear that source's imported values; manual and volunteer corrections stay
protected.

Dashboard totals are authoritative API aggregates. The combined outreach metric
deduplicates voters reached by sent texts and confirmed conversations/literature
drops; its wording reports association rather than causation. County status
remains separate from volunteer self-reports.
Previously outstanding voters newly reported returned and newly found voters
already returned have separate counts. Without an exact official return time,
outreach timing uses the first report showing the return.

The outstanding list reuses Contact Book filters, saved views, numbered pages,
full-result frozen selections, protected CSV export and reviewed campaign
handoff. The query carries
`ballotChase: { electionId, snapshotId, outstandingOnly: true }` throughout normal
filtering, searching, selection, recipient preparation and campaign handoff.
DoorKnocker targeting carries `contactSelectionId` and the same election context
through territory metadata, source preparation, viewport, preview, draft and
publish requests. The server owns fresh-status and actor checks.

Ballot Chaser extends existing organization/round canvassing configuration with
the approved Ballot Chasing preset, preserving earlier questions and normal
editing/reordering. The web outreach form uses authorized paginated address,
exact unit and resident pickers, loads effective runtime round questions, and
submits the existing visit API with question-set revisions and respondent
answers. Conversations require the ballot question; literature drops need no
invented respondent. Uncertain saves retain the original submission identity and
answers for reconciliation. No normal product form requests internal Polis IDs.

Contact viewing, imports, exports, selections, campaigns and configuration keep
their separate server capabilities. Read-only viewers do not request import
receipts. Revoked ballot access clears private dashboard data.

Validation in the isolated D: worktree:

- 56 focused unit tests pass (ballot model, contact parser/guards, territory model,
  campaign handoff, person-selection standard).
  The isolated branch was fast-forwarded to current `origin/main` 73e1232 before
  final checks. Upstream camera request bounds remain, with a regression proving
  the active and newest queued viewport requests retain the frozen ballot cohort.
- 32 browser scenarios pass: fourteen Ballot Chaser scenarios, sixteen existing
  Contact Book scenarios, and two household desktop/mobile regressions. They
  cover source permissions, candidate identity choices, explicit blank clearing,
  all-returned door blocking, protected XLSX review, filtered campaign handoff,
  preset plus identified live visit, read-only access and revocation clearing.
- Repository ESLint and production frontend build pass. Existing shared-feed and
  Files bundle-size warnings remain.
- Screenshots are under `output/playwright/contact-book-results/`.
- Website backend startup with disabled dotenv, disposable local session secret,
  in-memory SQLite and blocked outbound networking is blocked by the existing
  shared sqlite3 installation lacking its Node 24 native binding. Shared
  dependencies were not rewritten.

Fictional parser/API/browser evidence does not establish throughput, production
permissions, provider behavior, native-device behavior or Arizona county-format
compatibility. A real Pinal sample and county pilot remain outstanding.
