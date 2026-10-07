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
- Queue validation failures show a visible explanation and a neutral **Sending unavailable** status. Only an explicit recipient suppression is labeled **Opted out**. **Check recipient again** revalidates a held, unattempted recipient through the normal queue endpoint; it does not confirm a send. Pending and uncertain sends remain fenced for administrator review.
- **Refresh message previews** renews an expired, untouched standard recipient preview through the existing held queue. It does not fetch another provider allocation or send a message. Attempted sends and expired provider assignments retain their review fences.
- Paused or archived campaigns expose **Review held recipients** only when the server reports `queueRecoveryRequired`. Recovery retains the existing assignment, shows no Send control, and permits Skip only from the item's authoritative `canSkip` value. Finishing a stopped assignment never requests another group.
- **Campaign limits** lets authorized managers extend a prepared, active or paused campaign's end date. Managers with billing permission can also increase its spending cap. The separate revision-checked update preserves frozen recipients and message content. A lost response requires a saved-state refresh before another update; this does not purchase funds or send messages.
- **Review stranded recipients** lets a campaign manager inspect assignments from removed volunteers or stopped campaigns. Each explicit Skip binds the saved campaign revision, owner, allocation, recipient and action ID. Only server-approved untouched items are actionable. Unknown outcomes hold the whole assignment across refresh/reload and are never retried; this flow never allocates recipients or confirms sends.
- Prepared campaigns expose **Prepare attachment** directly. After an explicit sync, the website rereads the campaign's frozen attachment readiness before offering Open. A verified asset alone cannot enable opening; a lost response requires attachment and campaign readback before another preparation attempt.
- Replies retain permission, opt-out, spending and approval restrictions. Funding cannot activate messaging.
- A reply rejected before sending can restore its draft only when the server reports `sendOutcome: not_attempted` for that exact action ID. Send stays disabled until both sending access/billing and the conversation have refreshed successfully after that rejection. Failed reads preserve the draft and require Refresh. An error code, HTTP status, or later `canReply` response alone never clears an uncertain reply hold.
- After an accepted reply, the conversation refreshes its saved messages and sending allowance. A short, bounded series of read-only checks catches delayed delivery callbacks; it never repeats a send. Returning to the conversation refreshes saved messages while preserving an unsent draft.
- Customer state and late responses are fenced to the signed-in user, organization and current view.
- Metrics unavailable from the current API are not invented; results show recorded campaign status and spending.

## Optional opt-in texting

The first workspace read negotiates `capabilities.neutralWorkspaceApi`; supported
sessions then use `/api/text-banking/workspaces/:scope`. Older servers continue
using the existing endpoints. The optional feature is disabled by default.

Settings includes a three-step secondary registration for administrators,
separate verification credentials, a quoted setup charge and recurring number
cost, and explicit approval of those charges. Unknown writes are checked by GET
before another change. Approval does not enable dual stream texting by itself.
The mode action is labeled **Return to single stream texting**.

Contacts can map documented consent fields alongside their source information.
An imported consent label alone remains a claim. Campaigns display server-owned
route counts and estimates. Queue items and conversations use neutral `stream`
identities to choose their rates; replies keep their recorded stream. A send
error never causes a request to another stream. Uncertain sends stay held for
administrator review. Unit prices retain four decimal places.

Focused coverage includes `tests/texting/dual-stream.test.mjs` and
`tests/files/texting-dual-stream.pw.spec.cjs`.

## Focused verification

### Campaign personalization

New and edited campaign messages show a compact **Personalize** picker when the
workspace advertises personalization version 1. The supported details are first
name, last name, full name, city, and state. The picker inserts the canonical
`{{first_name}}`, `{{last_name}}`, `{{full_name}}`, `{{city}}`, or `{{state}}` token
at the current caret, replacing selected text. The saved draft still uses only
`templateText`; opening the picker or typing never prepares contacts or sends a
message.

The phone preview uses fictional details and is labeled **Example preview**.
Missing-value guidance is collapsed until requested: first/full name use
“there,” last name uses “friend,” city uses “your community,” and state uses
“your state.” Actual contact resolution, frozen recipient values, final message
validation, and send prices belong to the backend. Older recipient snapshots
that cannot support personalization require a new campaign.

Unknown fields, case/whitespace variations, unfinished braces, literal braces,
and legacy double-square-bracket syntax show an inline error and disable Save.
The existing recipient review, STOP instructions, authorization, and explicit
send confirmation remain required. Workspaces without the capability retain
ordinary messages and reject pasted personalization fields.

Personalized SMS displays example segments and an example rate. Campaign totals
show **Varies by recipient** until the backend supplies an actual resolved
amount; template-token length and fictional values are never multiplied into a
campaign total. MMS retains its fixed message-rate estimate, subject to recipient
checks and routing. Volunteers continue to see the backend's exact per-recipient
message preview without administrator-only financial data.

Focused coverage: `tests/texting/personalization.test.mjs` and
`tests/files/texting-personalization.pw.spec.cjs`, alongside the existing campaign,
recipient-review, pricing, and permission suites.

Run `node --test tests/texting/*.test.mjs` and `npx playwright test --config=playwright.texting.config.cjs`, then the repository lint and production frontend build. Browser fixtures mock backend requests and do not pay or send messages. Avoid running the dev server and production build in the same worktree concurrently because webpack cleans their shared output directory.

The approved live purchase and controlled carrier acceptance remain separate from mocked website verification. Native app releases are outside this website change.

The admin review panel reads saved delivery evidence without resending or accepting
a caller-supplied outcome. Protected opt-in MMS previews use campaign-scoped media
reads; inbound attachments are opened through local authenticated paths. Unit
rates retain four decimal places. The existing stream keeps its current API until
the server explicitly advertises the neutral workspace capability.
