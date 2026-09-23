# Coalition website refresh

Implements the approved coalition presentation using the current website's real
data, routes, forms, and permissions. The deployed Texting Hub remains the texting
destination. No backend, Flutter, payment, or messaging transport changes are
included.

## Changes

- Branded coalition header and responsive navigation, compact overview, and
  consistent styling for onboarding, People, administration, missions, calendar,
  field tools, governance, petitions, and Amplify. Longer access catalogs and
  setup guidance use expandable disclosures.
- Coalition Rooms use channel categories, a conversation pane, a member sidebar,
  and a compact mobile composer. Existing attachment, reply, reaction, pin,
  moderation, encryption, and room administration controls remain connected to
  their original handlers. Private and other messaging scopes retain their shell.
- Files uses a prominent scoped search, folder cards, file rows, list/grid views,
  and responsive preview/sharing/review interfaces. Existing resumable upload,
  immutable versions, focus preservation, and permission checks remain intact.
- Coalition Files links derive the workspace ID from accessible discovery results.
  An explicit `?workspace=` selects only that accessible workspace; an unavailable
  ID shows the existing access error instead of falling back to another customer.
- Texting routes, its UI modules and stylesheet, checkout, and balance controls
  remain unchanged. The new coalition navigation opens their existing routes.

## Validation

The focused browser configuration runs nine checks:

```powershell
npx playwright test --config playwright.coalition.config.cjs --reporter=line
```

They cover coalition section navigation, admin/member restrictions, the Texting
handoff, scoped Files selection, unavailable workspace refusal, mobile layout,
Rooms composer and member display, unrelated private messaging, Files list/grid,
folder search, review/sharing, upload focus, and the existing manual texting flow.
API calls in these checks are mocked. They do not send messages, submit real forms,
charge customers, or establish live provider acceptance.

Source checks: project ESLint, focused Prettier, `git diff --check`, and production
frontend build. Existing bundle size warnings remain. The backend startup command
was attempted but stopped at its missing `SESSION_SECRET` check in this isolated
checkout; no backend source or configuration changed.

## Scope and release

This is a website implementation, including mobile web. Existing native-only
handoffs remain, including features whose full workflow is available in the app.
The coalition calendar continues using its existing agenda and creation workflow;
this refresh does not add a calendar service, voice rooms, or a map editor.

Canonical implementation `ad3121a` is pushed to GitHub main. The user subsequently
authorized website deployment. Production integration is isolated on
`codex/coalition-web-live-20260923`, preserving the current production source and
Text Banking's separately coordinated import fix. The standalone Files entrypoint
uses the verified existing public API/auth configuration.

Release uses a staged static asset directory, preserves incumbent assets, and
switches nginx's static root gracefully. The Node/API service, its frontend-root
override, customer records, and active browser sessions remain untouched. Text
Banking releases first; this release integrates its production commit afterward.
No native app-store release is included.
