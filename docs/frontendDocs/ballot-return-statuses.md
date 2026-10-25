# Website county return-status preparation

The website prepares mixed county return files locally before using the existing
bounded, returned-ID-only upload. No backend, native app, quota, or storage
contract changes are required.

After choosing the official voter ID and return-status columns, staff select
**Read return statuses**. The worker scans the entire file and displays every
exact code and its row count. Exact `R` defaults to received and exact `X` to
voided, following the documented Maricopa EV33 layout. Staff confirm every
meaning; unfamiliar and blank values require an explicit choice. The available
meanings are received, voided, or another record excluded from this update.

Only received voter IDs in the retained election cohort are emitted, once each.
Voided rows are excluded. If the same retained ID has both received and voided
records, the worker withholds that ID regardless of file order. The review shows
the conflicting-voter count and requires an explicit acknowledgement that those
voters keep their prior status before any other received IDs may upload. County
dates and file order do not select a winner. Excluding a voided record preserves
history; it does not reverse a previously recorded return or establish whether a
ballot has been accepted.

Files containing `BALSTATUS` must use status classification. A genuinely
statusless, return-only file requires an explicit confirmation. An all-voided or
otherwise zero-match result creates no import. Staff can return to the status
choices and reprepare locally without sending the county file to an operator.

The source remains limited to 512 MiB with 256 KiB reads, 55 columns, the existing
record/field/time limits, and at most 32 status codes of 160 UTF-8 bytes each.
Retained ID decisions remain bounded by the validated election allowance, up to
125,000 IDs for C4D. Existing 50 MB output, actor, snapshot, date, cancellation,
resume, and server usage controls remain in place. The initial IND/PND cohort
preparation is unchanged.

Source: [Maricopa EV33 layout](https://recorder.maricopa.gov/asset/jcr%3A363c361a-e75b-42d0-835b-75af6f9d4909/Early%20Ballot%20Returns%20Layout.pdf).

Focused local checks:

```powershell
node --test tests/files/ballot-preparation.spec.mjs tests/files/ballot-preparation-flow.spec.mjs
```

These cover full-file status discovery, unknown and blank codes, R/X ordering,
deduplication, empty output, explicit confirmations, stale preparation, baseline
compatibility, and existing capacity/cancellation bounds. Deployment acceptance
and a local browser check are recorded separately from these unit checks.
