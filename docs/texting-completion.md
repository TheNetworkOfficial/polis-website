# Text Banking completion and results

The sender reads the current campaign completion descriptor on entry and after
an assigned batch ends. Results and explicit refresh use the same GET endpoint,
`/campaigns/:campaignId/completion`, under the existing workspace prefix.
Reads coalesce; there is no rapid polling or automatic campaign mutation.

Campaign completion requires an authoritative audience proof with zero remaining
and unresolved work. An empty queue or complete message-history coverage cannot
create that state. A batch celebration must match the known allocation. The
scene plays once per actor, organization, campaign and proof/allocation in the
current browser session, with a static reduced-motion presentation.

Metrics are real response values: all six integer counts or a whole null object.
Partial history stays qualified. Personal reply counts require attribution;
absent team/hourly metrics produce no invented graphics. Sent counts accepted
submissions and is distinct from delivered messages and frozen-audience progress.

Exit keeps the existing exact session-owned unused-recipient release path and
stays enabled during result reads and animation. Managers explicitly review
results, open the closure confirmation and confirm Close & archive. Immediately
before that single transition POST, the client reads a fresh completion proof and
includes its revision and `completionProofId`. Pending local work, stale reads,
permission changes and unknown archive acknowledgements hold closure. A failed
or uncertain POST is never replayed automatically. Archived results have no
reopen action; previous messages and history remain readable.

Local source/controller and mocked compiled-browser tests cover this flow,
including the pending Ballot register and campaign handoff. They do not establish
production API, provider, device or store acceptance. The paired backend completion
and guarded archive implementation must be packaged before client rollout.
