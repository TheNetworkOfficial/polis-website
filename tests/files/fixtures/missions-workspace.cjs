const samples = require("./missions-workspace-data.json");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9000";
const COALITION_ID = "cedar-valley";
const COALITION_PATH = `/coalitions/${COALITION_ID}`;
const FIXED_TIME = new Date("2026-10-26T18:00:00Z").getTime();
const clone = (value) => JSON.parse(JSON.stringify(value));

/** The approved visual data, expressed using the existing mission API contract. */
function missionRecords() {
  return samples.missions.map((sample) => {
    const owner = samples.people.find(
      (person) => person.id === sample.assigneeId,
    );
    const status =
      sample.status === "changes" ? "needs_changes" : sample.status;
    const successConditions = sample.steps.map((step) => ({
      type: "checklist",
      label: step.label,
      completed: step.done,
      required: true,
      target: 1,
      current: Number(step.done),
    }));
    if (sample.requiresReview)
      successConditions.push({
        type: "required_approval",
        label: "Review before completion",
        required: true,
        completed: status === "completed",
      });
    const events = samples.events
      .filter((event) => event.missionId === sample.id)
      .map((event, index) => ({
        eventId: event.id,
        type: event.action.includes("submitted")
          ? "job_submitted"
          : "mission_updated",
        actorUserId:
          samples.people.find((person) => person.name === event.actor)?.id ||
          "alex",
        actorDisplayName: event.actor,
        createdAt: FIXED_TIME - (18 + index * 7) * 60000,
        details: { message: event.action, actorDisplayName: event.actor },
      }));
    const artifacts =
      sample.id === "welcome-guide"
        ? [
            {
              artifactId: "welcome-guide-pdf",
              jobId: `${sample.id}-lead`,
              fileName: "welcome-guide.pdf",
              contentType: "application/pdf",
              sizeBytes: 24192,
              createdAt: FIXED_TIME - 22 * 60000,
            },
          ]
        : [];
    return {
      missionId: sample.id,
      scopeType: "coalition",
      scopeId: COALITION_ID,
      scopeName: "Cedar Valley Coalition",
      projectName: sample.project,
      title: sample.title,
      description: sample.description,
      status: sample.status === "completed" ? "completed" : "active",
      priority: sample.priority,
      leadUserId: sample.leadId,
      mutationRevision: 3,
      dueAt: sample.dueDate,
      createdAt: FIXED_TIME - 3 * 86400000,
      updatedAt: FIXED_TIME - 60000,
      recentEvents: events,
      jobs: [
        {
          missionId: sample.id,
          jobId: `${sample.id}-lead`,
          title: sample.title,
          description: sample.description,
          status,
          priority: sample.priority,
          targetType: sample.claimableRole ? "role" : "user",
          targetMode: sample.claimableRole ? "role_claim" : "user",
          targetRoleKey: sample.claimableRole ? "volunteer" : "",
          targetRoleLabel: sample.claimableRole || "",
          assigneeUserId: sample.assigneeId || "",
          assigneeDisplayName: owner?.name || "",
          assigneeUsername: owner?.handle || "",
          dueAt: sample.dueDate,
          startConditions: sample.dependencies.map((label) => ({
            type: "job_completed",
            jobId: "parent-task",
            label,
          })),
          successConditions,
          artifactCount: artifacts.length,
          artifacts,
          note: sample.notes,
          blocker: sample.blocker,
          createdAt: FIXED_TIME - 3 * 86400000,
          updatedAt: FIXED_TIME - 60000,
          ...(status === "submitted"
            ? { submittedAt: FIXED_TIME - 18 * 60000 }
            : {}),
        },
      ],
    };
  });
}

function templateRecords() {
  return samples.templates.map((template) => ({
    templateId: template.id,
    scopeType: "coalition",
    scopeId: COALITION_ID,
    title: template.title,
    description: template.description,
    presetKey: "general",
    category: template.category,
    version: template.version,
    versions: [{ version: template.version, createdAt: FIXED_TIME - 86400000 }],
    config: {
      presetKey: "general",
      priority: "normal",
      targetMode: "role_claim",
      assignee: "volunteer",
      target: { type: "role", mode: "role_claim", roleKey: "volunteer" },
      deadlineMode: "indefinite",
      dueHours: "",
      timeoutPolicy: "none",
      timeoutHours: "",
      successConditions: template.steps.map((label) => ({
        type: "checklist",
        label,
        required: true,
        completed: false,
      })),
    },
  }));
}

function detailEventsFor(missionId) {
  const sample = samples.missions.find((mission) => mission.id === missionId);
  return (sample?.activity || []).map((event, index) => ({
    eventId: `${missionId}-detail-${index}`,
    type: "mission_updated",
    actorUserId:
      samples.people.find((person) => person.name === event.actor)?.id ||
      "alex",
    actorDisplayName: event.actor,
    createdAt: FIXED_TIME - (18 + index * 4) * 60000,
    details: { message: event.action, actorDisplayName: event.actor },
  }));
}

async function mockMissionsWorkspace(
  page,
  { role = "admin", missionDelay = 0, theme = "light" } = {},
) {
  const admin = role === "admin";
  const reviewer = role === "reviewer";
  const canCreate = admin;
  const canApprove = admin || reviewer;
  const managed = admin || reviewer;
  const data = {
    missions: missionRecords(),
    templates: templateRecords(),
    requests: [],
    writes: [],
    errors: [],
    externalRequests: [],
  };
  const coalition = {
    coalitionId: COALITION_ID,
    name: "Cedar Valley Coalition",
    description: "A shared workspace for neighborhood volunteers.",
    coalitionType: "simple",
    primaryContactName: "Alex Morgan",
    email: "cedar@example.test",
  };
  const membership = {
    roleKey: admin ? "admin" : "volunteer",
    status: "active",
    permissions: reviewer
      ? ["missions_view", "missions_approve"]
      : ["missions_view"],
  };
  const roles = [
    { roleKey: "admin", label: "Admin", enabled: true, system: true },
    { roleKey: "volunteer", label: "Volunteer", enabled: true, system: true },
    { roleKey: "member", label: "Member", enabled: true, system: true },
  ];
  await page.clock.setFixedTime(FIXED_TIME);
  await page.addInitScript(
    ({ baseUrl, actorRole, fixedTime, themeMode }) => {
      const token = `e30.${btoa(JSON.stringify({ sub: "alex", name: "Alex Morgan", email: "alex@example.test" }))}.test`;
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: token,
          idToken: token,
          expiresAt: fixedTime + 3600000,
        }),
      );
      if (!localStorage.getItem("prefs.themeMode"))
        localStorage.setItem("prefs.themeMode", themeMode);
      window.__MISSION_TEST_ROLE__ = actorRole;
      window.__LEGACY_MISSION_PANELS_SEEN__ = [];
      const legacySelector =
        ".shared-campaign-missions-hero,.shared-campaign-metrics,.shared-campaign-mission-admin-command,.shared-campaign-mission-staff-command,.shared-mission-detail-hero,.shared-mission-detail-grid,.shared-missions-metrics";
      new MutationObserver((records) => {
        if (!location.pathname.includes("/missions")) return;
        for (const record of records)
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            const legacy = [
              ...(node.matches(legacySelector) ? [node] : []),
              ...node.querySelectorAll(legacySelector),
            ];
            for (const panel of legacy)
              window.__LEGACY_MISSION_PANELS_SEEN__.push(panel.className);
          }
      }).observe(document, { childList: true, subtree: true });
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
    {
      baseUrl: BASE_URL,
      actorRole: role,
      fixedTime: FIXED_TIME,
      themeMode: theme,
    },
  );
  page.on("pageerror", (error) => data.errors.push(error.message));
  const pendingUploads = new Map();

  function visibleMissions() {
    if (managed) return clone(data.missions);
    return data.missions
      .map((mission) => ({
        ...clone(mission),
        jobs: clone(mission.jobs).filter(
          (job) =>
            job.assigneeUserId === "alex" ||
            (job.targetMode === "role_claim" &&
              !job.assigneeUserId &&
              ![
                "queued",
                "completed",
                "approved",
                "failed",
                "canceled",
              ].includes(job.status)),
        ),
      }))
      .filter((mission) => mission.jobs.length);
  }
  data.visibleMissions = visibleMissions;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(BASE_URL).origin) {
      data.externalRequests.push(url.origin);
      return route.abort("blockedbyclient");
    }
    const path = url.pathname;
    const method = request.method();
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path.startsWith("/__mission-upload/")) {
      const pending = pendingUploads.get(path);
      if (!pending || method !== "PUT")
        return reply({ error: "unexpected_upload" }, 400);
      const job = data.missions
        .find((mission) => mission.missionId === pending.missionId)
        .jobs.find((item) => item.jobId === pending.jobId);
      job.artifacts.push({
        artifactId: "test-uploaded-file",
        jobId: job.jobId,
        fileName: pending.fileName,
        contentType: pending.contentType,
        sizeBytes: pending.sizeBytes,
      });
      job.artifactCount = job.artifacts.length;
      data.writes.push({
        path,
        method,
        size: request.postDataBuffer()?.length,
      });
      return route.fulfill({ status: 200, body: "" });
    }
    if (!path.startsWith("/api/")) return route.continue();
    data.requests.push({ path, query: url.search, method });
    if (missionDelay && path.startsWith("/api/missions") && method === "GET")
      await new Promise((resolve) => setTimeout(resolve, missionDelay));
    if (path === "/api/profile/me")
      return reply({
        profile: {
          userId: "alex",
          displayName: "Alex Morgan",
          username: "alex.morgan",
        },
      });
    if (path === "/api/me/policy-acceptance")
      return reply({ ok: true, accepted: true });
    if (path === "/api/coalitions")
      return reply({ items: [{ coalition, membership }] });
    if (path === `${COALITION_PATH.replace("/coalitions", "/api/coalitions")}`)
      return reply({ coalition, membership });
    if (path === `/api/coalitions/${COALITION_ID}/members`)
      return reply({
        items: samples.people.map((person) => ({
          userId: person.id,
          displayName: person.name,
          username: person.handle,
          roleKey:
            person.id === "alex"
              ? membership.roleKey
              : person.role.toLowerCase().replaceAll(" ", "-"),
          permissions: person.id === "alex" ? membership.permissions : [],
        })),
      });
    if (path === `/api/coalitions/${COALITION_ID}/access/catalog`)
      return reply({
        roles,
        canManage: admin,
        canAssignFilesSuperuser: false,
        mutationRevision: 3,
      });
    if (path === "/api/missions/templates" && method === "GET")
      return reply({
        templates: managed ? clone(data.templates) : [],
        hiddenPresetKeys: [],
      });
    if (path === "/api/missions" && method === "GET")
      return reply({ items: visibleMissions(), nextCursor: null });
    if (path === "/api/missions" && method === "POST") {
      const body = request.postDataJSON();
      data.writes.push({ path, method, body });
      if (!canCreate) return reply({ error: "forbidden" }, 403);
      if (body.scopeType !== "coalition" || body.scopeId !== COALITION_ID)
        return reply({ error: "wrong_scope" }, 400);
      const missionId = "created-local-mission";
      const jobs = body.jobs.map((job, index) => ({
        ...job,
        missionId,
        jobId: `created-job-${index}`,
        status: "active",
        targetMode: job.target.mode === "direct" ? "user" : job.target.mode,
        assigneeUserId: job.target.userId || "",
        assigneeDisplayName:
          samples.people.find((person) => person.id === job.target.userId)
            ?.name || "",
        targetRoleKey: job.target.roleKey || "",
        targetRoleLabel: job.target.roleLabel || "",
        artifacts: [],
      }));
      const mission = {
        ...body,
        missionId,
        status: "active",
        jobs,
        leadUserId: "alex",
        mutationRevision: 1,
      };
      data.missions.unshift(mission);
      return reply({ mission });
    }
    if (
      path.startsWith("/api/missions/templates/") ||
      (path === "/api/missions/templates" && method !== "GET")
    ) {
      const body = request.postDataJSON();
      data.writes.push({ path, method, body });
      if (!admin) return reply({ error: "forbidden" }, 403);
      const existing = data.templates.find(
        (item) => item.templateId === body.templateId,
      );
      const template = {
        ...existing,
        ...body,
        templateId: body.templateId || "created-local-template",
        version: existing ? existing.version + 1 : 1,
      };
      data.templates = data.templates.filter(
        (item) => item.templateId !== template.templateId,
      );
      data.templates.unshift(template);
      return reply({ template });
    }
    const match = path.match(/^\/api\/missions\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const missionId = decodeURIComponent(match[1]);
      const mission = data.missions.find(
        (item) => item.missionId === missionId,
      );
      if (!mission) return reply({ error: "not_found" }, 404);
      const subpath = match[2] || "";
      if (!subpath && method === "GET") {
        const visible = visibleMissions().find(
          (item) => item.missionId === missionId,
        );
        if (!visible) return reply({ error: "forbidden" }, 403);
        return reply({
          mission: visible,
          events: detailEventsFor(missionId),
          viewer: { admin, canManage: admin, canAssign: canCreate, canApprove },
        });
      }
      if (!subpath && method === "PATCH") {
        const body = request.postDataJSON();
        data.writes.push({ path, method, body });
        if (!admin) return reply({ error: "forbidden" }, 403);
        if (body.expectedRevision !== mission.mutationRevision)
          return reply({ error: "mission_revision_conflict" }, 409);
        Object.assign(mission, body, {
          mutationRevision: mission.mutationRevision + 1,
        });
        return reply({ mission: clone(mission) });
      }
      if (subpath === "artifacts/upload-url" && method === "POST") {
        const body = request.postDataJSON();
        data.writes.push({ path, method, body });
        const job = mission.jobs.find((item) => item.jobId === body.jobId);
        if (!job || (!admin && job.assigneeUserId !== "alex"))
          return reply({ error: "forbidden" }, 403);
        const uploadPath = `/__mission-upload/${missionId}/${body.jobId}`;
        pendingUploads.set(uploadPath, { ...body, missionId });
        return reply({
          upload: {
            uploadUrl: BASE_URL + uploadPath,
            method: "PUT",
            headers: { "Content-Type": body.contentType },
          },
        });
      }
      if (/^artifacts\/[^/]+\/download-url$/.test(subpath))
        return reply({ downloadUrl: BASE_URL + "/assets/Polis.png" });
      const actionMatch = subpath.match(/^jobs\/([^/]+)\/actions$/);
      if (actionMatch && method === "POST") {
        const body = request.postDataJSON();
        data.writes.push({ path, method, body });
        const job = mission.jobs.find((item) => item.jobId === actionMatch[1]);
        if (!job) return reply({ error: "not_found" }, 404);
        const isMine = job.assigneeUserId === "alex";
        if (
          mission.status !== "active" &&
          !["post_update", "request_clarification"].includes(body.action)
        )
          return reply({ error: "mission_not_active" }, 409);
        if (
          [
            "request_changes",
            "block",
            "post_update",
            "request_clarification",
            "request_reassign",
            "cant_do",
          ].includes(body.action) &&
          !body.note?.trim()
        )
          return reply({ error: "missing_note" }, 400);
        if (body.action === "claim") {
          if (
            job.targetMode !== "role_claim" ||
            job.assigneeUserId ||
            job.status !== "active"
          )
            return reply({ error: "not_claimable" }, 409);
          Object.assign(job, {
            assigneeUserId: "alex",
            assigneeDisplayName: "Alex Morgan",
            claimedAt: FIXED_TIME,
          });
        } else if (
          [
            "approve",
            "request_changes",
            "unblock",
            "activate",
            "cancel",
            "fail",
          ].includes(body.action)
        ) {
          if (!canApprove) return reply({ error: "forbidden" }, 403);
          job.status = {
            approve: "approved",
            request_changes: "needs_changes",
            unblock: "active",
            activate: "active",
            cancel: "canceled",
            fail: "failed",
          }[body.action];
        } else {
          if (!admin && !isMine) return reply({ error: "forbidden" }, 403);
          if (body.action === "start") job.lastStartedAt = FIXED_TIME;
          if (body.action === "submit") job.status = "submitted";
          if (body.action === "complete") job.status = "completed";
          if (body.action === "block") job.status = "blocked";
        }
        return reply({ job: clone(job) });
      }
      if (subpath === "jobs" && method === "POST") {
        const body = request.postDataJSON();
        data.writes.push({ path, method, body });
        const job = {
          ...body,
          missionId,
          jobId: "follow-up-job",
          status: "queued",
          assigneeUserId: body.target.userId || "",
          assigneeDisplayName:
            samples.people.find((person) => person.id === body.target.userId)
              ?.name || "",
          artifacts: [],
        };
        mission.jobs.push(job);
        return reply({ job });
      }
    }
    if (method !== "GET") {
      data.writes.push({ path, method, body: request.postData() });
      return reply({ error: "unexpected_fixture_write" }, 400);
    }
    return reply({ ok: true, items: [], roles: [], workspaces: [] });
  });
  return data;
}

module.exports = {
  BASE_URL,
  COALITION_ID,
  COALITION_PATH,
  FIXED_TIME,
  missionRecords,
  templateRecords,
  mockMissionsWorkspace,
};
