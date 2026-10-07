const { test, expect } = require("@playwright/test");
const { mockBook, BASE, PROMPT } = require("./contact-book-fixture.cjs");
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvV0AAAAASUVORK5CYII=";
const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ ok: status < 400, ...body }),
  });
async function setup(page) {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.fallback()
      : route.abort(),
  );
  const fixture = await mockBook(page);
  await page.route(`**${PROMPT}/workspace`, (route) =>
    json(route, {
      workspace: {
        provider: "prompt",
        scopeKey: "coalition:org-1",
        manualOnly: true,
        status: "configured",
        canSend: true,
        capabilities: {
          createCampaigns: true,
          manageBilling: true,
          manualQueue: true,
          canPrepareProviderMedia: true,
          readReporting: true,
        },
      },
    }),
  );
  return fixture;
}
const campaign = {
  campaignId: "campaign-one",
  revision: 4,
  name: "Example campaign",
  status: "prepared",
  templateText: "Example Civic Team: hello. Reply STOP to opt out.",
  assignedUserIds: [],
  blockedReasons: [],
  budgetMicros: 1000000,
};

test("prepared attachment gets explicit preparation and fresh campaign readiness at desktop and mobile", async ({
  page,
}, info) => {
  const fixture = await setup(page),
    writes = [];
  let ready = false;
  await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) =>
    json(route, {
      campaign: {
        ...campaign,
        mediaId: "image-one",
        mediaReady: ready,
        canActivate: ready,
      },
    }),
  );
  await page.route(`**${PROMPT}/media/image-one/content`, (route) =>
    json(route, {
      media: {
        mediaId: "image-one",
        providerReady: ready,
        state: ready ? "provider_verified" : "local_ready",
        mimeType: "image/png",
        dataBase64: png,
      },
    }),
  );
  await page.route(`**${PROMPT}/media/image-one/provider-sync`, (route) => {
    writes.push(route.request().postDataJSON());
    ready = true;
    return json(route, {
      media: {
        mediaId: "image-one",
        providerReady: true,
        state: "provider_verified",
      },
    });
  });
  await page.goto(`${BASE}/organizations/org-1/texting/campaigns/campaign-one`);
  await expect(
    page.getByRole("heading", { name: "Attachment needs preparation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open campaign", exact: true }),
  ).toHaveCount(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: info.outputPath(`attachment-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Prepare attachment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Attachment ready", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open campaign", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([{}]);
  expect(fixture.calls.filter((c) => c.method !== "GET")).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("expired preview refresh keeps the held recipient and never confirms a message", async ({
  page,
}, info) => {
  const fixture = await setup(page),
    queueCalls = [];
  await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) =>
    json(route, {
      campaign: { ...campaign, status: "active", canFetchQueue: true },
    }),
  );
  await page.route(`**${PROMPT}/campaigns/campaign-one/queue`, (route) => {
    queueCalls.push(route.request().postDataJSON());
    return json(route, {
      state: "held",
      items: [
        {
          itemId: "same-held-recipient",
          state: "awaiting_confirmation",
          blockedReasons: [],
          humanConfirmation: {
            recordId: queueCalls.length === 1 ? "old-proof" : "renewed-proof",
          },
          expiresAtMs: Date.now() + (queueCalls.length === 1 ? -1 : 60000),
          preview: {
            contactDisplayName: "Example Recipient",
            contactPhone: "+12025550124",
            message: campaign.templateText,
          },
        },
      ],
    });
  });
  await page.goto(`${BASE}/organizations/org-1/texting/send/campaign-one`);
  await page
    .getByRole("button", { name: "Get my next messages", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Send to Example Recipient",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Refresh message previews", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: info.outputPath("expired-preview-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Refresh message previews", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Send to Example Recipient",
      exact: true,
    }),
  ).toBeEnabled();
  expect(queueCalls).toEqual([{}, {}]);
  expect(fixture.calls.filter((c) => c.method !== "GET")).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("archived saved queue continues with its exact allocation and permits only Skip", async ({
  page,
}) => {
  const fixture = await setup(page),
    calls = [];
  const allocationId = "00000000-0000-4000-8000-000000000001";
  let reads = 0;
  await page.route(`**${PROMPT}/campaigns/campaign-one`, (route) =>
    json(route, {
      campaign: {
        ...campaign,
        status: "archived",
        canFetchQueue: true,
        queueRecoveryRequired: true,
      },
    }),
  );
  await page.route(`**${PROMPT}/campaigns/campaign-one/queue`, (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    reads++;
    expect(body).toEqual(reads === 1 ? {} : { allocationId });
    return json(
      route,
      reads < 3
        ? {
            state: "preparing",
            preparationKind: "queue_materialization",
            allocationId,
            retryAfterMs: 0,
            items: [],
          }
        : {
            state: "held",
            items: [
              {
                itemId: "held-one",
                state: "blocked",
                canSkip: true,
                blockedReasons: ["prompt_campaign_archived"],
                preview: {
                  contactDisplayName: "Example Recipient",
                  contactPhone: "+12025550124",
                  message: campaign.templateText,
                },
              },
            ],
          },
    );
  });
  await page.route(
    `**${PROMPT}/campaigns/campaign-one/queue/held-one/skip`,
    (route) =>
      json(route, { result: { state: "accepted", itemId: "held-one" } }),
  );
  await page.goto(`${BASE}/organizations/org-1/texting/send/campaign-one`);
  await page
    .getByRole("button", { name: "Review held recipients", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Skip recipient", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: /Send to/ })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Skip recipient", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Held recipients reviewed",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Get more messages", exact: true }),
  ).toHaveCount(0);
  expect(calls).toHaveLength(3);
  expect(fixture.calls.filter((c) => c.method !== "GET")).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

for (const failedRead of [null, "workspace", "billing/summary", "conversation"])
  for (const proven of failedRead ? [true] : [true, false])
    test(`reply rejection ${proven ? "proves no attempt and restores draft" : "without proof preserves the hold"}${failedRead ? ` after failed ${failedRead} read` : ""}`, async ({
      page,
    }, info) => {
      const fixture = await setup(page),
        replies = [],
        acknowledgements = [];
      let readFails = Boolean(failedRead);
      await page.route(`**${PROMPT}/conversations/conversation-one`, (route) =>
        json(route, {
          conversation: {
            conversationId: "conversation-one",
            campaignId: "campaign-one",
            phone: "+12025550124",
            displayName: "Example Recipient",
            canReply: true,
            replyState: "available",
            status: "active",
            suppressed: false,
          },
          messages: [
            {
              messageId: "inbound-one",
              direction: "inbound",
              content: "Please tell me more.",
              status: "received",
            },
          ],
          readToken: "visible-reply-page",
        }),
      );
      await page.route(
        `**${PROMPT}/conversations/conversation-one/read`,
        (route) => {
          acknowledgements.push(route.request().postDataJSON());
          return json(route, { unreadReplies: 0 });
        },
      );
      if (failedRead)
        await page.route(
          `**${PROMPT}/${failedRead === "conversation" ? "conversations/conversation-one" : failedRead}`,
          (route) =>
            replies.length && readFails
              ? json(route, { error: "read_temporarily_unavailable" }, 503)
              : route.fallback(),
        );
      await page.route(
        `**${PROMPT}/conversations/conversation-one/reply`,
        (route) => {
          const body = route.request().postDataJSON();
          replies.push(body);
          return json(
            route,
            {
              error: "prompt_reply_not_permitted",
              ...(proven
                ? { sendOutcome: "not_attempted", actionId: body.actionId }
                : {}),
            },
            409,
          );
        },
      );
      await page.goto(
        `${BASE}/organizations/org-1/texting/conversation/conversation-one`,
      );
      await page
        .getByLabel("Reply", { exact: true })
        .fill("Here is the requested information.");
      await page
        .getByRole("button", { name: "Send reply", exact: true })
        .click();
      if (proven) {
        await expect(
          page.getByText(
            "Reply was not sent. Review the current status before trying again.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("textbox", { name: "Reply", exact: true }),
        ).toHaveValue("Here is the requested information.");
        if (failedRead) {
          await expect(
            page.getByText("Check reply eligibility", { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "Send reply", exact: true }),
          ).toBeDisabled();
          readFails = false;
          await page
            .getByRole("button", { name: "Refresh", exact: true })
            .click();
        }
        await expect(
          page.getByRole("button", { name: "Send reply", exact: true }),
        ).toBeEnabled();
      } else {
        await expect(
          page.getByText("Reply needs review", { exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByText("Reply needs review", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Send reply", exact: true }),
        ).toHaveCount(0);
      }
      await page.setViewportSize({ width: 390, height: 900 });
      await page.screenshot({
        path: info.outputPath(
          `reply-${proven}-${failedRead?.replace("/", "-") || "ready"}-mobile.png`,
        ),
        fullPage: true,
      });
      expect(replies).toHaveLength(1);
      expect(acknowledgements.length).toBeGreaterThan(0);
      expect(
        acknowledgements.every(
          (body) => body.readToken === "visible-reply-page",
        ),
      ).toBe(true);
      expect(fixture.errors).toEqual([]);
    });
