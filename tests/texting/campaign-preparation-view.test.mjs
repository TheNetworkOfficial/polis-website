import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { renderCampaignPreparation } = await import(
  await moduleUrl("textingCampaignPreparationView")
);
const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const preparation = (extra = {}) => ({
  status: "needs_attention",
  stage: "provider_transfer",
  selectedContactCount: 420,
  canResume: false,
  errorCode: "prompt_provider_records_not_ready",
  ...extra,
});
const render = (p, state = {}, canManage = true) =>
  renderCampaignPreparation(
    {
      ...state,
      campaign: { status: "draft", preparation: p },
    },
    { canManage, busy: false },
  );

test("a held preparation explains review, shows saved selection and never offers resume", () => {
  const html = render(preparation());
  assert.match(html, /An administrator must review the saved result/);
  assert.match(
    html,
    /texting service has not confirmed all selected recipients/,
  );
  assert.match(html, /420 selected recipients/);
  assert.match(html, /Saved step: Preparing contacts for texting/);
  assert.match(html, /Check preparation now/);
  assert.doesNotMatch(
    html,
    /Resume saved|resume this|Prompt|prompt_|provider_records|provider records/i,
  );
});

test("saved counts are shown only when supplied and valid, without claiming submitted contacts are ready", () => {
  const html = render(
    preparation({
      progress: {
        totalContactCount: 420,
        submittedContactCount: 100,
        verifiedContactCount: 0,
      },
      updatedAtMs: 1791288000000,
    }),
  );
  assert.match(html, /Submitted for preparation: 100 of 420 recipients/);
  assert.match(html, /Confirmed ready: 0 of 420 recipients/);
  assert.match(html, /Last saved update:/);
  assert.doesNotMatch(
    render(preparation()),
    /Submitted for preparation|Confirmed ready|Last saved update/,
  );
  assert.doesNotMatch(
    render(
      preparation({
        progress: {
          totalContactCount: 420,
          submittedContactCount: 421,
          verifiedContactCount: 0,
        },
        updatedAtMs: -1,
      }),
    ),
    /Submitted for preparation|Confirmed ready|Last saved update/,
  );
});

test("another manager is directed to the original approver without a resume button", () => {
  const html = render(
    preparation({
      status: "ready_to_finalize",
      recoveryAction: "original_approver",
    }),
  );
  assert.match(html, /Ready for the campaign check/);
  assert.match(html, /person who approved this selection needs to continue/);
  assert.doesNotMatch(
    html,
    /campaign-preparation-resume|checks progress automatically/,
  );
});

test("a service review points staff to Polis support rather than implying they can repair it", () => {
  const html = render(preparation({ recoveryAction: "operator_review" }));
  assert.match(html, /Polis support must review the saved result/);
  assert.doesNotMatch(html, /An administrator|Resume saved preparation/);
});

test("resume is offered only to an authorized manager when the server permits it", () => {
  const p = preparation({ canResume: true });
  assert.match(render(p), /Resume saved preparation/);
  assert.doesNotMatch(render(p, {}, false), /Resume saved preparation/);
  assert.doesNotMatch(render(preparation()), /campaign-preparation-resume/);
});

test("paused and failed checks describe checking rather than claiming work stopped", () => {
  const p = preparation({ status: "preparing" });
  assert.match(
    render(p, { preparationPollingPaused: true }),
    /Preparation checks are paused/,
  );
  assert.match(
    render(p, { preparationPollError: "Check the saved result." }),
    /Preparation status could not be confirmed/,
  );
  assert.doesNotMatch(
    render(p, { preparationPollingPaused: true }),
    /Preparation stopped/,
  );
});

test("unknown stages, errors and invalid counts are not displayed as technical or untrusted text", () => {
  const html = render(
    preparation({
      stage: "<unknown>",
      errorCode: "<script>private-code</script>",
      selectedContactCount: -1,
    }),
  );
  assert.match(html, /Saved step: Checking saved preparation/);
  assert.doesNotMatch(html, /unknown|script|private-code|-1 selected/);
  assert.equal(render(preparation({ status: "complete" })), "");
});

test("a saved hold prevents another Prepare even when the local loading flag is stale", async () => {
  const calls = [];
  const view = {
    campaigns: {
      preparingRecipients: false,
      campaign: {
        campaignId: "campaign-one",
        name: "Fictional campaign",
        revision: 7,
        status: "draft",
        templateText: "Example Civic Team: hello. Reply STOP to opt out.",
        assignedUserIds: [],
        blockedReasons: [],
        preparation: preparation(),
      },
    },
  };
  const page = createCampaigns({
    view: () => view,
    can: () => true,
    busy: () => false,
    guard: () => {},
    context: () => ({ resourceId: "campaign-one" }),
    contactApi: { invalidate: () => {} },
    api: async (...args) => {
      calls.push(args);
    },
  });
  assert.doesNotMatch(
    page.render("campaigns"),
    /data-workspace-action="transition-prepare"/,
  );
  await assert.rejects(
    page.action("transition-prepare"),
    /already has a saved preparation/,
  );
  assert.equal(calls.length, 0);
  page.dispose();
});

test("opening a campaign describes volunteer setup without recipient import or resume actions", () => {
  const state = {
    campaign: {
      status: "activating",
      preparation: preparation({
        status: "preparing",
        stage: "campaign_activation",
        selectedContactCount: null,
        progress: null,
        canResume: false,
        automaticResume: false,
      }),
    },
  };
  const options = { canManage: true, busy: false };
  const html = renderCampaignPreparation(state, options);
  assert.match(html, /aria-label="Campaign activation"/);
  assert.match(html, /Opening campaign…/);
  assert.match(html, /Preparing texting access for assigned volunteers/);
  assert.match(html, /checks progress automatically/);
  assert.match(html, /Check campaign now/);
  assert.doesNotMatch(html, /recipient|resume|Prompt|Telnyx/i);
  assert.match(
    renderCampaignPreparation(
      { ...state, preparationPollingPaused: true },
      options,
    ),
    /Campaign checks are paused/,
  );
  assert.match(
    renderCampaignPreparation(
      { ...state, preparationPollError: "Check the saved result." },
      options,
    ),
    /Campaign status could not be confirmed/,
  );
  assert.equal(
    renderCampaignPreparation(
      { campaign: { ...state.campaign, status: "active" } },
      options,
    ),
    "",
  );
});
