# Texting website interface

The organization texting workspace uses the approved September 23 design and the existing Polis logo. It shares the existing authenticated APIs with the app; it does not provision a vendor account or establish messaging approval.

## Routes

- `/organizations/:id/texting`: workspace home and setup/sending status.
- `/texting/registration` and `/texting/settings`, under that organization: registration wizard, saved review status and settings.
- `/texting/contacts[/new|:importId]`: upload, column mapping, sample review, import results and explicit vendor preparation.
- `/texting/campaigns[/new|:campaignId]`, `/texting/team/:campaignId`, `/texting/send/:campaignId`, `/texting/results/:campaignId`: campaign drafts, assignments, individual confirmations and recorded activity.
- `/texting/inbox` and `/texting/conversation/:conversationId`: recorded conversations, outgoing replies and opt-outs.
- `/organizations/:id/texting-balance`: existing payment return URL, balance, purchase review and history.

All deep links require normal Polis authentication. Organization entry is available to active members; actual capabilities and billing permissions come from authenticated server responses.

## Preserved boundaries

- Registration includes the Campaign Verify token and expiration, required-field validation, website guidelines and explicit review authorization. Saved token values are never returned to the browser.
- Prices, packs, tax disclosures, billing authorization, receipt identity and payment confirmation remain server-owned. Opening checkout or its return URL never credits funds.
- Balance navigation, financial figures and billing details require the server's organization-admin billing capability. Volunteers use the redacted sending status; prices and balances are not required in their browser to confirm an eligible message.
- Texting Settings loads organization daily sending hours from `/delivery-schedule`. Administrators save clock times with the current revision. The reviewed provider timezone is displayed read-only. Campaigns can inherit those hours or use a narrower daily window; draft, prepared and paused campaigns use a separate revision-checked schedule PATCH so saved message content is preserved. Changing hours never activates a campaign or schedules automatic messages.
- Active, Paused and Archived campaign views use server-side filtering and retain cursor pagination, including an empty filtered page with older history available. Archiving preserves campaign records, messages and results.
- Contact uploads use checksummed, signed multipart storage requests without account credentials. Mapping review, consent and source provenance remain explicit.
- Provider work occurs only after an explicit action. Every initial send requires its own current authoritative recipient/message preview and confirmation. Unknown send outcomes remain held without automatic retries.
- Replies retain permission, opt-out, spending and approval restrictions. Funding cannot activate messaging.
- After an accepted reply, the conversation refreshes its saved messages and sending allowance. A short, bounded series of read-only checks catches delayed delivery callbacks; it never repeats a send. Returning to the conversation refreshes saved messages while preserving an unsent draft.
- Customer state and late responses are fenced to the signed-in user, organization and current view.
- Metrics unavailable from the current API are not invented; results show recorded campaign status and spending.

## Focused verification

Run `node --test tests/texting/*.test.mjs` and `npx playwright test --config=playwright.texting.config.cjs`, then the repository lint and production frontend build. Browser fixtures mock backend requests and do not pay or send messages. Avoid running the dev server and production build in the same worktree concurrently because webpack cleans their shared output directory.

The approved live purchase and controlled carrier acceptance remain separate from mocked website verification. Native app releases are outside this website change.
