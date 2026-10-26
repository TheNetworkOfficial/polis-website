# Website session renewal

Authenticated shared-app API requests renew an expired or nearly expired session
before dispatch. The existing refresh credential is used; access-token lifetimes,
permissions, sign-out behavior, and server-side authorization are unchanged.
Concurrent renewals share one Cognito request. No timer renews an inactive page.

Renewal keeps browser-local file preparation in place. A page, account, or sign-in
change while renewal is pending cancels the old operation. The auth layer guards
credential persistence so a delayed response cannot undo sign-out or overwrite a
new sign-in. A transient renewal failure leaves saved credentials available for a
later attempt. A revoked or expired refresh credential still requires sign-in.

There is no automatic request replay, including after 401, 403, or network errors.
This preserves upload, message, policy-acceptance, and device-proof boundaries.
Text Banking unload release keeps its synchronous dispatch with its existing
valid-session guard. Anonymous and pre-signed storage requests are unchanged.

Focused checks cover renewal across expiry, concurrent requests, transient and
terminal failures, account/sign-out fencing, cancellation, one-time dispatch,
Governance token selection, Text Banking exit, policy acceptance, and Messenger
proof transport. No customer imports, messages, or Cognito settings are needed.
