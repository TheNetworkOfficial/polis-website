const { test, expect } = require("@playwright/test");

test("mission metadata and bounded lifecycle updates retain evidence and hide paused work controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const token = `e30.${btoa(JSON.stringify({ sub: "manager", name: "Alex Rivera" }))}.test`;
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
          apiBaseUrl: "http://127.0.0.1:9000",
          auth: {
            ...value.auth,
            region: "us-west-2",
            clientId: "test",
            enablePasswordFlow: "true",
          },
        };
      },
    });
  });
  let mission = {
    missionId: "mission-1",
    scopeType: "coalition",
    scopeId: "org-1",
    title: "Prepare walk cards",
    description: "Keep accepted evidence",
    status: "active",
    priority: "normal",
    mutationRevision: 3,
    jobs: [
      {
        missionId: "mission-1",
        jobId: "job-1",
        title: "Deliver cards",
        status: "active",
        targetMode: "user",
        assigneeUserId: "manager",
        artifacts: [{ artifactId: "accepted", fileName: "Approved plan.pdf" }],
      },
    ],
  };
  const mutations = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const reply = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/profile/me")
      return reply({
        profile: {
          userId: "manager",
          displayName: "Alex Rivera",
          username: "alex",
        },
      });
    if (path === "/api/missions/mission-1" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      mutations.push(body);
      expect(body.expectedRevision).toBe(mission.mutationRevision);
      if (body.status && !mission.lifecycleTransition)
        mission = {
          ...mission,
          status: "paused",
          mutationRevision: mission.mutationRevision + 1,
          lifecycleTransition: {
            id: body.lifecycleRequestId,
            target: body.status,
            reason: body.reason,
          },
        };
      else if (body.status)
        mission = {
          ...mission,
          status: body.status,
          mutationRevision: mission.mutationRevision + 1,
          lifecycleTransition: null,
        };
      else
        mission = {
          ...mission,
          ...body,
          mutationRevision: mission.mutationRevision + 1,
        };
      return reply({ mission });
    }
    if (path === "/api/missions/mission-1")
      return reply({
        mission,
        viewer: {
          admin: true,
          canManage: true,
          canAssign: true,
          canApprove: true,
        },
        events: [],
      });
    return reply({ items: [] });
  });
  await page.goto("/missions/mission-1");
  await page.getByText("Manage mission", { exact: true }).click();
  await page
    .locator('[data-route-form="mission-edit"] input[name="title"]')
    .fill("Prepare neighborhood walk cards");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Prepare neighborhood walk cards",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("Manage mission", { exact: true }).click();
  await page
    .locator('[data-route-form="mission-lifecycle"] select[name="status"]')
    .selectOption("paused");
  await page
    .locator('[data-route-form="mission-lifecycle"] textarea[name="reason"]')
    .fill("Wait for approved schedule");
  await page
    .getByRole("button", { name: "Update status", exact: true })
    .click();
  await expect.poll(() => mutations.length).toBe(3);
  expect(mutations[2].lifecycleRequestId).toBe(mutations[1].lifecycleRequestId);
  expect(mission.description).toBe("Keep accepted evidence");
  expect(mission.jobs[0].artifacts[0].artifactId).toBe("accepted");
  await expect(
    page.getByRole("button", { name: "Complete", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
