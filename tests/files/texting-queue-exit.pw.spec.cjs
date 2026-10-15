const { test, expect } = require("@playwright/test");
const BASE = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9093";
const PREFIX = "/api/text-banking/prompt/scopes/coalition%3Aorg-1";

for (const exitEvent of ["pagehide", "hidden", "navigation"])
  test(`unused assignment exit is authenticated and session-bound: ${exitEvent}`, async ({
    page,
  }) => {
    const token = `e30.${Buffer.from(JSON.stringify({ sub: "exit-volunteer" })).toString("base64url")}.test`;
    await page.addInitScript(
      ({ token, base }) => {
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
              apiBaseUrl: base,
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
      { token, base: BASE },
    );
    const writes = [],
      errors = [];
    let queueSession;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(BASE)) return route.continue();
      if (route.request().url().startsWith("https://fonts.googleapis.com/"))
        return route.fulfill({ contentType: "text/css", body: "" });
      return route.abort();
    });
    await page.route(`${BASE}/api/**`, (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname,
        suffix = path.slice(PREFIX.length),
        body = request.postDataJSON();
      const respond = (value) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(value),
        });
      if (!path.startsWith(PREFIX)) return respond({ items: [] });
      if (request.method() !== "GET")
        writes.push({
          path: suffix,
          body,
          authorization: Boolean(request.headers().authorization),
        });
      if (suffix === "/workspace")
        return respond({
          ok: true,
          workspace: {
            provider: "prompt",
            scopeKey: "coalition:org-1",
            status: "configured",
            manualOnly: true,
            canSend: true,
            queueSession,
            capabilities: { manualQueue: true, queueRelease: true },
          },
        });
      if (suffix === "/billing/summary")
        return respond({
          ok: true,
          billing: { canManageBilling: false, sendingBlocked: false },
        });
      if (suffix === "/campaigns/campaign-one")
        return respond({
          ok: true,
          campaign: {
            campaignId: "campaign-one",
            name: "Example campaign",
            status: "active",
            canFetchQueue: true,
          },
        });
      if (suffix === "/campaigns/campaign-one/queue") {
        queueSession = {
          campaignId: "campaign-one",
          allocationId: "allocated-token",
          sessionId: body.sessionId,
          assignmentExpiresAtMs: Date.now() + 3600000,
          canReleaseUnused: true,
        };
        return respond({
          ok: true,
          campaignId: "campaign-one",
          state: "held",
          queueSession,
          items: [
            {
              itemId: "item-one",
              state: "awaiting_confirmation",
              expiresAtMs: Date.now() + 60000,
              humanConfirmation: { recordId: "receipt-one" },
              preview: {
                contactDisplayName: "Example recipient",
                contactPhone: "+12025550124",
                message: "Hello. Reply STOP to opt out.",
              },
            },
          ],
        });
      }
      if (suffix === "/campaigns/campaign-one/queue/release") {
        queueSession = { ...queueSession, canReleaseUnused: false };
        return respond({
          ok: true,
          release: {
            ...body,
            campaignId: "campaign-one",
            state: "released",
            returnedCount: 1,
            preservedCount: 0,
            releasedItemIds: ["item-one"],
          },
        });
      }
      return respond({ ok: true, items: [] });
    });
    await page.goto(`${BASE}/organizations/org-1/texting/send/campaign-one`);
    await page
      .getByRole("button", { name: "Get next recipients", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Send to Example recipient",
        exact: true,
      }),
    ).toBeEnabled();
    const initial = writes.find((write) => write.path.endsWith("/queue"));
    expect(initial.body.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    await page.evaluate((event) => {
      if (event === "pagehide") {
        window.dispatchEvent(new PageTransitionEvent("pagehide"));
        window.dispatchEvent(new PageTransitionEvent("pagehide"));
      } else if (event === "hidden") {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        history.pushState({}, "", "/feed");
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    }, exitEvent);
    await expect
      .poll(
        () => writes.filter((write) => write.path.endsWith("/release")).length,
      )
      .toBe(1);
    const release = writes.find((write) => write.path.endsWith("/release"));
    expect(release.authorization).toBe(true);
    expect(release.body).toEqual({
      allocationId: "allocated-token",
      sessionId: initial.body.sessionId,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      reason: "exit",
    });
    expect(
      writes.filter((write) => /\/confirm$|\/skip$/.test(write.path)),
    ).toHaveLength(0);
    if (exitEvent !== "navigation") {
      await expect(
        page.getByRole("button", {
          name: "Send to Example recipient",
          exact: true,
        }),
      ).toBeDisabled();
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => false,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(
        page.getByRole("button", { name: "Get next recipients", exact: true }),
      ).toBeVisible();
      expect(
        writes.filter((write) => write.path.endsWith("/queue")),
      ).toHaveLength(1);
    }
    expect(errors).toEqual([]);
  });
