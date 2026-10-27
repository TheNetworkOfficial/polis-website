const BASE_URL = process.env.POLIS_TEST_BASE_URL || "http://127.0.0.1:9054";
process.env.POLIS_TEST_BASE_URL = BASE_URL;
const { mockMissionsWorkspace } = require("./missions-workspace.cjs");

const COALITION_ID = "cedar-valley";
const COALITION_PATH = `/coalitions/${COALITION_ID}`;
const API = `/api/coalitions/${COALITION_ID}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const rectangle = (west, south, east, north) => ({
  type: "Polygon",
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});
const AREA = rectangle(-114.01, 46.86, -114, 46.87);
const PEOPLE = [
  {
    userId: "alex",
    displayName: "Alex Morgan",
    username: "alex.morgan",
    roleKey: "member",
    status: "active",
  },
  {
    userId: "jordan",
    displayName: "Jordan Lee",
    username: "jordan.lee",
    roleKey: "member",
    status: "active",
  },
  {
    userId: "sam",
    displayName: "Sam Rivera",
    username: "sam.rivera",
    roleKey: "member",
    status: "active",
  },
  {
    userId: "riley",
    displayName: "Riley Chen",
    username: "riley.chen",
    roleKey: "member",
    status: "active",
  },
];
const TERRITORIES = [
  ["north", "North Cedar", -114.01, 46.865, -114.005, 46.87, "published"],
  ["riverside", "Riverside", -114.005, 46.865, -114, 46.87, "published"],
  ["elm", "Elmwood", -114.01, 46.86, -114.005, 46.865, "published"],
  ["south", "South Commons", -114.005, 46.86, -114, 46.865, "draft"],
].map(([territoryId, name, west, south, east, north, status]) => ({
  territoryId,
  name,
  bbox: { west, south, east, north },
  geojson: rectangle(west, south, east, north),
  version: 3,
  status,
  createdByUserId: "alex",
  createdAt: "2026-10-25T18:00:00Z",
}));
const RAW_VOTERS = [
  ["v1", "Avery Collins", "124 Cedar Avenue", "north", "red"],
  ["v2", "Taylor Brooks", "138 Cedar Avenue", "north", "green"],
  ["v3", "Casey Bennett", "216 Maple Street", "north", "red"],
  ["v4", "Morgan Ellis", "228 Maple Street", "north", "blue"],
  ["v5", "Quinn Parker", "42 River Road", "riverside", "red"],
  ["v6", "Drew Foster", "58 River Road", "riverside", "blue"],
  ["v7", "Jamie Sutton", "312 Willow Lane", "riverside", "green"],
  ["v8", "Skyler Reed", "331 Willow Lane", "riverside", "red"],
  ["v9", "Reese Hayes", "85 Elm Street", "elm", "red"],
  ["v10", "Robin Blake", "99 Elm Street", "elm", "blue"],
  ["v11", "Sage Wilson", "402 Oak Avenue", "south", "red"],
  ["v12", "Emerson Gray", "418 Oak Avenue", "south", "green"],
].map(
  ([recordId, displayName, addressLine1, territoryId, pinStatus], index) => {
    const territory = TERRITORIES.find(
      (item) => item.territoryId === territoryId,
    );
    return {
      recordId,
      displayName,
      addressLine1,
      territoryId,
      pinStatus,
      city: "Missoula",
      state: "MT",
      postalCode: "59801",
      lat: territory.bbox.south + 0.0015 + (index % 2) * 0.0015,
      lng: territory.bbox.west + 0.001 + (index % 4) * 0.0008,
      sourceType: "organization_contact",
      contactId: `contact-${recordId}`,
      contactRevision: 3,
      phone: "+14065550123",
      email: `${recordId}@example.test`,
      contactPreferences: {
        phoneCall: true,
        textMessage: true,
        mailEmail: true,
        doorKnock: true,
      },
    };
  },
);
const connectedRecord = (record) => {
  // The actual connected-record DTO does not carry the point query's pinStatus.
  const result = { ...record };
  delete result.pinStatus;
  delete result.territoryId;
  return result;
};
const pointRecord = (record) => ({
  kind: "point",
  recordId: record.recordId,
  displayName: record.displayName,
  lat: record.lat,
  lng: record.lng,
  sourceType: record.sourceType,
  addressLine1: record.addressLine1,
  city: record.city,
  state: record.state,
  postalCode: record.postalCode,
  hasPhone: !!record.phone,
  hasEmail: !!record.email,
  pinStatus: { state: record.pinStatus },
});

/** Backend-shaped fixtures: reject unrecognized writes instead of faking success. */
async function mockFieldworkWorkspace(page, options = {}) {
  const role = options.role || "admin";
  const admin = role === "admin";
  const shell = await mockMissionsWorkspace(page, {
    role,
    theme: options.theme || "dark",
  });
  const data = {
    role,
    errors: shell.errors,
    shell,
    requests: [],
    writes: [],
    unexpectedWrites: [],
    voters: options.empty ? [] : clone(RAW_VOTERS),
    territories: clone(TERRITORIES),
    denied: !!options.denied,
    failList: !!options.failList,
    failMap: !!options.failMap,
    failNote: !!options.failNote,
    failAssignments: false,
    failAssignmentForUser: "",
    manualOutOfScope: false,
    unauthenticatedRequests: [],
    builderActorHeaders: [],
    accessDelay: options.accessDelay || 0,
    authoring: options.authoring !== false,
    unassigned: !!options.unassigned,
    paused: !!options.paused,
    cluster: !!options.cluster,
    partial: !!options.partial,
    listPageSize: options.listPageSize || 50,
    queryDelay: options.queryDelay || 0,
    listDelayByQuery: {},
    completedListQueries: [],
    directoryMembers: [
      {
        memberId: "external-jamie",
        coalitionId: COALITION_ID,
        firstName: "Jamie",
        lastName: "External",
        fullName: "Jamie External",
        email: "jamie.external@example.test",
        linkStatus: "unlinked",
        capabilities: ["field_outreach"],
      },
    ],
    failDirectoryMembers: false,
    builderRevision: 0,
    builderDraft: null,
    builderConflict: false,
    notes: {
      v1: [
        {
          noteId: "note-1",
          recordId: "v1",
          preview: "Prefers a short conversation in the late afternoon.",
          body: "Prefers a short conversation in the late afternoon.",
          contactType: "other",
          tags: [],
          createdAt: 1793028000000,
          author: { userId: "jordan", displayName: "Jordan Lee" },
        },
      ],
    },
    assignments: {
      north: ["alex", "jordan"],
      riverside: ["sam"],
      elm: [],
      south: ["riley"],
    },
  };
  data.assignmentRows = (id) =>
    (data.unassigned ? [] : data.assignments[id] || []).map((userId) => ({
      assignmentId: `${id}-${userId}`,
      ownerKey: `coalition:${COALITION_ID}`,
      userId,
      territoryId: id,
      territoryVersion: 3,
      status: "active",
      startsAt: "2026-10-25T18:00:00Z",
      endsAt: null,
      assignmentTokenVersion: 7,
      createdByUserId: "alex",
      createdAt: "2026-10-25T18:00:00Z",
    }));
  const membership = {
    roleKey: admin ? "admin" : "member",
    status: "active",
    permissions: ["voter_map_access", "missions_view"],
  };
  const coalition = {
    coalitionId: COALITION_ID,
    name: "Cedar Valley Coalition",
    coalitionType: "simple",
    voterMapEnabled: true,
    description: "A shared workspace for neighborhood volunteers.",
  };
  data.membership = membership;
  const access = () => ({
    ok: true,
    scope: "full",
    territories: clone(data.territories),
    // This is deliberately the first territory, never evidence of an assignment.
    defaultTerritoryId: data.territories[0]?.territoryId || null,
    assignmentTokenVersion: 7,
    activeUnitSetId: null,
    territoryVersions: Object.fromEntries(
      data.territories.map((t) => [t.territoryId, t.version]),
    ),
    canManageTerritories: admin,
    capabilities: {
      territoryAuthoringAccess: admin && data.authoring,
      territoryDevelopmentAccess: false,
    },
    canManageCanvassingConfiguration: admin,
    canManageCta: admin,
    volunteerMessage:
      "Meet at Cedar Park's east entrance. Keep gates closed and respect all no-soliciting signs.",
  });
  data.access = access;
  const progress = () => {
    const assigned =
      data.unassigned || data.paused
        ? []
        : data.territories.filter((territory) =>
            admin
              ? data.assignmentRows(territory.territoryId).length
              : data
                  .assignmentRows(territory.territoryId)
                  .some((row) => row.userId === "alex"),
          );
    return {
      status: "ready",
      revision: "fixture-progress-1",
      buildings: [],
      leaderboard: [],
      totals: {},
      round: {
        roundId: "fall-neighborhood",
        label: "Fall neighborhood outreach",
        status: "active",
      },
      access: {
        canObserve: true,
        canManage: admin,
        canReadMap: !!assigned.length,
        // An unlocated progress query has no valid point to authorize a visit.
        canKnock: false,
        canReadPeople: false,
        reason: data.paused
          ? "canvassing_operations_disabled"
          : assigned.length
            ? "outside_territory"
            : "no_assignment",
        version: "fixture-access-1",
        boundaries: {
          type: "FeatureCollection",
          features: assigned.map((t) => ({
            type: "Feature",
            geometry: clone(t.geojson),
            properties: {
              kind: "assigned_territory",
              territoryId: t.territoryId,
              assignmentId: `${t.territoryId}-alex`,
              label: t.name,
              version: 3,
            },
          })),
        },
      },
    };
  };
  await page.addInitScript(
    ({ base, appScheme }) => {
      window.__LEGACY_FIELDWORK_PANELS_SEEN__ = [];
      const selector =
        ".shared-coalition-metrics,.shared-coalition-voter-map-hero,.shared-coalition-voter-map-menu,.shared-coalition-browser-map";
      new MutationObserver((records) => {
        if (!location.pathname.includes("/voter-map")) return;
        for (const record of records)
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            for (const el of [
              ...(node.matches(selector) ? [node] : []),
              ...node.querySelectorAll(selector),
            ])
              window.__LEGACY_FIELDWORK_PANELS_SEEN__.push(el.className);
          }
      }).observe(document, { childList: true, subtree: true });
      let config;
      Object.defineProperty(window, "__POLIS_WEB_APP__", {
        configurable: true,
        get: () => config,
        set: (value) => {
          config = {
            ...value,
            apiBaseUrl: base,
            ...(appScheme ? { appUrlScheme: appScheme } : {}),
            map: { styleUrl: `${base}/fieldwork-fixture-style.json` },
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
    { base: BASE_URL, appScheme: options.appScheme || "" },
  );
  // Exercise the real renderer and map engine, while keeping every tile/data read local.
  await page.route(
    "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.*",
    (route) => route.continue(),
  );
  await page.route(`${BASE_URL}/fieldwork-fixture-style.json`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 8,
        sources: {
          roads: {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [0, 1, 2, 3, 4].flatMap((i) => [
                {
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [-114.015, 46.86 + i * 0.0025],
                      [-113.995, 46.86 + i * 0.0025],
                    ],
                  },
                },
                {
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [-114.01 + i * 0.0025, 46.855],
                      [-114.01 + i * 0.0025, 46.875],
                    ],
                  },
                },
              ]),
            },
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#111d34" },
          },
          {
            id: "roads",
            type: "line",
            source: "roads",
            paint: { "line-color": "#30537f", "line-width": 5 },
          },
        ],
      }),
    }),
  );
  await page.route(`${BASE_URL}/__fieldwork-upload`, async (route) => {
    data.uploadedCsv = route.request().postData();
    data.uploadHeaders = route.request().headers();
    return route.fulfill({ status: 200, body: "" });
  });
  await page.route(`${BASE_URL}/api/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    data.requests.push({ path, query: url.search, method });
    const privateFieldApi =
      path.startsWith(`${API}/voters`) ||
      path.startsWith(`${API}/voter-map`) ||
      path.startsWith(`${API}/voter-imports`) ||
      path === "/api/voter-map/canvassing/progress";
    if (
      privateFieldApi &&
      !/^Bearer \S+$/.test(request.headers().authorization || "")
    ) {
      data.unauthenticatedRequests.push({ path, method });
      return reply({ error: "unauthorized" }, 401);
    }
    if (path.includes("/territory-builder/")) {
      const actor = request.headers()["x-polis-expected-actor"];
      data.builderActorHeaders.push(actor || "");
      if (actor !== "alex")
        return reply({ error: "expected_actor_mismatch" }, 403);
    }
    if (
      path ===
      `/api/contact-book/scopes/${encodeURIComponent(`coalition:${COALITION_ID}`)}/household-map`
    ) {
      if (data.failHouseholds)
        return reply({ error: "household_map_unavailable" }, 503);
      return reply({
        ok: true,
        markers: data.households || [],
        complete: !data.partialHouseholds,
        zoomRequired: !!data.partialHouseholds,
      });
    }
    if (path === "/api/coalitions")
      return reply({ items: [{ coalition, membership }] });
    if (path === API) return reply({ coalition, membership });
    if (path === `${API}/members`)
      return reply({ items: clone(PEOPLE), nextCursor: null });
    if (path === `${API}/directory/catalog`)
      return reply({
        categories: [],
        capabilities: ["field_outreach"],
        canManage: admin,
      });
    if (path === `${API}/directory/members` && method === "GET")
      return data.failDirectoryMembers
        ? reply({ message: "Directory list is temporarily unavailable" }, 503)
        : reply({ items: clone(data.directoryMembers), nextCursor: null });
    if (path === "/api/events" && method === "GET") {
      if (!url.searchParams.has("cursor"))
        return reply({
          items: [
            {
              eventId: "other-event",
              hostCoalitionId: "another-coalition",
              eventType: "cta",
              title: "Another coalition",
            },
          ],
          nextCursor: "coalition-events-page-2",
        });
      return reply({
        items: [
          {
            eventId: "shift-1",
            hostCoalitionId: COALITION_ID,
            coalitionId: COALITION_ID,
            eventType: "cta",
            ctaType: "canvass",
            title: "Cedar Valley canvass shift",
            description: "Meet at Cedar Park",
            startAt: "2026-10-27T18:00:00Z",
            transportEnabled: true,
          },
        ],
        cursor: null,
      });
    }
    if (path === `${API}/cta/events/shift-1/transport`)
      return reply({
        event: {
          eventId: "shift-1",
          title: "Cedar Valley canvass shift",
          transportEnabled: true,
        },
        groups: [
          {
            groupId: "pickup-west",
            name: "West pickup",
            pickupLocation: {
              name: "West entrance",
              address: "123 Example Street",
            },
            capacity: 8,
          },
        ],
        settings: { autoFactor: true },
      });
    if (path === `${API}/voter-map/outreach-templates`)
      return reply({
        templates: {
          phoneCall: {
            title: "Cedar volunteer call",
            body: "Hello from Cedar Valley volunteers.",
          },
          textMessage: {
            title: "Cedar text",
            body: "Join our neighborhood outreach.",
          },
        },
        canManage: admin,
      });
    if (path === `${API}/voter-map/access`) {
      if (data.accessDelay)
        await new Promise((resolve) => setTimeout(resolve, data.accessDelay));
      return data.denied
        ? reply({ error: "no_voter_map_access" }, 403)
        : reply(access());
    }
    if (path === "/api/voter-map/canvassing/progress") {
      if (url.searchParams.get("coalitionId") !== COALITION_ID)
        return reply({ error: "wrong_scope" }, 400);
      return reply(progress());
    }
    if (path === `${API}/voter-map/query`) {
      if (data.queryDelay)
        await new Promise((resolve) => setTimeout(resolve, data.queryDelay));
      if (data.failMap)
        return reply({ error: "map_temporarily_unavailable" }, 503);
      const bbox = url.searchParams.get("bbox")?.split(",").map(Number);
      if (!bbox || bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)))
        return reply({ error: "invalid_bbox" }, 400);
      const items =
        data.cluster && Number(url.searchParams.get("zoom")) < 17
          ? [
              {
                kind: "cluster",
                geoCell: "c2x",
                lat: 46.867,
                lng: -114.007,
                count: data.voters.length,
              },
            ]
          : data.voters.map(pointRecord);
      return reply({
        ok: true,
        kind: items.some((item) => item.kind === "cluster")
          ? "clusters"
          : "points",
        items,
        totalMatched: data.voters.length,
        assignmentTokenVersion: 7,
        precisionAdjusted: data.partial,
        truncatedGeoCellQuery: data.partial,
        ownerScanTruncated: false,
      });
    }
    if (path === `${API}/voters` && method === "GET") {
      if (data.failList)
        return reply({ error: "voter_list_temporarily_unavailable" }, 503);
      const q = (
        url.searchParams.get("q") ||
        url.searchParams.get("search") ||
        ""
      ).toLowerCase();
      const all = data.voters.filter((v) =>
        `${v.displayName} ${v.addressLine1}`.toLowerCase().includes(q),
      );
      if (data.listDelayByQuery[q])
        await new Promise((resolve) =>
          setTimeout(resolve, data.listDelayByQuery[q]),
        );
      const offset = Number(url.searchParams.get("cursor")) || 0,
        limit = Math.min(
          data.listPageSize,
          Number(url.searchParams.get("limit")) || 50,
        );
      const response = await reply({
        ok: true,
        items: all.slice(offset, offset + limit).map(connectedRecord),
        nextCursor: offset + limit < all.length ? String(offset + limit) : null,
      });
      data.completedListQueries.push(q);
      return response;
    }
    const recordMatch = path.match(
      new RegExp(`^${API}/voter-map/records/([^/]+)(?:/notes(?:/([^/]+))?)?$`),
    );
    if (recordMatch) {
      const id = decodeURIComponent(recordMatch[1]),
        record = data.voters.find((v) => v.recordId === id);
      if (!record) return reply({ error: "record_not_found" }, 404);
      if (!path.includes("/notes"))
        return reply({ ok: true, record: connectedRecord(record) });
      if (method === "GET")
        return reply(
          recordMatch[2]
            ? {
                ok: true,
                note: data.notes[id]?.find((n) => n.noteId === recordMatch[2]),
              }
            : {
                ok: true,
                items: clone(data.notes[id] || []).map((note) => {
                  const summary = { ...note };
                  delete summary.body;
                  return summary;
                }),
                nextCursor: null,
              },
        );
      const body = request.postDataJSON();
      data.writes.push({ path, method, body });
      if (data.failNote) return reply({ error: "note_save_failed" }, 503);
      if (
        !body.body?.trim() ||
        typeof body.contactType !== "string" ||
        !Array.isArray(body.tags)
      )
        return reply({ error: "invalid_note_contract" }, 400);
      const note = {
        noteId: `note-${Date.now()}`,
        recordId: id,
        body: body.body,
        preview: body.body.slice(0, 240),
        contactType: body.contactType,
        tags: body.tags,
        createdAt: Date.now(),
        author: { userId: "alex", displayName: "Alex Morgan" },
      };
      data.notes[id] ||= [];
      data.notes[id].unshift(note);
      return reply({ ok: true, note });
    }
    const assignmentMatch = path.match(
      new RegExp(
        `^${API}/voter-map/territories/([^/]+)/assignments(?:/([^/]+)/revoke)?$`,
      ),
    );
    if (assignmentMatch) {
      const id = assignmentMatch[1];
      if (!admin) return reply({ error: "forbidden" }, 403);
      if (method === "GET")
        return data.failAssignments
          ? reply({ error: "assignments_unavailable" }, 503)
          : reply({ ok: true, assignments: data.assignmentRows(id) });
      const body = request.postDataJSON();
      data.writes.push({ path, method, body });
      if (body.userId === data.failAssignmentForUser)
        return reply({ message: "One assignment could not be saved" }, 503);
      if (!PEOPLE.some((p) => p.userId === body.userId))
        return reply({ error: "ineligible_user" }, 400);
      if (assignmentMatch[2])
        data.assignments[id] = data.assignments[id].filter(
          (userId) => userId !== body.userId,
        );
      else if (!data.assignments[id].includes(body.userId))
        data.assignments[id].push(body.userId);
      data.unassigned = false;
      return reply({
        ok: true,
        assignment: data
          .assignmentRows(id)
          .find((row) => row.userId === body.userId) || {
          assignmentId: assignmentMatch[2],
          userId: body.userId,
          status: "revoked",
        },
      });
    }
    if (path === `${API}/voters/manual` && method === "POST") {
      const body = request.postDataJSON();
      data.writes.push({ path, method, body });
      if (data.manualOutOfScope)
        return reply({ ok: false, error: "out_of_scope" }, 403);
      if (
        (!body.name?.trim() && !body.displayName?.trim()) ||
        !body.addressLine1?.trim() ||
        !body.city?.trim() ||
        !body.state?.trim()
      )
        return reply({ error: "invalid_voter_record" }, 400);
      const existing = data.voters.find(
        (v) =>
          v.displayName === (body.name || body.displayName) &&
          v.addressLine1 === body.addressLine1,
      );
      if (existing && !body.duplicateMode)
        return reply(
          { error: "duplicate_exists", existing: connectedRecord(existing) },
          409,
        );
      if (existing) {
        if (body.duplicateMode === "replace")
          Object.assign(existing, body, {
            displayName: body.name || body.displayName,
          });
        return reply({
          ok: true,
          skipped: body.duplicateMode === "skip",
          duplicateMode: body.duplicateMode,
          record: connectedRecord(existing),
        });
      }
      const record = {
        ...clone(RAW_VOTERS[0]),
        ...body,
        recordId: `manual-${data.voters.length}`,
        displayName: body.name || body.displayName,
        pinStatus: "red",
      };
      data.voters.push(record);
      return reply({
        ok: true,
        record: connectedRecord(record),
        skipped: false,
      });
    }
    if (path.startsWith(`${API}/voter-imports`)) {
      if (method !== "GET")
        data.writes.push({ path, method, body: request.postDataJSON() });
      if (/upload/.test(path))
        return reply({
          ok: true,
          uploadId: "upload-fixture",
          upload: {
            uploadUrl: `${BASE_URL}/__fieldwork-upload`,
            method: "PUT",
            headers: { "content-type": "text/csv" },
          },
        });
      if (/preview/.test(path))
        return reply({
          ok: true,
          summary: {
            totalRows: 3,
            validRows: 2,
            invalidRows: 1,
            duplicateWithinUploadRows: 0,
            duplicateExistingRows: 1,
            truncated: false,
          },
          duplicates: {
            inUpload: [],
            existing: [{ recordId: "v1", displayName: "Avery Collins" }],
          },
          items: [
            {
              rowNumber: 2,
              status: "valid",
              recordId: "import-new",
              displayName: "Peyton Clarke",
              addressLine1: "156 Cedar Avenue",
            },
            {
              rowNumber: 3,
              status: "duplicate_existing",
              recordId: "v1",
              displayName: "Avery Collins",
            },
          ],
        });
      if (method === "POST")
        return reply({ ok: true, importId: "import-fixture" });
      if (!data.importApplied) {
        data.voters.push({
          ...clone(RAW_VOTERS[0]),
          recordId: "import-new",
          displayName: "Peyton Clarke",
          addressLine1: "156 Cedar Avenue",
        });
        data.importApplied = true;
      }
      return reply({
        ok: true,
        job: {
          importId: "import-fixture",
          status: "completed",
          processedRows: 3,
          importedCount: 1,
          skippedDuplicateCount: 1,
          invalidRows: 1,
          totalRows: 3,
        },
      });
    }
    if (path === `${API}/voter-map/territories` && method === "GET")
      return reply({ ok: true, territories: clone(data.territories) });
    if (path.startsWith(`${API}/voter-map/territory-builder`)) {
      if (method === "GET")
        return reply({
          ok: true,
          protocolVersion: 2,
          revision: data.builderRevision,
          areas: [
            { id: "area", name: "Cedar Valley area", geojson: AREA },
            ...data.territories
              .filter((t) => t.builderId)
              .map((t) => ({
                id: t.territoryId,
                name: t.name,
                geojson: t.builderGeojson || t.geojson,
                source: "territory",
                version: t.version,
                status: t.status,
              })),
          ],
          boundary: AREA,
          points: [],
          staff: clone(PEOPLE),
          draft: clone(data.builderDraft),
          ...(data.fieldHandoff
            ? { fieldHandoff: clone(data.fieldHandoff) }
            : {}),
          existingTerritories: data.territories.map((t) => ({
            ...t,
            builderManaged: !!t.builderId,
          })),
          source: {
            status: "ready",
            snapshotId: "a".repeat(64),
            mappedAddressCount: 12,
            unmappedRecordCount: 2,
            complete: true,
          },
          limits: { maxTerritories: 12 },
        });
      const body = request.postDataJSON();
      if (path.endsWith("/source"))
        return reply({
          ok: true,
          status: "ready",
          snapshotId: "a".repeat(64),
          complete: true,
        });
      if (path.endsWith("/points"))
        return reply({
          ok: true,
          points: data.voters.map((v) => ({
            id: v.recordId,
            coordinates: [v.lng, v.lat],
            count: 1,
          })),
          source: {
            status: "ready",
            snapshotId: "a".repeat(64),
            complete: true,
          },
          viewportComplete: true,
          clustered: false,
        });
      data.writes.push({ path, method, body });
      if (!admin || !data.authoring) return reply({ error: "forbidden" }, 403);
      if (body.revision !== data.builderRevision)
        return reply({ message: "territory_builder_revision_conflict" }, 409);
      if (path.endsWith("/preview")) {
        const count = Math.max(1, Math.min(12, body.targetCount || 2));
        const ring =
          body.areaGeojson?.type === "Polygon"
            ? body.areaGeojson.coordinates[0]
            : AREA.coordinates[0];
        const west = Math.min(...ring.map((p) => p[0])),
          east = Math.max(...ring.map((p) => p[0])),
          south = Math.min(...ring.map((p) => p[1])),
          north = Math.max(...ring.map((p) => p[1]));
        const territories = ["auto", "guided", "split"].includes(body.mode)
          ? Array.from({ length: count }, (_, i) => ({
              id: `plan-${i}`,
              name: `Territory ${i + 1}`,
              geojson: rectangle(
                west + (i * (east - west)) / count,
                south,
                west + ((i + 1) * (east - west)) / count,
                north,
              ),
              trimGeometry: null,
              locked: false,
              assigneeUserId: null,
              addressCount: 4,
            }))
          : (body.territories || []).map((t) => ({ ...t, addressCount: 4 }));
        return reply({
          ok: true,
          snapshotId: "a".repeat(64),
          planHash: "b".repeat(64),
          territories,
          summary: {
            totalAddressCount: 12,
            eligibleAddressCount: 10,
            excludedAddressCount: 2,
            allocatedAddressCount: 10,
            unallocatedAddressCount: 0,
          },
        });
      }
      if (path.endsWith("/publish") && data.builderConflict)
        return reply({ message: "territory_builder_revision_conflict" }, 409);
      if (
        path.endsWith("/publish") &&
        (body.territories || []).some(
          (t) => !PEOPLE.some((p) => p.userId === t.assigneeUserId),
        )
      )
        return reply({ error: "territory_assignment_required" }, 400);
      data.builderDraft = {
        areaGeojson: body.areaGeojson,
        territories: clone(body.territories),
        contactExclusions: clone(body.contactExclusions),
        startsAt: body.startsAt,
      };
      data.builderRevision++;
      if (path.endsWith("/publish"))
        for (const row of body.territories) {
          const existing = data.territories.find((t) => t.builderId === row.id);
          const record = {
            territoryId: existing?.territoryId || `published-${row.id}`,
            name: row.name,
            geojson: clone(row.geojson),
            builderGeojson: clone(row.geojson),
            version: (existing?.version || 0) + 1,
            status: "published",
            builderId: row.id,
          };
          data.territories = data.territories.filter(
            (t) => t.territoryId !== record.territoryId,
          );
          data.territories.push(record);
          data.assignments[record.territoryId] = [row.assigneeUserId];
        }
      return reply({
        ok: true,
        revision: data.builderRevision,
        draft: clone(data.builderDraft),
        territories: clone(body.territories),
        published: path.endsWith("/publish"),
        ...(path.endsWith("/publish") && data.fieldHandoff
          ? { fieldHandoff: clone(data.fieldHandoff) }
          : {}),
      });
    }
    if (method !== "GET" && path.startsWith(API)) {
      data.unexpectedWrites.push({ path, method, body: request.postData() });
      return reply({ error: "unexpected_fieldwork_fixture_write" }, 400);
    }
    return route.fallback();
  });
  return data;
}

module.exports = {
  BASE_URL,
  COALITION_ID,
  COALITION_PATH,
  API,
  AREA,
  PEOPLE,
  TERRITORIES,
  RAW_VOTERS,
  mockFieldworkWorkspace,
};
