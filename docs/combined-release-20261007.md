# Organization workspace and Text Banking integration

Organization publishing, Files handoff and folder lifecycle, Missions, people,
roles, audiences, social accounts, independent Contacts, and Text Banking
reporting are integrated on the October 7 website main. Campaign limit editing,
stranded-recipient recovery, attachment readiness, and reply eligibility from
Text Banking PRs 9 and 10 remain available with reporting enabled.

The `/workspace/coalition/:id` and `/workspace/candidate/:id` routes work through
the Node app shell and generated static shells. Deployment must route these
paths through the current server and distribute the matching shared-app and
Files assets. Deploy the corresponding backend contracts before this client.

For an immutable website server release, set `FRONTEND_DIST_PATH` to the reviewed
distribution and `POLIS_WEB_ASSET_VERSION` to that release identifier. Set
`POLIS_SKIP_SCHEMA_SYNC=true` to avoid schema synchronization during the server
restart; this release does not change database models. Existing behavior remains
available when that explicit synchronization guard is absent.

Local verification covers 340 Node unit tests and project-wide lint. Prettier
checks all changed source and test files while preserving their existing line
endings. The 93 Files/Missions browser cases pass; all 40 Text Banking browser
cases pass across the initial run and focused rerun. The latter explicitly
checks reporting with campaign management, and unread acknowledgment with reply
recovery. Browser requests use fictional accounts and mocked APIs.

Historical browser fixtures now follow the recipient review action and current
Contact Book import workflow. The Governance authorization transport fixture
executes the existing `fetchJsonRaw` implementation after its earlier rename.
These fixture updates do not change their production authorization behavior.

Build, deployment, startup and external verification receipts are kept outside
source in `D:/CodexHome/artifacts/polis-combined-release-20261007/`. Source checks
and mocked browser checks do not establish native-device or live-provider
acceptance.
