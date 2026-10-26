# Organization workspace navigation

Entering a coalition workspace opens its Home dashboard. Explicit People links
still open People. Scoped workspace aliases also resolve to the dashboard.

Organization navigation surrounds coalition pages and their scoped shared tools,
including Texting, Contacts, Ballot Chaser, publishing, social tools, and Files.
Shared detail pages carry `organizationScopeType` and `organizationScopeId` URL
parameters so refresh, Back and Forward retain the navigation context. These
parameters are presentation hints: current authenticated membership or campaign
access must be read independently before showing organization identity and tabs.
Missing, pending or inactive membership cannot establish navigation access.

Use **Exit workspace** to return to the consumer feed without scope parameters.
The organization logo returns to its dashboard. Choosing another workspace uses
that workspace's identity. There is no global saved mode that can attach an old
organization to a different signed-in account.

Files keeps its own entitlement, authorization root, routes and API contracts.
Its organization frame additionally requires matching authorized Files ownership
and active coalition membership. Internal Files routes preserve the selected
workspace ID and scope parameters; switching Files workspaces and browser history
reload the correct organization. Plain Files links without an organization scope
remain standalone. Late membership responses cannot restore a former workspace
or account's identity.

The desktop sidebar stays below the sticky organization header, fits the viewport,
and scrolls independently when its tabs are taller than the available space. On
mobile, the organization menu stays below the header and its expanded choices
have their own bounded scroll area. Tool-specific controls remain inside their
original tools.

Run the navigation regression suite with an existing development or production
build server and an installed Playwright browser:

```powershell
node --test tests/workspace-navigation.test.mjs
node node_modules/@playwright/test/cli.js test --config tests/workspace-navigation.playwright.config.cjs
```

The browser configuration supports `POLIS_TEST_BASE_URL`,
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `POLIS_WORKSPACE_NAV_OUTPUT_DIR`.
Navigation tests use fictional authorized records and isolated API fixtures.
