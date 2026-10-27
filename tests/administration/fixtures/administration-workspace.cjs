const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9068";
const COALITION_ID = "cedar-valley";
const COALITION_PATH = `/coalitions/${COALITION_ID}`;
const ADMIN_PATH = `${COALITION_PATH}/admin/edit`;
const FIXED_TIME = Date.parse("2026-10-27T01:00:00Z");
const clone = (value) => JSON.parse(JSON.stringify(value));
const IMAGE_URL =
  "https://imagedelivery.net/fixture-account/organization/public";
const image = () => fs.readFileSync(path.join(__dirname, "organization.svg"));

function token(
  actor = "alex",
  version = "original",
  expiresAt = FIXED_TIME + 3600000,
) {
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: actor,
      name: actor === "alex" ? "Alex Morgan" : "Riley Chen",
      email: `${actor}@example.test`,
      credentialVersion: version,
      exp: Math.floor(expiresAt / 1000),
    }),
  ).toString("base64url")}.test`;
}

function profile(id = COALITION_ID) {
  return {
    coalitionId: id,
    name: id === COALITION_ID ? "Cedar Valley Coalition" : "River County Team",
    coalitionType: "simple",
    description:
      "Neighbors working together to strengthen our community and turn shared priorities into action.",
    imageUrl: IMAGE_URL,
    primaryContactName: "Jordan Lee",
    email: "hello@cedarvalley.example",
    phone: "(406) 555-0144",
    website: "https://cedarvalley.example",
    pacAssociated: false,
    fecNumber: null,
    socials: { facebook: "https://facebook.com/cedarvalley" },
    voterMapEnabled: true,
    organizationMutationRevision: 1,
    updatedAt: FIXED_TIME - 10000,
  };
}

function scripts() {
  return {
    phoneCall: {
      title: "Community conversation",
      body: "Hi {{firstName}}, this is {{volunteerName}} with {{campaignName}}. What would you most like to see improve in our community?",
    },
    textMessage: {
      title: "A quick community check-in",
      body: "Hi {{firstName}}, this is {{volunteerName}} with {{campaignName}}. We'd love to hear what matters most to you in our community.",
    },
    mailEmail: {
      title: "Your voice in Cedar Valley",
      body: "Hi {{firstName}},\n\nI'm {{volunteerName}} with {{campaignName}}. We're bringing neighbors together to work on our community's shared priorities. What would you like us to focus on?\n\nThank you for sharing your perspective.",
    },
    mailPhysical: {
      title: "Let's shape our community together",
      body: "Dear {{firstName}},\n\nYour voice matters. {{campaignName}} brings neighbors together to work on the things our community cares about. We'd love to hear your priorities.",
    },
  };
}

function actorFrom(headers) {
  try {
    return JSON.parse(
      Buffer.from(
        (headers.authorization || "").replace(/^Bearer /u, "").split(".")[1],
        "base64url",
      ).toString(),
    ).sub;
  } catch {
    return "";
  }
}

async function mockAdministrationWorkspace(page, options = {}) {
  const data = {
    actor: "alex",
    revisionMode: options.revisionMode || "modern",
    role: options.role || "admin",
    membershipStatus: options.membershipStatus || "active",
    omitMembership: options.omitMembership || false,
    fieldAccess: options.fieldAccess !== false,
    profiles: {
      [COALITION_ID]: profile(),
      "river-county": profile("river-county"),
    },
    templates: { [COALITION_ID]: scripts(), "river-county": scripts() },
    requests: [],
    writes: [],
    profileApplications: [],
    scriptApplications: [],
    uploadBytes: [],
    authRequests: [],
    errors: [],
    unexpectedWrites: [],
    blockedExternalRequests: [],
    externalFixtureRequests: [],
    runtimeAssetResponses: [],
    profileReadFailures: 0,
    profileReadStatus: 503,
    profileWriteFailures: 0,
    profileWriteStatus: 503,
    scriptReadFailures: 0,
    scriptReadStatus: 503,
    scriptWriteFailures: 0,
    scriptWriteStatus: 503,
    profileWriteError: "profile_temporarily_unavailable",
    scriptWriteError: "templates_temporarily_unavailable",
    persistProfileBeforeFailure: false,
    persistScriptsBeforeFailure: false,
    nameConflict: false,
    profileReadDelay: 0,
    scriptReadDelay: 0,
    profileWriteDelay: 0,
    scriptWriteDelay: 0,
    nextProfileReadGate: null,
    nextScriptReadGate: null,
    nextProfileWriteGate: null,
    nextScriptWriteGate: null,
    uploadCreateFailures: 0,
    uploadCreateStatus: 503,
    uploadByteFailures: 0,
    uploadCreateGate: null,
    uploadByteGate: null,
    malformedUpload: false,
    missingDeliveryUrl: false,
    uploadSessions: new Map(),
    replays: new Map(),
    refreshActor: "alex",
    refreshRole: null,
    refreshFailures: 0,
    refreshStatus: 400,
    refreshGate: null,
  };
  if (options.emptyProfile) {
    Object.assign(data.profiles[COALITION_ID], {
      name: "",
      imageUrl: "",
      description: "",
      primaryContactName: "",
      email: "",
      phone: "",
      website: "",
      socials: {},
    });
  }
  if (options.emptyTemplates) data.templates[COALITION_ID] = {};
  const membership = () => ({
    roleKey: ["admin", "officer"].includes(data.role)
      ? data.role
      : data.role === "leader"
        ? "staff_lead"
        : data.role === "editor"
          ? "profile_editor"
          : "member",
    status: data.membershipStatus,
    permissions: [
      ...(data.fieldAccess && data.role !== "denied"
        ? ["voter_map_access"]
        : []),
      ...(data.role === "editor" ? ["profile_manage"] : []),
      ...(data.role === "leader" ? ["members_manage"] : []),
    ],
  });
  const active = () =>
    !data.omitMembership && data.membershipStatus === "active";
  const canProfile = () =>
    active() && ["admin", "officer", "editor"].includes(data.role);
  const canScripts = () =>
    active() && ["admin", "officer"].includes(data.role) && data.fieldAccess;
  const etag = (id) =>
    `"org:${id}:${data.profiles[id].organizationMutationRevision}"`;
  const payload = (id) => {
    const coalition = clone(data.profiles[id]);
    if (data.revisionMode === "legacy")
      delete coalition.organizationMutationRevision;
    return {
      coalition,
      membership: data.omitMembership ? null : clone(membership()),
      ...(data.revisionMode === "modern"
        ? {
            revision: data.profiles[id].organizationMutationRevision,
            etag: etag(id),
          }
        : {}),
    };
  };
  if (!["legacy", "modern"].includes(data.revisionMode))
    throw new Error(
      "Administration fixture revisionMode must follow verified live contract; choose legacy or modern explicitly until proof is available.",
    );
  await page.clock.setFixedTime(FIXED_TIME);
  await page.addInitScript(
    ({ baseUrl, sessionToken, theme, now, refreshToken }) => {
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: sessionToken,
          idToken: sessionToken,
          expiresAt: now + 3600000,
          refreshToken,
        }),
      );
      localStorage.setItem("prefs.themeMode", theme);
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
      sessionToken: token(),
      theme: options.theme || "dark",
      now: FIXED_TIME,
      refreshToken: "fixture-refresh-alex",
    },
  );
  page.on("pageerror", (error) => data.errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const pathname = url.pathname.includes("/api/")
      ? url.pathname.slice(url.pathname.indexOf("/api/"))
      : url.pathname;
    const row = {
      path: pathname,
      query: url.search,
      method,
      headers: request.headers(),
      actor: actorFrom(request.headers()),
    };
    const reply = (body, status = 200, headers = {}) =>
      route.fulfill({
        status,
        headers,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (
      url.hostname === "cognito-idp.us-west-2.amazonaws.com" &&
      method === "POST"
    ) {
      const body = request.postDataJSON();
      data.authRequests.push({ ...row, body });
      if (body.AuthFlow !== "REFRESH_TOKEN_AUTH") {
        data.unexpectedWrites.push(row);
        return reply({ __type: "NotAuthorizedException" }, 400);
      }
      if (data.refreshGate) {
        const gate = data.refreshGate;
        data.refreshGate = null;
        await gate;
      }
      if (data.refreshFailures-- > 0)
        return reply(
          {
            __type: "NotAuthorizedException",
            message: "Fixture refresh rejected",
          },
          data.refreshStatus,
        );
      const renewed = token(
        data.refreshActor,
        "renewed",
        FIXED_TIME + 10 * 3600000,
      );
      if (data.refreshActor !== data.actor) {
        data.actor = data.refreshActor;
        data.role = data.refreshRole || "member";
      }
      return reply({
        AuthenticationResult: {
          AccessToken: renewed,
          IdToken: renewed,
          ExpiresIn: 3600,
          TokenType: "Bearer",
        },
        ChallengeParameters: {},
      });
    }
    if (
      url.hostname === "imagedelivery.net" &&
      url.pathname.startsWith("/fixture-account/")
    ) {
      if (!["GET", "HEAD"].includes(method)) {
        data.unexpectedWrites.push(row);
        return route.abort("blockedbyclient");
      }
      data.externalFixtureRequests.push({ url: request.url(), method });
      return route.fulfill({ contentType: "image/svg+xml", body: image() });
    }
    if (
      url.hostname === "upload.imagedelivery.net" &&
      url.pathname.startsWith("/fixture-admin/")
    ) {
      const uid = url.pathname.split("/").pop();
      if (!data.uploadSessions.has(uid) || method !== "POST") {
        data.unexpectedWrites.push(row);
        return route.abort();
      }
      data.uploadBytes.push({
        ...row,
        uid,
        contentType: request.headers()["content-type"],
        bytes: request.postDataBuffer()?.length || 0,
      });
      if (data.uploadByteGate) {
        const gate = data.uploadByteGate;
        data.uploadByteGate = null;
        await gate;
      }
      if (data.uploadByteFailures-- > 0)
        return reply({ error: "fixture_upload_failed" }, 503);
      return reply({ success: true });
    }
    const api = pathname.startsWith("/api/");
    if (url.origin !== new URL(BASE_URL).origin && !api) {
      if (url.hostname === "fonts.googleapis.com")
        return route.fulfill({
          contentType: "text/css",
          body: "/* Isolated fixture: external font request fulfilled locally. */",
        });
      data.blockedExternalRequests.push(request.url());
      return route.abort("blockedbyclient");
    }
    if (!api) {
      if (!["GET", "HEAD"].includes(method)) {
        data.unexpectedWrites.push(row);
        return route.abort("blockedbyclient");
      }
      if (
        method === "GET" &&
        ["/scripts/shared-feed.js", "/css/shared-feed.css"].includes(
          url.pathname,
        )
      ) {
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() !== 200)
          throw new Error(
            `Actual Administration asset could not be read: ${url.pathname}`,
          );
        const bytes = await response.body();
        data.runtimeAssetResponses.push({
          url: request.url(),
          path: url.pathname.slice(1),
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        });
        return route.fulfill({ response, body: bytes });
      }
      return route.continue();
    }
    data.requests.push(row);
    if (method !== "GET") {
      row.body = request.postDataJSON();
      data.writes.push(row);
    }
    if (pathname === "/api/profile/me")
      return reply({
        profile: {
          userId: row.actor || data.actor,
          displayName: data.actor === "alex" ? "Alex Morgan" : "Riley Chen",
          username: data.actor,
        },
      });
    if (pathname === "/api/me/policy-acceptance")
      return reply({ ok: true, accepted: true });
    if (pathname === "/api/coalitions")
      return reply({
        items: data.omitMembership
          ? []
          : Object.values(data.profiles).map((coalition) => ({
              coalition,
              membership: membership(),
            })),
      });
    if (pathname === "/api/me/organization-workspaces")
      return reply({
        workspaces: data.omitMembership
          ? []
          : Object.values(data.profiles).map((coalition) => ({
              scopeType: "coalition",
              scopeId: coalition.coalitionId,
              name: coalition.name,
              isAdmin: ["admin", "officer"].includes(data.role),
              role: membership().roleKey,
              permissions: membership().permissions,
            })),
      });
    if (pathname === "/api/uploads/create" && method === "POST") {
      if (data.uploadCreateGate) {
        const gate = data.uploadCreateGate;
        data.uploadCreateGate = null;
        await gate;
      }
      if (!canProfile()) return reply({ error: "forbidden" }, 403);
      if (data.uploadCreateFailures-- > 0)
        return reply({ error: "upload_unavailable" }, data.uploadCreateStatus);
      if (data.malformedUpload) return reply({ ok: true, type: "image" });
      const uid = `fixture-image-${data.uploadSessions.size + 1}`;
      data.uploadSessions.set(uid, row.body);
      const deliveryUrl = `https://imagedelivery.net/fixture-account/${uid}/public`;
      return reply({
        ok: true,
        provider: "cloudflare",
        type: "image",
        uid,
        id: uid,
        uploadUrl: `https://upload.imagedelivery.net/fixture-admin/${uid}`,
        uploadURL: `https://upload.imagedelivery.net/fixture-admin/${uid}`,
        requiresMultipart: true,
        method: "POST",
        headers: {},
        fields: {},
        fileFieldName: "file",
        ...(!data.missingDeliveryUrl
          ? { deliveryUrl, publicUrl: deliveryUrl }
          : {}),
      });
    }
    const scoped = pathname.match(/^\/api\/coalitions\/([^/]+)(?:\/(.*))?$/u);
    if (scoped) {
      const id = decodeURIComponent(scoped[1]),
        suffix = scoped[2] || "";
      if (!data.profiles[id]) return reply({ error: "not_found" }, 404);
      if (!suffix && method === "GET") {
        const captured = payload(id);
        if (data.nextProfileReadGate) {
          const gate = data.nextProfileReadGate;
          data.nextProfileReadGate = null;
          await gate;
        }
        if (data.profileReadDelay)
          await new Promise((resolve) =>
            setTimeout(resolve, data.profileReadDelay),
          );
        if (data.profileReadFailures-- > 0)
          return reply(
            { error: "profile_unavailable" },
            data.profileReadStatus,
          );
        return reply(
          captured,
          200,
          captured.etag ? { ETag: captured.etag } : {},
        );
      }
      if (!suffix && method === "PATCH") {
        const permitted = canProfile(),
          body = clone(row.body);
        if (data.nextProfileWriteGate) {
          const gate = data.nextProfileWriteGate;
          data.nextProfileWriteGate = null;
          await gate;
        }
        if (data.profileWriteDelay)
          await new Promise((resolve) =>
            setTimeout(resolve, data.profileWriteDelay),
          );
        if (!permitted) return reply({ error: "forbidden" }, 403);
        if (data.nameConflict) return reply({ error: "name_taken" }, 409);
        const originalRevision = data.profiles[id].organizationMutationRevision;
        const replayKey = `${row.actor}:${id}:${body.clientRequestId || ""}`;
        if (
          data.revisionMode === "modern" &&
          body.clientRequestId &&
          data.replays.has(replayKey)
        )
          return reply({ ...clone(data.replays.get(replayKey)), replay: true });
        const match = /^"org:[^:]+:(\d+)"$/u.exec(
          row.headers["if-match"] || "",
        );
        const expected =
          body.expectedRevision ?? (match ? Number(match[1]) : undefined);
        if (data.revisionMode === "modern" && !Number.isInteger(expected))
          return reply({ error: "organization_precondition_required" }, 428);
        if (data.revisionMode === "modern" && expected !== originalRevision)
          return reply(
            {
              error: "organization_revision_conflict",
              revision: originalRevision,
              etag: etag(id),
            },
            409,
          );
        const failing = data.profileWriteFailures-- > 0;
        if (!failing || data.persistProfileBeforeFailure) {
          const update = clone(body);
          delete update.expectedRevision;
          delete update.clientRequestId;
          data.profiles[id] = {
            ...data.profiles[id],
            ...update,
            fecNumber: body.pacAssociated ? body.fecNumber : null,
            organizationMutationRevision: originalRevision + 1,
            updatedAt: FIXED_TIME + originalRevision,
          };
          data.profileApplications.push({ id, actor: row.actor, body });
          data.replays.set(replayKey, payload(id));
        }
        if (failing)
          return reply(
            { error: data.profileWriteError },
            data.profileWriteStatus,
          );
        const current = payload(id);
        return reply(current, 200, current.etag ? { ETag: current.etag } : {});
      }
      if (suffix === "voter-map/outreach-templates") {
        if (!active() || !data.fieldAccess)
          return reply({ error: "forbidden" }, 403);
        if (method === "GET") {
          const captured = clone(data.templates[id]);
          if (data.nextScriptReadGate) {
            const gate = data.nextScriptReadGate;
            data.nextScriptReadGate = null;
            await gate;
          }
          if (data.scriptReadDelay)
            await new Promise((resolve) =>
              setTimeout(resolve, data.scriptReadDelay),
            );
          if (data.scriptReadFailures-- > 0)
            return reply(
              { error: "templates_unavailable" },
              data.scriptReadStatus,
            );
          return reply({ ok: true, templates: captured });
        }
        if (method === "PUT") {
          const permitted = canScripts(),
            body = clone(row.body);
          if (data.nextScriptWriteGate) {
            const gate = data.nextScriptWriteGate;
            data.nextScriptWriteGate = null;
            await gate;
          }
          if (data.scriptWriteDelay)
            await new Promise((resolve) =>
              setTimeout(resolve, data.scriptWriteDelay),
            );
          if (!permitted) return reply({ error: "forbidden" }, 403);
          const failing = data.scriptWriteFailures-- > 0;
          if (!failing || data.persistScriptsBeforeFailure) {
            data.templates[id] = Object.fromEntries(
              Object.entries(body.templates || {})
                .filter(([key]) =>
                  [
                    "phoneCall",
                    "textMessage",
                    "mailEmail",
                    "mailPhysical",
                  ].includes(key),
                )
                .map(([key, value]) => [
                  key,
                  {
                    title: String(value.title || "")
                      .trim()
                      .slice(0, 120),
                    body: String(value.body || "")
                      .trim()
                      .slice(0, 5000),
                  },
                ])
                .filter(([, value]) => value.title || value.body),
            );
            data.scriptApplications.push({ id, actor: row.actor, body });
          }
          if (failing)
            return reply(
              { error: data.scriptWriteError },
              data.scriptWriteStatus,
            );
          return reply({ ok: true, templates: clone(data.templates[id]) });
        }
      }
      if (suffix === "members")
        return reply({
          members: [
            {
              userId: data.actor,
              displayName: "Alex Morgan",
              roleKey: membership().roleKey,
              permissions: membership().permissions,
            },
          ],
        });
      if (suffix === "access/catalog")
        return reply({
          roles: ["admin", "officer", "profile_editor", "member"].map(
            (roleKey) => ({ roleKey, label: roleKey, enabled: true }),
          ),
          canManage: data.role === "admin",
        });
      if (suffix === "voter-map/access")
        return reply({
          access: {
            ok: data.fieldAccess,
            scope: "full",
            territories: [],
            canManageCta: data.role === "admin",
            canAccessVoterMap: data.fieldAccess,
          },
        });
    }
    if (method !== "GET") {
      data.unexpectedWrites.push(row);
      return reply({ error: "unexpected_fixture_write" }, 400);
    }
    return reply({
      ok: true,
      items: [],
      workspaces: [],
      members: [],
      roles: [],
    });
  });
  return data;
}

async function rotateSession(
  page,
  fixture,
  {
    actor = "riley",
    role = "member",
    expired = false,
    version = "changed",
  } = {},
) {
  fixture.actor = actor;
  fixture.role = role;
  const expiresAt = expired ? FIXED_TIME - 1000 : FIXED_TIME + 3600000;
  await page.evaluate(
    ({ sessionToken, expiresAt, actor }) => {
      sessionStorage.setItem(
        "sharedFeedSession.v1",
        JSON.stringify({
          accessToken: sessionToken,
          idToken: sessionToken,
          expiresAt,
          refreshToken: `fixture-refresh-${actor}`,
        }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: "sharedFeedSession.v1" }),
      );
      window.dispatchEvent(new Event("focus"));
    },
    { sessionToken: token(actor, version, expiresAt), expiresAt, actor },
  );
}

module.exports = {
  BASE_URL,
  COALITION_ID,
  COALITION_PATH,
  ADMIN_PATH,
  FIXED_TIME,
  IMAGE_URL,
  token,
  profile,
  scripts,
  mockAdministrationWorkspace,
  rotateSession,
};
