const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const PREFIX = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";

test("redesigned workspace uses explicit single-recipient sends, recorded replies and opt-outs", async ({
  page,
}, testInfo) => {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "workspace-admin", email: "admin@example.test" })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ baseUrl, token }) => {
      const session = {
        accessToken: token,
        idToken: token,
        expiresAt: Date.now() + 3600000,
      };
      sessionStorage.setItem("sharedFeedSession.v1", JSON.stringify(session));
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: baseUrl,
            auth: {
              ...value.auth,
              region: "us-west-2",
              clientId: "test",
              enablePasswordFlow: "true",
            },
          };
        },
      });
    },
    { baseUrl: BASE, token },
  );
  const writes = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const workspace = {
    provider: "prompt",
    scopeKey: "coalition:org-1",
    manualOnly: true,
    status: "configured",
    canSend: true,
    sendingMode: "accepted",
    blockedReasons: [],
    capabilities: {
      uploadImports: true,
      createCampaigns: true,
      manualQueue: true,
    },
    limits: { maxImportRows: 1000000, maxUploadBytes: 5368709120 },
  };
  const billing = {
    organizationName: "Example Civic Team",
    currency: "usd",
    availableMicros: 1000000,
    reservedMicros: 0,
    settledMicros: 0,
    unfundedMicros: 0,
    rateStatus: "verified",
    smsUpToTwoSegmentsMicros: 35000,
    smsAdditionalSegmentMicros: 15000,
    mmsMicros: 45000,
    sendingBlocked: false,
    canManageBilling: true,
  };
  const campaign = {
    campaignId: "campaign-one",
    name: "Saturday meetup",
    status: "active",
    isManual: true,
    revision: 1,
    audienceId: "audience-one",
    templateText:
      "Example Civic Team: join us Saturday. Reply STOP to opt out.",
    mediaId: null,
    budgetMicros: 1000000,
    reservedMicros: 0,
    settledMicros: 0,
    assignedUserIds: ["workspace-admin"],
    blockedReasons: [],
    canFetchQueue: true,
    canActivate: false,
    deliveryNotBeforeMs: Date.now() - 60000,
    deliveryBeforeMs: Date.now() + 86400000,
  };
  const conversation = {
    conversationId: "conversation-one",
    campaignId: campaign.campaignId,
    displayName: "Example Recipient",
    phone: "+12025550124",
    status: "open",
    suppressed: false,
    canReply: true,
    canSuppress: true,
    replyState: "available",
    lastMessageAtMs: Date.now(),
  };
  const messages = [
    {
      messageId: "message-one",
      direction: "inbound",
      content: "What time is the meetup?",
      media: [],
      status: "received",
      createdAtMs: Date.now(),
    },
  ];
  const queued = ["one", "two"].map((name, index) => ({
    itemId: `item-${name}`,
    state: "awaiting_confirmation",
    expiresAtMs: Date.now() + 60000,
    blockedReasons: [],
    humanConfirmation: { recordId: `receipt-${name}` },
    preview: {
      contactPhone: `+1202555012${index + 4}`,
      contactDisplayName: `Recipient ${name}`,
      message: campaign.templateText,
      attachmentUrl: null,
    },
  }));
  await page.route(`${BASE}/api/**`, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const respond = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (!path.startsWith(PREFIX)) return respond({});
    const suffix = path.slice(PREFIX.length);
    if (request.method() !== "GET")
      writes.push({ path: suffix, body: request.postDataJSON() });
    if (suffix === "/workspace") return respond({ ok: true, workspace });
    if (suffix === "/billing/summary") return respond({ ok: true, billing });
    if (suffix === "/campaigns")
      return respond({ ok: true, items: [campaign] });
    if (suffix === "/campaigns/campaign-one")
      return respond({ ok: true, campaign });
    if (suffix === "/audiences") return respond({ ok: true, audiences: [] });
    if (suffix === "/campaigns/campaign-one/queue")
      return respond({
        ok: true,
        campaignId: campaign.campaignId,
        state: "held",
        items: queued,
        blockedReasons: [],
      });
    if (suffix === "/campaigns/campaign-one/queue/item-one/confirm")
      return respond({
        ok: true,
        result: { itemId: "item-one", state: "confirmed" },
      });
    if (suffix === "/conversations")
      return respond({ ok: true, items: [conversation] });
    if (suffix === "/conversations/conversation-one")
      return respond({ ok: true, conversation, messages });
    if (suffix === "/conversations/conversation-one/reply") {
      const data = request.postDataJSON();
      messages.push({
        messageId: "message-two",
        direction: "outbound",
        content: data.content,
        media: [],
        status: "accepted",
        createdAtMs: Date.now(),
      });
      return respond({
        ok: true,
        result: { actionId: data.actionId, state: "accepted" },
      });
    }
    if (suffix === "/conversations/conversation-one/suppress") {
      conversation.suppressed = true;
      conversation.canReply = false;
      conversation.providerSyncState = "synced";
      return respond({
        ok: true,
        result: { suppressed: true, providerSyncState: "synced" },
      });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "unexpected_mock_endpoint" }),
    });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${BASE}/organizations/org-1/texting`);
  await expect(
    page.getByRole("heading", { name: "Good conversations start here." }),
  ).toBeVisible();
  await expect(page.locator(".pt-brand img")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-home.png"),
    fullPage: true,
  });
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saturday meetup", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start texting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "One person. One conversation." }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Get my next messages" }).click();
  await expect(
    page.getByRole("button", { name: "Send to Recipient one" }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("workspace-manual-send.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Send to Recipient one" }).click();
  await expect(
    page.getByRole("button", { name: "Send to Recipient two" }),
  ).toBeVisible();
  expect(writes.filter((x) => x.path.endsWith("/confirm"))).toHaveLength(1);
  expect(writes.find((x) => x.path.endsWith("/confirm")).body).toEqual({
    humanConfirmation: { recordId: "receipt-one" },
  });
  await page.getByRole("button", { name: "Open inbox", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByText("What time is the meetup?", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Reply", { exact: true })
    .fill("10 AM. Hope to see you there.");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(
    page.getByText("10 AM. Hope to see you there.", { exact: true }),
  ).toBeVisible();
  expect(writes.filter((x) => x.path.endsWith("/reply"))).toHaveLength(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Record opt-out", exact: true })
    .click();
  await expect(
    page.getByText("This person opted out", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send reply", exact: true }),
  ).toHaveCount(0);
  expect(writes.filter((x) => x.path.endsWith("/suppress"))).toHaveLength(1);
  expect(errors).toEqual([]);
});
