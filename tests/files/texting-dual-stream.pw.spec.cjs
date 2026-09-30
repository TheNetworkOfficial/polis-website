const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const LEGACY = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";
const NEUTRAL = "/api/text-banking/workspaces/coalition%3Aorg-1";
const application = {
  legalEntityName: "Example Civic Team",
  entityType: "NON_PROFIT",
  consentMethod: "web_form",
  consentEvidenceUrl: "https://example.test/opt-in",
  fundraisingRequested: false,
  dba: "",
  country: "US",
  entityStreetAddress: "123 Example Street",
  entityCity: "Sampletown",
  entityState: "MT",
  entityZip: "59000",
  firstName: "Alex",
  lastName: "Morgan",
  email: "alex@example.test",
  phone: "2025550100",
  websiteAddress: "https://example.test",
  privacyPolicyUrl: "https://example.test/privacy",
  termsUrl: "https://example.test/terms",
  filingUrl: "https://example.test/filing",
  filingInstructions: "",
  areaCode1: "406",
  areaCode2: "",
  useCaseDescription:
    "Organization updates about local meetings and community participation.",
  consentFlow:
    "People sign up on our website using an unchecked box for SMS updates from this organization.",
  sampleMessage1:
    "Example Civic Team: meeting Saturday. Reply STOP to opt out.",
  sampleMessage2:
    "Example Civic Team: thanks for joining. Reply STOP to opt out.",
  sampleMessage3: "",
  authorityConfirmed: true,
};

async function setup(page, { enabled = true } = {}) {
  const token = `e30.${Buffer.from(JSON.stringify({ sub: "dual-admin", email: "admin@example.test" })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ baseUrl, token }) => {
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: token,
          idToken: token,
          expiresAt: Date.now() + 3600000,
        }),
      );
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
  let registration = null,
    mode = "single",
    revision = 1,
    approved = false;
  const writes = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const workspace = {
    provider: "prompt",
    manualOnly: true,
    scopeKey: "coalition:org-1",
    status: "configured",
    canSend: true,
    dualStreamEnabled: enabled,
    capabilities: {
      neutralWorkspaceApi: true,
      manageOptInTexting: true,
      manageBilling: true,
      manualQueue: true,
    },
  };
  const quote = {
    quoteId: "quote-one",
    amountMicros: 15000000,
    numberMonthlyMicros: 1000000,
    currency: "usd",
    priceVersion: "test-v1",
    termsVersion: "test-terms-v1",
    expiresAt: "2099-12-31T00:00:00Z",
    requiresPayment: false,
  };
  const registrationDto = () => ({
    ok: true,
    registration: registration && {
      ...registration,
      ...(approved
        ? {
            status: "approved",
            ready: true,
            reviewMessage: "Telnyx registration approved.",
          }
        : {}),
    },
    prefill: application,
    capabilities: {
      enabled,
      canSave: enabled && !approved,
      canQuote: enabled && !approved,
      canSubmit: enabled && Boolean(registration) && !approved,
    },
    quote: registration ? quote : null,
    authorizationId: "authorization-one",
  });
  await page.route(`${BASE}/api/**`, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET")
      writes.push({
        path,
        method: request.method(),
        body: request.postDataJSON(),
      });
    if (path.startsWith("/api/text-banking/prompt-intake/"))
      return respond({
        ok: true,
        intake: {
          intakeId: "registration",
          revision: 1,
          status: "approved",
          canSend: false,
          manualOnly: true,
          packet: { version: 1, ...application },
          campaignVerify: null,
        },
      });
    if (path.endsWith("/workspace"))
      return respond({
        ok: true,
        workspace: {
          ...workspace,
          ...(path.startsWith(NEUTRAL)
            ? { provider: "polis", contractVersion: 2 }
            : {}),
        },
      });
    if (path.endsWith("/delivery-schedule"))
      return respond({
        ok: true,
        canManage: true,
        schedule: {
          revision: 1,
          status: "verified",
          timeZone: "America/Denver",
          startTime: "08:00",
          endTime: "20:00",
        },
      });
    if (path === `${NEUTRAL}/settings`) {
      if (request.method() === "PATCH") {
        expect(request.postDataJSON().expectedRevision).toBe(revision);
        mode = request.postDataJSON().routingMode;
        revision++;
      }
      return respond({
        ok: true,
        settings: { revision, routingMode: mode, dualStreamEnabled: enabled },
      });
    }
    if (path === `${NEUTRAL}/opt-in-registration`) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        registration = {
          revision: (registration?.revision || 0) + 1,
          status: "ready_to_submit",
          application: { ...body.application, taxEin: undefined },
          einLast4: "0000",
          hasVerificationToken: true,
          verificationExpiresOn:
            body.verificationToken.expiresOn || "2099-12-31",
          ready: false,
        };
      }
      return respond(registrationDto());
    }
    if (path === `${NEUTRAL}/opt-in-registration/quote`)
      return respond({ ...registrationDto(), quote });
    if (path === `${NEUTRAL}/opt-in-registration/submit`) {
      registration = {
        ...registration,
        revision: registration.revision + 1,
        status: "submitted",
      };
      return respond(registrationDto());
    }
    if (path.endsWith("/billing/summary"))
      return respond({
        ok: true,
        billing: {
          currency: "usd",
          organizationName: "Example Civic Team",
          canManageBilling: true,
          availableMicros: 10000000,
          rateStatus: "verified",
          smsUpToTwoSegmentsMicros: 35000,
          smsAdditionalSegmentMicros: 15000,
          mmsMicros: 45000,
          optInRates: {
            rateStatus: "verified",
            smsSegmentMicros: 17500,
            mmsMicros: 35000,
          },
          sendingBlocked: false,
        },
      });
    if (path.endsWith("/billing/transactions"))
      return respond({ ok: true, transactions: [] });
    if (path.startsWith(`${LEGACY}/`) || path.startsWith(`${NEUTRAL}/`))
      return respond({ ok: true, items: [] });
    return respond({});
  });
  return {
    writes,
    errors,
    approve: () => {
      approved = true;
    },
  };
}

test("optional application stays in settings, discloses charges and can return to single stream", async ({
  page,
}, testInfo) => {
  const h = await setup(page);
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.goto(`${BASE}/organizations/org-1/texting/settings`);
  const card = page.locator("[data-opt-in-key]");
  await expect(
    card.getByRole("heading", { name: "Opt-in texting" }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Add opt-in texting", exact: true })
    .click();
  await expect(card.getByLabel("Legal organization name")).toHaveValue(
    application.legalEntityName,
  );
  await card
    .getByRole("combobox", { name: "Organization type", exact: true })
    .selectOption("PUBLIC_PROFIT");
  await card.getByLabel("Stock symbol", { exact: true }).fill("EXAMPLE");
  await card
    .getByRole("combobox", { name: "Stock exchange", exact: true })
    .selectOption("NASDAQ");
  await card.getByLabel("EIN", { exact: true }).fill("00-0000000");
  await card.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(card.getByLabel("How people opt in")).toHaveValue(
    application.consentFlow,
  );
  await card
    .getByRole("combobox", { name: "Opt-in method", exact: true })
    .selectOption("keyword");
  await expect(
    card.getByLabel("Opt-in keyword", { exact: true }),
  ).toBeVisible();
  await card
    .getByRole("combobox", { name: "Opt-in method", exact: true })
    .selectOption("verbal");
  await expect(
    card.getByLabel("Exact consent script", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByLabel("Opt-in evidence link", { exact: true }),
  ).toHaveCount(0);
  await card
    .getByRole("combobox", { name: "Opt-in method", exact: true })
    .selectOption("web_form");
  await card.getByLabel("We will request donations by text.").check();
  await card
    .getByLabel("Donation processor", { exact: true })
    .fill("Example Processor");
  await card
    .getByLabel("Donation processor verification link", { exact: true })
    .fill("https://example.test/processor");
  await card
    .getByLabel(
      "Our opt-in page and texting terms disclose that donations will be solicited.",
    )
    .check();
  await page.setViewportSize({ width: 390, height: 844 });
  await card.getByRole("button", { name: "Continue", exact: true }).click();
  await card
    .getByLabel("Verification token", { exact: true })
    .fill("fictional-secondary-token");
  await card.getByLabel("Token expiration").fill("2099-12-31");
  await card.getByRole("button", { name: "Check registration charge" }).click();
  await expect(card).toContainText("$15.00");
  await expect(card).toContainText("$1.00 per month");
  await expect(
    card.getByRole("button", { name: "Submit application", exact: true }),
  ).toBeDisabled();
  await card.getByLabel("I approve these setup and ongoing charges.").check();
  await card
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  await expect(card).toContainText("Application submitted");
  expect(h.writes.filter((x) => x.path.endsWith("/submit"))).toHaveLength(1);
  expect(
    h.writes.find(
      (x) => x.path.endsWith("/opt-in-registration") && x.body?.application,
    ).body.application,
  ).toMatchObject({
    entityType: "PUBLIC_PROFIT",
    stockSymbol: "EXAMPLE",
    stockExchange: "NASDAQ",
    consentMethod: "web_form",
    consentEvidenceUrl: "https://example.test/opt-in",
    fundraisingRequested: true,
    donationProcessor: "Example Processor",
    donationAccreditationUrl: "https://example.test/processor",
    fundraisingDisclosureConfirmed: true,
  });
  expect(h.writes.find((x) => x.path.endsWith("/submit")).body).toMatchObject({
    chargesAccepted: true,
    termsVersion: "test-terms-v1",
    quoteId: "quote-one",
    authorizationId: "authorization-one",
  });
  h.approve();
  await card
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Enable dual stream texting", exact: true })
    .click();
  await expect(card).toContainText("Dual stream texting enabled");
  await card
    .getByRole("button", {
      name: "Return to single stream texting",
      exact: true,
    })
    .click();
  await expect(card).toContainText("Single stream texting selected");
  await expect(page.locator(".texting-workspace")).not.toContainText(
    /Telnyx|Prompt(?:\.io)?/i,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("opt-in-settings-mobile.png"),
    fullPage: true,
  });
  expect(h.errors).toEqual([]);
});

test("disabled feature retains current registration and sending hours without an application action", async ({
  page,
}) => {
  const h = await setup(page, { enabled: false });
  await page.goto(`${BASE}/organizations/org-1/texting/settings`);
  await expect(
    page.getByRole("heading", { name: "Default sending hours" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add opt-in texting", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("[data-opt-in-key]")).toContainText(
    "Single stream texting",
  );
  expect(h.writes).toEqual([]);
  expect(h.errors).toEqual([]);
});

test("opt-in MMS loads protected previews and inbound attachments through local authenticated paths", async ({
  page,
}) => {
  const h = await setup(page),
    reads = [];
  const media = {
    mimeType: "image/png",
    dataBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ3sAAAAASUVORK5CYII=",
  };
  const campaign = {
    campaignId: "campaign-one",
    name: "Example update",
    status: "active",
    revision: 1,
    mediaId: "media-one",
    templateText: "Example: Update. Reply STOP to opt out.",
    canFetchQueue: true,
    assignedUserIds: ["dual-admin"],
    blockedReasons: [],
  };
  await page.route(`${BASE}/api/text-banking/**`, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const respond = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...body }),
      });
    if (path === `${NEUTRAL}/campaigns/campaign-one`)
      return respond({ campaign });
    if (path.endsWith("/campaigns/campaign-one/media/media-one/content")) {
      reads.push(path);
      return respond({ media });
    }
    if (path.endsWith("/texter/ensure"))
      return respond({ texter: { state: "ready" } });
    if (path.endsWith("/campaigns/campaign-one/queue"))
      return respond({
        state: "held",
        items: [
          {
            itemId: "oi_one",
            stream: "opt_in",
            state: "awaiting_confirmation",
            expiresAtMs: Date.now() + 60000,
            humanConfirmation: { recordId: "oi_one", token: "token" },
            preview: {
              contactDisplayName: "Example Recipient",
              contactPhone: "+12025550101",
              message: campaign.templateText,
              mediaId: "media-one",
              attachmentUrl: "https://untrusted.example.test/not-used.png",
            },
          },
        ],
      });
    if (path.endsWith("/conversations/oi_conversation"))
      return respond({
        conversation: {
          conversationId: "oi_conversation",
          campaignId: "campaign-one",
          stream: "opt_in",
          displayName: "Example Recipient",
          phone: "+12025550101",
          senderPhone: "+12025550100",
          canReply: false,
        },
        messages: [
          {
            messageId: "inbound-one",
            direction: "inbound",
            content: "Here is a photo",
            attachments: [
              {
                attachmentId: "0",
                url: "https://untrusted.example.test/not-used.png",
              },
            ],
          },
        ],
      });
    if (path.endsWith("/messages/inbound-one/attachments/0")) {
      reads.push(path);
      return respond({ media });
    }
    return route.fallback();
  });
  await page.route("https://untrusted.example.test/**", () => {
    throw new Error("Untrusted media URL fetched");
  });
  await page.goto(`${BASE}/organizations/org-1/texting/send/campaign-one`);
  await page.getByRole("button", { name: "Get my next messages" }).click();
  const preview = page.getByAltText("Final message attachment");
  await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(
    page.getByRole("button", { name: "Send to Example Recipient" }),
  ).toBeEnabled();
  await expect(page.locator(".texting-workspace")).toContainText("$0.0350");
  await page.goto(
    `${BASE}/organizations/org-1/texting/conversation/oi_conversation`,
  );
  await page.getByRole("button", { name: "View attachment" }).click();
  await expect(page.getByAltText("Message attachment")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  expect(reads).toContain(
    `${NEUTRAL}/conversations/oi_conversation/messages/inbound-one/attachments/0`,
  );
  expect(h.errors).toEqual([]);
});

test("texting status notification opens its organization settings", async ({
  page,
}) => {
  const h = await setup(page);
  await page.route(`${BASE}/api/me/notifications**`, async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        new URL(route.request().url()).pathname.endsWith("unread-count")
          ? { unreadCount: 1 }
          : {
              items: [
                {
                  notificationId: "texting-status",
                  kind: "texting",
                  title: "Opt-in texting approved",
                  body: "Review your texting setup.",
                  preview: { textSnippet: "Your application is approved." },
                  target: {
                    surfaceType: "texting_settings",
                    scopeKey: "coalition:org-1",
                    route: "/organizations/org-1/texting/settings",
                  },
                  createdAt: new Date().toISOString(),
                },
              ],
            },
      ),
    }),
  );
  await page.goto(`${BASE}/organizations/org-1/texting`);
  await page.evaluate(() => {
    history.pushState({}, "", "/profile/notifications");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  const notification = page.locator(
    '[data-action="profile-notification-open"][data-notification-id="texting-status"]',
  );
  await expect(notification).toContainText("Opt-in texting approved");
  await expect(notification).toContainText("Your application is approved.");
  await notification.click();
  await expect(page).toHaveURL(`${BASE}/organizations/org-1/texting/settings`);
  await expect(page.locator("[data-opt-in-key]")).toBeVisible();
  expect(h.errors).toEqual([]);
});
