const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const PREFIX = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";

for (const width of [390, 1440])
  test(`recipient sends stay independent, ordered and outcome-bound at ${width}px`, async ({
    page,
  }, testInfo) => {
    const token = `e30.${Buffer.from(JSON.stringify({ sub: "feedback-volunteer" })).toString("base64url")}.test`;
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
    const errors = [],
      writes = [],
      reads = [],
      pending = new Map(),
      external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(BASE)) return route.continue();
      if (route.request().url().startsWith("https://fonts.googleapis.com/"))
        return route.fulfill({ contentType: "text/css", body: "" });
      external.push(route.request().url());
      return route.abort();
    });
    const workspace = {
      provider: "prompt",
      scopeKey: "coalition:org-1",
      manualOnly: true,
      status: "configured",
      canSend: true,
      capabilities: {
        manualQueue: true,
        queueStatus: true,
        canEnsureTexter: true,
      },
      blockedReasons: [],
    };
    const campaign = {
      campaignId: "campaign-one",
      name: "Community check-in",
      status: "active",
      canFetchQueue: true,
      isManual: true,
      templateText: "Hello neighbor. Reply STOP to opt out.",
    };
    const items = ["one", "two", "three"].map((key, index) => ({
      itemId: `item-${key}`,
      stream: index === 0 ? "opt_in" : "standard",
      state: "awaiting_confirmation",
      expiresAtMs: Date.now() + 600000,
      humanConfirmation: { recordId: `proof-${key}` },
      preview: {
        contactDisplayName: `Recipient ${key}`,
        contactPhone: `+1202555012${index + 4}`,
        message: campaign.templateText,
      },
    }));
    await page.route(`${BASE}/api/**`, async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname,
        suffix = path.slice(PREFIX.length);
      const respond = (body, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (!path.startsWith(PREFIX)) return respond({});
      (request.method() === "GET" ? reads : writes).push({
        path: suffix,
        body: request.postDataJSON(),
      });
      if (suffix === "/workspace") return respond({ ok: true, workspace });
      if (suffix === "/billing/summary")
        return respond({
          ok: true,
          billing: { canManageBilling: false, sendingBlocked: false },
        });
      if (suffix === "/campaigns/campaign-one")
        return respond({ ok: true, campaign });
      if (suffix === "/delivery-schedule")
        return respond({
          ok: true,
          schedule: {
            status: "verified",
            revision: 1,
            timeZone: "America/Denver",
            startTime: "08:00",
            endTime: "20:00",
          },
        });
      if (suffix === "/texter/ensure")
        return respond({ ok: true, texter: { state: "ready" } });
      if (suffix === "/campaigns/campaign-one/queue")
        return respond({
          ok: true,
          campaignId: campaign.campaignId,
          state: "held",
          items,
        });
      const match = /\/queue\/(item-\w+)\/confirm$/.exec(suffix);
      if (match) {
        const response = await new Promise((resolve) =>
          pending.set(match[1], resolve),
        );
        return respond(response.body, response.status);
      }
      return respond({ error: "unexpected_mock_endpoint" }, 404);
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${BASE}/organizations/org-1/texting/send/campaign-one`);
    await page
      .getByRole("button", { name: "Get next recipients", exact: true })
      .click();
    const first = page.getByRole("button", {
        name: "Send to Recipient one",
        exact: true,
      }),
      second = page.getByRole("button", {
        name: "Send to Recipient two",
        exact: true,
      }),
      third = page.getByRole("button", {
        name: "Send to Recipient three",
        exact: true,
      });
    await expect(first).toBeEnabled();
    await first.click();
    await expect(first).toHaveText("Sending…");
    await expect(first).toBeDisabled();
    await expect(second).toBeEnabled();
    await expect(third).toBeEnabled();
    expect(
      await page
        .locator("[data-texting-recipient]")
        .evaluateAll((rows) => rows.map((row) => row.dataset.textingRecipient)),
    ).toEqual(["item-two", "item-three", "item-one"]);
    await expect(
      page.locator(
        '[data-texting-recipient="item-two"] [data-workspace-action="queue-skip"]',
      ),
    ).toBeDisabled();
    const readCount = reads.length,
      writeCount = writes.length;
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      const owner = document.querySelector("[data-workspace-key]");
      for (const action of [
        "reload",
        "queue-load",
        "queue-status",
        "queue-skip",
      ]) {
        const button = document.createElement("button");
        button.dataset.workspaceAction = action;
        button.dataset.value = "item-two";
        owner.append(button);
        button.click();
        button.remove();
      }
    });
    await expect(first).toHaveText("Sending…");
    expect(reads.length).toBe(readCount);
    expect(writes.length).toBe(writeCount);
    await page.screenshot({
      path: testInfo.outputPath(`pending-${width}.png`),
      fullPage: true,
    });
    await second.click();
    await expect(second).toHaveText("Sending…");
    await expect(third).toBeEnabled();
    await expect.poll(() => pending.size).toBe(2);
    pending.get("item-two")({
      status: 200,
      body: { ok: true, result: { itemId: "item-two", state: "confirmed" } },
    });
    await expect(second).toHaveCount(0);
    await expect(first).toHaveText("Sending…");
    await page.getByRole("button", { name: "Sent (1)", exact: true }).click();
    await expect(page.locator('[data-texting-sent="item-two"]')).toBeVisible();
    await expect(page.locator('[data-texting-sent="item-one"]')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`sent-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "To send (2)", exact: true })
      .click();
    await expect(third).toBeEnabled();
    pending.get("item-one")({
      status: 200,
      body: {
        ok: true,
        result: {
          itemId: "item-one",
          state: "rejected_not_accepted",
          errorCode: "RECIPIENT_BLOCKED",
          nonAcceptanceVerified: true,
          resendPermitted: false,
        },
      },
    });
    await expect(
      page.getByText("Error code: RECIPIENT_BLOCKED", { exact: true }),
    ).toBeVisible();
    await expect(first).toBeDisabled();
    await expect(third).toBeEnabled();
    await third.click();
    await expect.poll(() => pending.has("item-three")).toBe(true);
    pending.get("item-three")({
      status: 504,
      body: { error: "prompt_send_outcome_unknown" },
    });
    await expect(
      page.getByText("Error code: texting_send_outcome_unknown", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(third).toBeDisabled();
    await expect(
      page.locator('[data-workspace-key] > [role="alert"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-texting-recipient="item-three"] [role="alert"]'),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Sent (1)", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("polis.texting.uncertain."),
        ),
      ),
    ).toEqual([
      "polis.texting.uncertain.feedback-volunteer:org-1:queue:campaign-one:item-three",
    ]);
    expect(
      writes
        .filter((write) => write.path.endsWith("/confirm"))
        .map((write) => write.body),
    ).toEqual(
      ["one", "two", "three"].map((key) => ({
        humanConfirmation: { recordId: `proof-${key}` },
      })),
    );
    expect(
      writes.filter((write) => write.path.endsWith("/queue")),
    ).toHaveLength(1);
    expect(writes.some((write) => write.path.endsWith("/skip"))).toBe(false);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`failed-${width}.png`),
      fullPage: true,
    });
  });
