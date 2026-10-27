# Organization Administration

The organization Administration route, `/coalitions/:id/admin/edit`, contains
Profile and Outreach templates. Profile uses two responsive panels for organization
identity and contact details. PAC details and social links expand when needed.
The mobile organization menu and page actions remain reachable while scrolling.
People, invitations, membership roles, join requests and Rooms stay in their
existing workspace sections.

Profile edits require active `profile_manage` authority or an administrator/officer
role. Other authorized leaders can inspect the profile without editing it. Ordinary
members cannot manage the profile. Qualified voter-map members can inspect shared
outreach templates; only administrators/officers can save them. Every write reads
current membership authority before dispatch.

The profile editor uses the existing organization PATCH API, including revision
preconditions and request correlation. A conflict preserves the draft and offers
an explicit reload. A save with an uncertain outcome keeps its submitted request
until the user checks or retries it. Matching field values alone do not establish
that an interrupted request succeeded.

Image selection validates JPG, PNG or WebP up to 8 MB in the browser, negotiates an
existing Cloudflare Images upload, and posts multipart bytes to the negotiated
provider URL. Successful upload stages the delivered image URL in the profile
draft. Save profile applies that URL. Hosted image URLs are also supported.

Outreach retains the four existing API keys: `phoneCall`, `textMessage`,
`mailEmail`, and `mailPhysical`. Titles allow 120 characters and bodies 5,000.
Partial drafts are valid; both title and body must be present for the Ready label.
Merge fields update the local preview. Saving shared templates does not send
messages. Profile and template drafts, errors and recovery remain independent.

The controller fences responses and provider dispatch by actor, organization,
credentials and current authority. Transient session renewal failures preserve
drafts; definite lost access clears private form data. Superseded reads cannot
restore old edit permission. Sidebar and browser history navigation protect
unsaved changes and pending writes.

Run the focused model and browser checks with:

```powershell
node --test tests/administration/model.test.mjs
npx playwright test --config tests/coalition-administration.playwright.config.cjs
```

The browser fixture isolates all organization, template, identity-provider and
image-provider requests. It tests fixture mutations, including the multipart
upload contract; it does not modify real organizations or deliver outreach.
