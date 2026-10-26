import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../frontend/src/pages/shared-feed/shared-feed.js", import.meta.url),
  "utf8",
);
const normalizeString = (value) => String(value ?? "").trim();
const readArrayPayload = (payload, keys) =>
  keys.map((key) => payload?.[key]).find(Array.isArray) || [];

/** Execute the actual legacy boundary function with in-memory dependencies. */
function functionWithDependencies(name, next, dependencies) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = source.indexOf(next, start);
  assert.ok(end > start, `${name} boundary exists`);
  const declaration = source.slice(
    source.slice(Math.max(0, start - 6), start) === "async "
      ? start - 6
      : start,
    end,
  );
  return new Function(
    ...Object.keys(dependencies),
    `${declaration}\nreturn ${name};`,
  )(...Object.values(dependencies));
}

const pickup = functionWithDependencies(
  "coalitionCtaTransportPickupPayload",
  "\nasync function loadCoalitionCtaEvents(",
  { normalizeString },
);

test("pickup address without optional coordinates never becomes 0,0", () => {
  const form = new FormData();
  form.set("groupId", "west-entrance");
  form.set("name", "West entrance");
  form.set("address", "123 Example Street");
  form.set("lat", " ");
  form.set("lng", "");
  const body = pickup(form);
  assert.equal(body.pickupLocation.name, "West entrance");
  assert.equal(body.pickupLocation.address, "123 Example Street");
  assert.equal(Object.hasOwn(body.pickupLocation, "lat"), false);
  assert.equal(Object.hasOwn(body.pickupLocation, "lng"), false);
});

test("explicit zero pickup coordinates remain valid supplied coordinates", () => {
  const form = new FormData();
  form.set("groupId", "equator");
  form.set("lat", "0");
  form.set("lng", "0");
  assert.deepEqual(pickup(form).pickupLocation, {
    name: "",
    address: "",
    lat: 0,
    lng: 0,
  });
});

test("pickup coordinates must form a complete finite geographic pair", () => {
  for (const [lat, lng] of [
    ["46.86", ""],
    ["", "-114.01"],
    ["abc", "-114.01"],
    ["91", "0"],
    ["0", "181"],
  ]) {
    const form = new FormData();
    form.set("groupId", "west");
    form.set("lat", lat);
    form.set("lng", lng);
    assert.throws(() => pickup(form), undefined, `${lat}/${lng} is rejected`);
  }
});

function directoryLoader(fetchJson) {
  const directory = {
    loading: false,
    loaded: false,
    error: "",
    filters: {},
    members: [],
  };
  const load = functionWithDependencies(
    "loadCoalitionDirectory",
    "\nfunction coalitionDirectoryFiltersFromForm(",
    {
      decodeRouteSegment: normalizeString,
      coalitionDirectoryWorkspace: () => directory,
      currentCoalitionDetailId: () => "cedar-valley",
      currentAuthUserId: () => "alex",
      captureCoalitionFieldToolRequest: () => () => true,
      scheduleRender() {},
      buildCoalitionDirectoryMembersQuery: () => new URLSearchParams(),
      fetchJson,
      normalizeCoalitionDirectoryCatalog: (value) => value,
      readArrayPayload,
      normalizeCoalitionDirectoryMember: (value) => value,
      settingsErrorMessage: (error, fallback) => error.message || fallback,
    },
  );
  return { directory, load };
}

test("directory member-list failure remains visible when its catalog succeeds", async () => {
  const { load, directory } = directoryLoader(async (url) => {
    if (url.endsWith("/catalog")) return { categories: [] };
    throw new Error("Member list is temporarily unavailable");
  });
  await load("cedar-valley");
  assert.match(directory.error, /Member list is temporarily unavailable/);
  assert.equal(directory.loading, false);
});

test("a successfully loaded empty directory is distinguishable from failure", async () => {
  const { load, directory } = directoryLoader(async (url) =>
    url.endsWith("/catalog") ? { categories: [] } : { items: [] },
  );
  await load("cedar-valley");
  assert.equal(directory.error, "");
  assert.equal(directory.loaded, true);
  assert.deepEqual(directory.members, []);
});

test("coalition CTA events traverse authoritative global pagination", async () => {
  const cta = { loading: false, loaded: false, error: "", events: [] };
  const calls = [];
  const event = {
    eventId: "cedar-canvass",
    hostCoalitionId: "cedar-valley",
    eventType: "cta",
    ctaType: "canvass",
  };
  const load = functionWithDependencies(
    "loadCoalitionCtaEvents",
    "\nasync function refreshCoalitionCtaEvents(",
    {
      decodeRouteSegment: normalizeString,
      coalitionCtaWorkspace: () => cta,
      currentCoalitionDetailId: () => "cedar-valley",
      currentAuthUserId: () => "alex",
      captureCoalitionFieldToolRequest: () => () => true,
      scheduleRender() {},
      fetchJson: async (url) => {
        calls.push(url);
        if (url.startsWith("/api/coalitions/cedar-valley/cta/events"))
          throw new Error(
            "No GET route is registered for coalition CTA events",
          );
        if (new URL(url, "https://fixture.test").searchParams.has("cursor"))
          return { items: [event], nextCursor: null };
        return {
          items: Array.from({ length: 100 }, (_, index) => ({
            eventId: `other-${index}`,
            hostCoalitionId: "other-coalition",
            eventType: "cta",
          })),
          nextCursor: "next-page",
        };
      },
      readArrayPayload,
      normalizeString,
      normalizeCoalitionCtaEvent: (value) => value,
      settingsErrorMessage: (error, fallback) => error.message || fallback,
    },
  );
  await load("cedar-valley");
  assert.equal(cta.error, "");
  assert.equal(cta.loaded, true);
  assert.deepEqual(
    cta.events.map((item) => item.eventId),
    [event.eventId],
  );
  assert.equal(calls.length, 2);
  assert.equal(
    new URL(calls[1], "https://fixture.test").searchParams.get("cursor"),
    "next-page",
  );
});
