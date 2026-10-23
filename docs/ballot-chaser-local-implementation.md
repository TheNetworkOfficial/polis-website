# Organization Ballot Chaser: local implementation

## October 23 county-file preparation (source only)

When the server enables bounded preparation for an organization, new register
elections use `preparationPolicy: "bounded_v1"`. The website requires the fresh
election-list availability flag and the selected election's enabled policy;
missing availability or a disabled rollout stops preparation. Other organizations
retain the existing workflow. Existing published lists remain readable.

The import flow previews a header and three records from county TXT, CSV or TSV,
then asks for the official voter-ID column and exact district/party conditions.
A Web Worker reads bounded file slices and prepares UTF-8 CSV on the device.
It preserves strings and leading zeroes and rejects ambiguous layouts, invalid
encoding, conflicting selected IDs and unsupported limits. Source files may be
up to 512 MiB; prepared files and the retained cohort are limited to 50,000,000
bytes, 50,000 voters and 55 source columns with 64-byte headers. Fixed-width
layouts and unknown county meanings require review rather than inferred mapping.

Daily returns use the existing authorized private export with `view: "all"`
and only `ballotVoterId`, including already-returned voters. The website checks
the pinned snapshot, reauthorizes the download, and intersects exact official IDs
locally. It removes repeated matching IDs and reports unknown/excluded rows.
The prepared return file contains only the canonical `Voter ID` column. A day
with no matches produces a local receipt and no import. The cohort cannot grow
through later issued files in this workflow.

Staff review counts, report meaning and the genuine official report date before
uploading. Baselines use Issued and returns use Returned; missing voters retain
their earlier status. All bounded uploads use the existing checksum-pinned
multipart path, including small prepared files. Interrupted uploads can prepare
the original source again and resume the same acknowledged import. Server quota,
permission and stale-snapshot failures stop the flow without creating replacement
jobs. This source work performs no deployment, customer import, provider send,
infrastructure upgrade or store release.

Focused validation passes: 21 streaming/parser tests, nine preparation-controller
tests, 37 existing model/checksum tests, three new real-Worker browser scenarios
and 31 existing Ballot Chaser/register browser scenarios. The production build,
changed-file ESLint, formatting and diff checks pass; two existing bundle-size
warnings remain. Evidence is recorded outside the repository under
`D:/CodexHome/artifacts/polis-ballot-selfservice-20261023/`.

## Compact county voter register (local source)

New elections explicitly request `storageMode: "register"`. Their five ballot
lists use the election's authorized `/voters` endpoint, pinned to the published
snapshot, with server pagination, search, sorting and typed grouped filters.
Only the returned register schema supplies filter and column choices, including
declared county source fields. County details are readable without a contact
lookup. Existing elections with no register mode retain the Contact Book path.

Register selection uses opaque `voterRef` values, independently of nullable
`contactId`. Selected and all-matching CSV exports preserve references,
exclusions, filters, sorting and canonical ballot columns. Browsing, filtering
and exports never create Contact Book records or start outreach. Each private
download still obtains fresh server authorization through the existing export
controller. Stale snapshots, cursor bindings or changed access clear the list
and selection and require refresh.

Only users with import permission see **Add selected to Contact Book**. This
explicit operation submits up to 5,000 selected voter references and polls its
returned job with GET. An interrupted POST retains its exact request ID and
payload for an explicit check, locks selection changes, and never silently
submits a new operation. Neither successful materialization nor exporting starts
texting or exposes the territory wizard. Import summaries describe register
records rather than claiming that every county voter became a CRM contact.

Local fictional fixtures cover both scopes, all views, nullable contacts,
source columns, grouped filters, all-matching exclusions, selection exports,
contact-job progress, interrupted responses, actor changes and stale snapshots.
Evidence is under
`D:/CodexHome/artifacts/polis-ballot-register-20261015/website/`.
These checks do not measure real 500k performance or authorize deployment.

### Register voters to a texting draft

The Outstanding list offers **Create texting campaign** only for a coalition
with current book read/select/export/personal/campaign access and a configured
Text Banking workspace with campaign and billing authority. The handoff freezes
the snapshot, filters, search, sort and explicit voter references or all-matching
exclusions. It opens the existing campaign composer without creating contacts.

**Review recipients** starts the server's register selection job. Only schema
fields advertised with `textingPhone: true` appear as phone choices; a declared
`phone` field is the default, while other columns require an explicit choice.
Polling reads the acknowledged selection. Interrupted creation or binding keeps
the same operation and request for an explicit retry, including tab-draft
restoration. Only query intent and job references are retained; recipient rows,
phone values and grants are not stored in the browser draft.

The review distinguishes eligible numbers, recipients awaiting sender-consent
review and excluded/held numbers. Ready requires a positive, consistent
`recipientCount = eligibleCount + consentReviewableCount`; consent-review numbers
are never labeled eligible. The user must acknowledge the reviewed manifest
before Save binds that audience. Cost estimates include the prospective consent
review cohort with a visible note. Saving creates a draft; existing sender
consent, provider preparation, activation and per-person confirmation remain
separate requirements. A newer snapshot, changed access or mismatched manifest
invalidates review. Returned and other ballot lists offer no campaign shortcut.

Focused unit and compiled browser evidence for this handoff is under
`D:/CodexHome/artifacts/polis-ballot-texting-handoff-20261015/website/`.
It uses fictional local responses and performs no provider or production action.

## October 15 client update (local source only)

Ballot Chaser supports coalition and candidate workspaces when the current
Contact Book schema grants both `read` and `ballotChaser`. Five pinned views
reuse normal filters and selection: Outstanding, Newly returned, Returned,
Needs follow-up and All voters. The current and previous county report dates
stay visible. Returned counts physical returns; Accepted is separate.
Needs follow-up includes unknown, cure-required and rejected ballots. Newly
returned means the first confirmed outstanding-to-returned transition in the
current update, rather than voters discovered already returned in a baseline.

Ballot CSV exports use a background server job, preserving explicit selected
IDs or all-matching filters and exclusions. The browser does not fetch thousands
of CSV pages or assemble the file in a Blob. Each Download CSV click checks the
job again for a fresh authorized private URL. A newer county publication or
changed Contact Book clears the old download and asks the user to refresh.
Explicit selections retain selected order; all-matching exports retain sorting.
Generic Contact Book exports are unchanged.

Files above 16 MiB use two signed S3 part uploads at a time. A streaming SHA-256
pins the original file before resuming saved parts; progress counts confirmed
bytes. The upload completion includes every saved/new part ETag. Smaller files
keep a single protected PUT. Comparison/publication progress uses actual phase
counters without a completion-time promise. State selection replaces the fixed
Arizona election field.

Contact mapping now separates Keep in report only from Add county field and
existing contact fields. Empty choices are sent in `sourceOnlyColumns`; they
retain the original county data without making volatile report metadata into a
contact field. The Add county field marker is local UI state and never appears
in `fieldMapping` or `sourceOnlyColumns`. Existing nonempty field mappings stay
visible and preserved even when their schema choice is temporarily unavailable.
Before applying, Edit mapping can replace a reviewed mapping; Cancel restores
the saved choices. Late progress reads cannot restore an older mapping.

Text Banking handoff remains Outstanding-only and coalition-only on the website.
The territory wizard is hidden in ordinary builds, including for administrators;
development builds additionally require a fresh server-issued tester capability.
Existing assigned field coverage remains available. No geocoding runs from
Ballot Chaser import, filtering or export.

The validation receipt for this source update is external to the repository at
`D:/CodexHome/artifacts/polis-ballot-fast-20261015/`. No deployment, live import,
provider request, packaging or store release is authorized by these local checks.

## Original implementation record

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
