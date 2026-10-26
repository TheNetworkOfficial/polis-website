# Browser sign-in deployment

The website's sign-in, signup, confirmation, and password-recovery pages are
website source. The secondary page on the `amazoncognito.com` domain is a
separate Cognito managed-login application; website styles cannot change it.

## Website configuration

Set `COGNITO_SUPPORTED_IDENTITY_PROVIDERS=COGNITO,Google` in the website server's
existing authentication environment to expose Continue with Google. The value
must match the app client's enabled providers. The safe default is `COGNITO`,
which hides the Google option. Runtime server hydration, dynamic app pages, and
static builds all carry this public value. Static-only hosting also requires
the value at build time.

Preserve the existing Cognito region, client, domain, password-flow switch,
scopes, and callback URL. In particular, the live browser client currently
allows `/feed` callbacks; changing the redirect to `/auth` would require a
separate Cognito callback configuration change and is unnecessary here.

The Google action uses the existing authorization-code flow and PKCE, adds
`identity_provider=Google` to go straight to Google, and requests explicit
account selection with `prompt=select_account`. Generic secure sign-in remains
available for provider-managed verification and other supported sign-in methods.

## Read-only Cognito observation, October 25, 2026

- Region: `us-west-2`; pool: `us-west-2_3HsrxtPWY`.
- Domain: `coalition-auth-app-dev-coalition`; active, managed login version 2.
- Browser client: `22eciikk0fs5hvhicistqcc9vh` (`web-portal-client-prod`).
- Enabled providers: `COGNITO` and `Google`.
- Password auth is enabled (`ALLOW_USER_PASSWORD_AUTH`).
- Branding ID: `ad99057a-06b2-4f62-bec1-66db5a7117f7`.
- Branding uses Cognito-provided defaults, has no custom settings, and has no
  assets. The merged defaults enable the abstract background and force light
  mode, explaining the second screenshot's appearance.

No accounts were signed into and no production resources were modified.

## Deployed external-page styling, October 25, 2026

`cognito-browser-branding.request.json` records the applied settings for the existing
browser client's branding ID. It removes the stock abstract background and
uses the website's Polis background, surface, border, text, and primary colors,
with consistent 12px controls and a 24px form. It selects dark mode to match the
website's default, and defines both color palettes for later theme changes.
It does not change authentication methods, app clients, callbacks, domain
version, sessions, or any other client's branding. It contains no secrets.

The user authorized production deployment in this chat. The existing style was
updated through `UpdateManagedLoginBranding`; API readback matches every
requested setting. The existing `frontend/src/assets/images/polis/Polis.png`
was uploaded as a browser-adaptive `FORM_LOGO` asset and enabled at the top of
the form. Its SHA-256 is
`484b7e74931eed3eb57442104d2ce3f60db4ff6d19afc57bc8597ad2ad9a7a37`.
The lightweight JSON file records settings only; the full binary asset request
and before/after responses are retained outside Git in
`D:/CodexHome/artifacts/polis-browser-signin-release-20261025/cognito`.
The provider still controls layout and typography, so full website font and
spacing parity must not be claimed for this secondary page.

Before the update, both merged and unmerged branding and asset responses,
client configuration, and domain state were saved for rollback. The deployment
did not delete or recreate the style, modify the shared domain version, change
callbacks/providers/auth methods, or modify user accounts. The per-client
readback and client-configuration preservation receipt are in
`APPLY_RECEIPT.json`. Browser propagation and visual acceptance evidence are
recorded separately in the release artifacts.

For this observed initial state, rollback uses the same branding ID and pool
with `UseCognitoProvidedValues: true` and **omits** `Settings` and `Assets`.
Recheck before applying: if another operator customizes the branding, restore
the saved style and assets instead of reverting to defaults.

Sources:

- [Authorization endpoint and provider prompts](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Managed-login branding editor](https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-brandingeditor.html)
- [UpdateManagedLoginBranding request and partial-update behavior](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateManagedLoginBranding.html)
