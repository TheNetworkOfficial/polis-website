const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9015";

function jwt(claims) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function collectPageErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  return { consoleErrors, pageErrors };
}

async function expectNoHorizontalOverflow(page) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(Math.max(box.scrollWidth, box.bodyScrollWidth)).toBeLessThanOrEqual(
    box.clientWidth + 2,
  );
}

async function seedSessionAndPasskeySupport(page, now) {
  await page.addInitScript(
    ({ session, baseUrl }) => {
      localStorage.setItem(
        "sharedFeedSessionPersisted.v1",
        JSON.stringify(session),
      );
      sessionStorage.setItem("sharedFeedSession.v1", JSON.stringify(session));

      let runtimeConfig = null;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get() {
          return runtimeConfig;
        },
        set(value) {
          runtimeConfig = {
            ...(value || {}),
            apiBaseUrl: baseUrl,
            auth: {
              ...((value && value.auth) || {}),
              region: "us-west-2",
              clientId: "test-cognito-client",
              enablePasswordFlow: "true",
            },
          };
        },
      });

      window.PublicKeyCredential = function PublicKeyCredential() {};
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        value: {
          create: async ({ publicKey }) => {
            window.__polisPasskeyCreationOptions = {
              challenge: Array.from(new Uint8Array(publicKey.challenge)),
              userId: Array.from(new Uint8Array(publicKey.user.id)),
              rpId: publicKey.rp.id,
              excludedId: Array.from(
                new Uint8Array(publicKey.excludeCredentials[0].id),
              ),
            };
            const encoder = new TextEncoder();
            return {
              type: "public-key",
              rawId: new Uint8Array([1, 2, 3, 4]).buffer,
              response: {
                clientDataJSON: encoder.encode(
                  JSON.stringify({
                    type: "webauthn.create",
                    challenge: "registration-challenge",
                    origin: window.location.origin,
                    crossOrigin: false,
                  }),
                ).buffer,
                attestationObject: new Uint8Array([5, 6, 7, 8]).buffer,
                getTransports: () => ["internal"],
              },
              getClientExtensionResults: () => ({}),
            };
          },
        },
      });
    },
    {
      baseUrl: BASE_URL,
      session: {
        accessToken: jwt({
          sub: "qa-passkey-user",
          email: "passkey@polis.test",
          name: "Passkey User",
          username: "passkey-user",
          scope: "aws.cognito.signin.user.admin",
        }),
        idToken: jwt({
          sub: "qa-passkey-user",
          email: "passkey@polis.test",
          name: "Passkey User",
          username: "passkey-user",
        }),
        refreshToken: "qa-refresh",
        expiresAt: now + 3600000,
      },
    },
  );
}

async function routePasskeyApi(page, captures) {
  await page.route(`${BASE_URL}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/profile/me") {
      return json(route, {
        profile: {
          userId: "qa-passkey-user",
          displayName: "Passkey User",
          username: "passkey-user",
          email: "passkey@polis.test",
        },
      });
    }

    if (
      path === "/api/governance/passkeys/v1/registration/begin" &&
      request.method() === "POST"
    ) {
      captures.beginRequests.push({
        authorization: request.headers().authorization || "",
        body: JSON.parse(request.postData() || "{}"),
      });
      return json(route, {
        credentialCreationOptions: {
          rp: {
            id: "polisapp.io",
            name: "Polis",
          },
          user: {
            id: Buffer.from("qa-passkey-user").toString("base64url"),
            name: "passkey@polis.test",
            displayName: "Passkey User",
          },
          challenge: "registration-challenge",
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          timeout: 60000,
          authenticatorSelection: {
            userVerification: "required",
          },
          attestation: "none",
          excludeCredentials: [
            {
              type: "public-key",
              id: Buffer.from("existing-credential").toString("base64url"),
            },
          ],
        },
      });
    }

    if (
      path === "/api/governance/passkeys/v1/registration/complete" &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData() || "{}");
      const credential = JSON.parse(body.credential || "{}");
      captures.completeRequests.push({
        authorization: request.headers().authorization || "",
        credential,
      });
      return json(route, { registered: true });
    }

    captures.unhandled.push(`${request.method()} ${path}`);
    return json(route, {});
  });
}

test("account security exposes and completes Governance passkey setup", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = collectPageErrors(page);
  const captures = {
    beginRequests: [],
    completeRequests: [],
    unhandled: [],
  };

  await seedSessionAndPasskeySupport(page, Date.now());
  await routePasskeyApi(page, captures);

  await page.setViewportSize({ width: 1366, height: 920 });
  await page.goto(`${BASE_URL}/settings/account-security`);
  await expect(
    page.getByRole("heading", { name: "Sign in protection" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Governance account passkey" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Set up passkey" }).click();
  await expect(page).toHaveURL(
    /\/settings\/account-security\/governance-passkey$/u,
  );
  await expect(
    page.getByRole("heading", { name: "Account Passkey", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Set up your account passkey" }),
  ).toBeVisible();
  await expect(page.getByText("Passkeys available")).toBeVisible();

  await page.getByRole("button", { name: "Set up account passkey" }).click();
  await expect.poll(() => captures.beginRequests.length).toBe(1);
  await expect.poll(() => captures.completeRequests.length).toBe(1);

  expect(captures.beginRequests[0].authorization).toMatch(/^Bearer .+/u);
  expect(captures.beginRequests[0].body).toEqual({});
  expect(captures.completeRequests[0].authorization).toBe(
    captures.beginRequests[0].authorization,
  );
  expect(captures.completeRequests[0].credential).toEqual(
    expect.objectContaining({
      id: "AQIDBA",
      rawId: "AQIDBA",
      type: "public-key",
      response: expect.objectContaining({
        attestationObject: "BQYHCA",
        clientDataJSON: expect.any(String),
        transports: ["internal"],
      }),
    }),
  );

  const clientData = JSON.parse(
    Buffer.from(
      captures.completeRequests[0].credential.response.clientDataJSON,
      "base64url",
    ).toString("utf8"),
  );
  expect(clientData).toEqual(
    expect.objectContaining({
      type: "webauthn.create",
      challenge: "registration-challenge",
      crossOrigin: false,
    }),
  );
  const seenOptions = await page.evaluate(
    () => window.__polisPasskeyCreationOptions,
  );
  expect(seenOptions).toEqual({
    challenge: Array.from(Buffer.from("registration-challenge", "base64url")),
    userId: Array.from(Buffer.from("qa-passkey-user")),
    rpId: "polisapp.io",
    excludedId: Array.from(Buffer.from("existing-credential")),
  });
  await expect(
    page.getByText("Account passkey ready. You can now return"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add another account passkey" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "output/playwright/settings-governance-passkey-desktop.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${BASE_URL}/settings/account-security/governance-passkey`);
  await expect(
    page.getByRole("heading", { name: "Set up your account passkey" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: "output/playwright/settings-governance-passkey-mobile.png",
    fullPage: true,
  });

  expect(captures.unhandled).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
