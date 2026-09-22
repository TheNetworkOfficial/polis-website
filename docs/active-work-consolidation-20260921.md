# Active website work consolidated for the next release

Governance access-token transport, exceptional-disclosure continuation, aggregate
result normalization, and fresh DRAFT-only edit enforcement are integrated with
current main. Prepaid balance, payment terms, government-information sources, and
the Files deferred-focus fix remain intact.

The Governance browser tests now use the same local server as the Files suite.
`npm run test:files:e2e` also includes the Governance passkey settings flow.
The combined browser run covers 164 cases; API behavior in this suite is mocked.
Real production authorization and physical passkey acceptance are separate gates.

The Files focus regressions passed on the combined source. A read-only public
request to `https://polisapp.io/files` during consolidation redirected to `/404`;
this does not establish that the merged Files focus fix is served in production.
The next website rollout must reconcile the preserved production overlays rather
than assuming deployed source equals main or replacing those overlays blindly.

No production deployment is part of this source merge. Commits use
`[CF-Pages-Skip]` to retain the deployment boundary. Preserve original worktrees,
the deployed prepaid release, selective Governance patches, and rollback backups.
New work starts from current remote main, not an older preserved checkout.

Local verification and source-preservation evidence:
`D:/CodexHome/artifacts/polis-active-consolidation-20260921/`.
