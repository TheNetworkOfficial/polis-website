# C4D daily sent-ballot additions

This website workflow requires the backend's `sentUpdates` capability. Source
changes alone do not enable it. No mobile release or new election is required.

After the first master is published, the controlled dashboard shows two labeled
choices: **Sent ballots — EV32**, with **Upload sent-ballot file**, and
**Returned ballots — EV33**, with **Upload returned-ballot file**. Add sent
ballots first, then match returns. Each preparation screen identifies its
workflow. A return-status review containing S explains how to return to the
sent upload; it leaves the status meaning unselected. Sent and returned files
are never interchangeable.

The sent file must include the original master columns, including `VOTERID`,
`CONDIST`, `PARTY`, `BALSTATUS`, and `ELECTDATE`. Source columns may be reordered;
prepared output keeps the original master order. New rows must be CD8, IND or
PND, reported as S, and belong to the selected election. X rows and new IDs with
conflicting sent records are excluded. Unknown eligible-row status codes stop
preparation. Conflicting new IDs require explicit acknowledgement before the
other prepared voters can upload.

Preparation downloads only the authorized current voter-ID export and reads the
county file locally. Existing IDs are skipped, preserving previous returns and
all stored voter data. The review shows new, already tracked, outside-selection,
voided and conflicting counts. A file with no new eligible voters creates no
import. Successful output is named `prepared-sent-ballots.csv`; review and apply
it through the normal county-update steps.

Each prepared sent update is limited to 5,000 new voters and 5 MB. The existing
125,000-voter/50 MB cohort limits, one active import, two imports per day and 35
per month still apply. Sent and return imports share those counters. Preparation
uses one private ID export, subject to the existing export limits.

Apply sent additions before matching the same day's returns. Both reports may
use the same official county date. If returns were already applied, match the
latest return report again after adding voters; a reached daily import limit
means continuing on the next day. Never invent a later report date or time.

Prepared files remain bound to the current account, organization, election,
published snapshot, election date, original schema and controlled capability.
Changing any of those invalidates the old preparation. Website session renewal
continues to preserve active preparation during normal token expiry.
