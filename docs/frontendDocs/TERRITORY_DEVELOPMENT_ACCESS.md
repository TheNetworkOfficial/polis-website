# Territory development access

Territory creation, editing, generation and assignment administration are hidden
from ordinary website users, including organization administrators. Existing field
maps and assigned territory coverage remain available under their existing access
rules. Direct wizard routes, their legacy aliases and stale management controls
fail closed.

The website requires both of these conditions before showing a development tool:

- Webpack is running in `development` mode and the build environment explicitly
  sets `POLIS_TERRITORY_DEVELOPMENT_ENABLED=true`.
- A fresh authorized voter-map access response for the current actor and owner
  contains `capabilities.territoryDevelopmentAccess === true`.

The capability comes from the existing candidate or coalition voter-map access
endpoint. The access response must indicate success. Admin/owner status alone,
string values, browser storage, URL parameters and runtime page configuration do
not enable the tool. Production builds remain disabled even when the build flag
is set. The backend independently authorizes every development operation.

An access read revokes the previous development grant while loading. Errors,
revocation, account/session changes, owner changes and navigation invalidate the
grant; late responses cannot restore a prior actor's or location's access. Opening
the wizard after navigation requires a new access read. Ballot Chaser's territory
handoff uses the same grant and hides its button when access is unavailable.

This change adds no Geocodio client, key, job controls, automatic address imports
or provider requests. Development geocoding is operated through separately
authorized server APIs. Enabling this website gate does not configure or authorize
those server APIs.

Local validation uses mocked API responses in both production and development
Webpack outputs. The production fixture deliberately sets browser flags and
returns the server capability to verify that neither bypasses the build gate.
