const { test, expect } = require("@playwright/test");
const {
  BASE_URL,
  COALITION_PATH,
  mockAdministrationWorkspace,
} = require("./fixtures/administration-workspace.cjs");

const publicOrganization = {
  coalitionId: "cedar-valley",
  name: "Cedar Valley Coalition",
  orgKind: "coalition",
  memberCount: 12,
};
const privateOrganization = {
  coalitionId: "river-county",
  name: "River County Team",
  orgKind: "county_party",
};
const application = {
  fullName: "Alex Morgan",
  email: "alex@example.test",
  reason: "Help with community events",
  answers: [{ questionId: "availability", value: "Weekends" }],
};
const form = (organization, formVersion = 1) => ({
  organization,
  formVersion,
  questions: [
    {
      id: "availability",
      label:
        formVersion === 1 ? "When can you help?" : "Which days can you help?",
      required: true,
    },
  ],
  requestStatus: null,
});
const json = (route, body, status = 200) =>
  route.fulfill({ json: body, status });

test("public and private applicants submit the versioned application in the browser", async ({
  page,
}) => {
  await mockAdministrationWorkspace(page);
  const writes = [];
  let version = 1;
  await page.route("**/api/organizations/join-directory*", (route) =>
    json(
      route,
      new URL(route.request().url()).searchParams.has("cursor")
        ? {
            items: [
              {
                ...publicOrganization,
                coalitionId: "second",
                name: "Second Organization",
              },
            ],
          }
        : { items: [publicOrganization], nextCursor: "second page" },
    ),
  );
  await page.route(
    "**/api/coalitions/cedar-valley/join-application?*",
    (route) => json(route, form(publicOrganization, version)),
  );
  await page.route("**/api/organizations/join-code", (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ code: "PRIVATECODE" });
    expect(new URL(route.request().url()).search).toBe("");
    return json(route, form(privateOrganization));
  });
  await page.route(
    /\/api\/coalitions\/(cedar-valley|river-county)\/join$/u,
    (route) => {
      expect(route.request().method()).toBe("POST");
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) {
        version = 2;
        return json(route, { error: "join_application_form_changed" }, 409);
      }
      return json(route, { status: "pending" }, 202);
    },
  );

  await page.goto(`${BASE_URL}/coalitions/join`);
  await expect(
    page.getByRole("heading", { name: "Join an organization" }),
  ).toBeVisible();
  await expect(page.getByText("12 members", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByRole("button", { name: "Second Organization", exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cedar Valley Coalition", exact: false })
    .click();
  await page.getByLabel("Full name").fill(application.fullName);
  await page.getByLabel("Email", { exact: true }).fill(application.email);
  await page.getByLabel("Why do you want to join?").fill(application.reason);
  await page.getByLabel("When can you help?").fill("Weekends");
  await expect(
    page.getByRole("link", { name: "Privacy Policy", exact: true }).first(),
  ).toHaveAttribute(
    "href",
    "/privacy-policy#organization-membership-applications",
  );
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.getByText("The organization updated its form.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue(application.fullName);
  await expect(page.getByLabel("Which days can you help?")).toHaveValue("");
  await page.getByLabel("Which days can you help?").fill("Weekends");
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.getByText("Your application is awaiting review."),
  ).toBeVisible();
  expect(writes).toEqual([
    { ...application, source: "directory", formVersion: 1 },
    { ...application, source: "directory", formVersion: 2 },
  ]);

  await page.getByRole("button", { name: "Back to organizations" }).click();
  await page.getByLabel("Organization code").fill("PRIVATECODE");
  await page.getByRole("button", { name: "Find organization" }).click();
  await expect(
    page.getByRole("heading", { name: "River County Team" }),
  ).toBeVisible();
  await page.getByLabel("Full name").fill(application.fullName);
  await page.getByLabel("Email", { exact: true }).fill(application.email);
  await page.getByLabel("Why do you want to join?").fill(application.reason);
  await page.getByLabel("When can you help?").fill("Weekends");
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.getByText("Your application is awaiting review."),
  ).toBeVisible();
  expect(writes[2]).toEqual({
    ...application,
    source: "code",
    code: "PRIVATECODE",
    formVersion: 1,
  });
  expect(page.url()).not.toContain("PRIVATECODE");
});

test("an authorized reviewer sees answers and decisions bind the current application", async ({
  page,
}) => {
  await mockAdministrationWorkspace(page);
  let id = "application-one";
  const writes = [];
  await page.route("**/api/coalitions/cedar-valley/join_requests?*", (route) =>
    json(route, {
      items: id
        ? [
            {
              userId: "applicant",
              displayName: "Alex Applicant",
              status: "pending",
              applicationId: id,
              application: {
                ...application,
                formVersion: 1,
                answers: [
                  { ...application.answers[0], label: "When can you help?" },
                ],
              },
            },
          ]
        : [],
    }),
  );
  await page.route(
    "**/api/coalitions/cedar-valley/join_requests/applicant/approve",
    (route) => {
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) {
        id = "application-two";
        return json(route, { error: "join_application_state_changed" }, 409);
      }
      id = "";
      return json(route, { ok: true });
    },
  );
  await page.goto(`${BASE_URL}${COALITION_PATH}/members`);
  await page.getByRole("tab", { name: "Join requests", exact: false }).click();
  await page.getByText("View application", { exact: true }).click();
  await expect(
    page.getByText(application.email, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Weekends", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByText("The application changed.", { exact: false }),
  ).toBeVisible();
  const updated = page
    .locator('[data-application-id="application-two"]')
    .getByText("Approve", { exact: true });
  await expect(updated).toBeVisible();
  await updated.click();
  await expect(page.getByText("Join request approved.")).toBeVisible();
  expect(writes).toEqual([
    { applicationId: "application-one" },
    { applicationId: "application-two" },
  ]);
});

test("ordinary members do not see application answers", async ({ page }) => {
  await mockAdministrationWorkspace(page, { role: "member" });
  await page.route("**/api/coalitions/cedar-valley/join_requests?*", (route) =>
    json(route, { error: "forbidden" }, 403),
  );
  await page.goto(`${BASE_URL}${COALITION_PATH}/members`);
  await page.getByRole("tab", { name: "Join requests", exact: false }).click();
  await expect(
    page.getByText("Join requests are visible to authorized reviewers."),
  ).toBeVisible();
  await expect(page.getByText("View application")).toHaveCount(0);
});
