# Territory authoring and development access

The territory builder is available only after a fresh authorized voter-map access
read for the current actor and owner. Production authoring requires all of:

- `capabilities.territoryAuthoringAccess === true`.
- `canManageTerritories === true`.
- A raw server map scope of `full` or `territories`.

Ordinary administrator status alone does not enable the builder. Candidate and
coalition menus, direct wizard routes and legacy route aliases use the same gate.
Existing field maps and assigned territory coverage keep their existing access
rules. The backend independently applies its rollout allowlist and authorization
to every authoring operation.

The website requires both of these conditions before showing a development tool:

- Webpack is running in `development` mode and the build environment explicitly
  sets `POLIS_TERRITORY_DEVELOPMENT_ENABLED=true`.
- A fresh authorized voter-map access response for the current actor and owner
  contains `capabilities.territoryDevelopmentAccess === true`.

The capability comes from the existing candidate or coalition voter-map access
endpoint. The access response must indicate success. Admin/owner status alone,
string values, browser storage, URL parameters and runtime page configuration do
not enable the tool. The development capability remains disabled in production
builds even when the build flag is set. A production authoring grant does not
enable the legacy district Wizard, Editor or their mutation controls. Existing
territory coverage can still be reviewed. The backend independently authorizes
every development operation.

An access read revokes the previous grant while loading. Errors,
revocation, account/session changes, owner changes and navigation invalidate the
grant; late responses cannot restore a prior actor's or location's access. Opening
the wizard after navigation requires a new access read. Ballot Chaser's territory
handoff uses the same grant and hides its button when access is unavailable.

This client gate adds no Geocodio client, key, job controls, automatic address imports
or provider requests. Development geocoding is operated through separately
authorized server APIs. Enabling this website gate does not configure or authorize
those server APIs.

Local validation uses the existing access and builder-model unit tests and mocked
route checks against a production Webpack output. The fixture deliberately sets
browser flags and returns the development capability to verify that neither
bypasses the separate development build gate. Production authoring checks cover
both scopes, menus, route aliases, read-only existing coverage, navigation,
refresh/revocation and the Ballot Chaser handoff. This validation does not deploy
the website or enable a server rollout.
