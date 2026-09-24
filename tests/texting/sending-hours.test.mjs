import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";

const { createCampaigns } = await import(await moduleUrl("textingCampaigns"));
const { createTextingIntakePage } = await import(
  await moduleUrl("textingIntake")
);
const { readSchedule } = await import(await moduleUrl("textingSchedule"));
const schedule = {
  revision: 4,
  timeZone: "America/Denver",
  startTime: "08:00",
  endTime: "20:00",
  status: "verified",
  timeZoneEditable: false,
};
const campaign = {
  campaignId: "campaign-one",
  name: "Example campaign",
  status: "paused",
  revision: 7,
  templateText: "Example Civic Team. Reply STOP to opt out.",
  effectiveDeliverySchedule: schedule,
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function browser(t) {
  const previousDocument = globalThis.document,
    previousFormData = globalThis.FormData,
    listeners = new Map();
  globalThis.document = {
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  globalThis.FormData = class {
    constructor(form) {
      this.values = form.values;
    }
    get(name) {
      return this.values[name];
    }
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    globalThis.FormData = previousFormData;
  });
  return listeners;
}

test("campaign list views use server filters and preserve pagination through an empty archived page", async () => {
  const view = {},
    calls = [];
  const page = createCampaigns({
    view: () => view,
    can: () => false,
    busy: () => false,
    context: () => ({}),
    api: async (route, body) => {
      calls.push({ route, body });
      if (route === "/campaigns?view=archived")
        return { items: [], nextCursor: "older/page" };
      return {
        items: [
          {
            ...campaign,
            status: route.includes("archived") ? "archived" : "paused",
          },
        ],
      };
    },
  });
  await page.load(undefined, "campaigns");
  await page.action("campaigns-view", "paused");
  await page.action("campaigns-view", "archived");
  assert.match(
    page.render("campaigns"),
    /Archived campaigns keep their messages, results and history/,
  );
  assert.match(page.render("campaigns"), /Load more/);
  await page.action("campaigns-more");
  assert.match(page.render("campaigns"), /Example campaign/);
  assert.deepEqual(
    calls.map(({ route }) => route),
    [
      "/campaigns?view=active",
      "/campaigns?view=paused",
      "/campaigns?view=archived",
      "/campaigns?view=archived&cursor=older%2Fpage",
    ],
  );
  assert.equal(
    calls.every(({ body }) => body === undefined),
    true,
  );
});

test("paused campaign hours use their own revision-checked PATCH, with inherited and bounded daily times", async (t) => {
  browser(t);
  const calls = [],
    view = { campaigns: { campaign: { ...campaign }, schedule } };
  const page = createCampaigns({
    view: () => view,
    can: () => true,
    busy: () => false,
    context: () => ({ resourceId: campaign.campaignId }),
    toast: () => {},
    api: async (route, body, method) => {
      calls.push({ route, body, method });
      return { campaign: { ...campaign, ...body, revision: 8 } };
    },
  });
  const form = {
    values: {
      dailyHoursMode: "custom",
      sendingTimeZone: "Pacific/Honolulu",
      sendingStart: "09:00",
      sendingEnd: "19:00",
    },
  };
  await page.submit("campaign-hours", form);
  assert.deepEqual(calls[0], {
    route: "/campaigns/campaign-one/delivery-schedule",
    method: "PATCH",
    body: {
      expectedRevision: 7,
      deliverySchedule: {
        timeZone: "America/Denver",
        startTime: "09:00",
        endTime: "19:00",
      },
    },
  });
  form.values.sendingStart = "07:00";
  await assert.rejects(
    page.submit("campaign-hours", form),
    /inside organization hours/,
  );
  assert.equal(calls.length, 1);
  form.values.dailyHoursMode = "organization";
  await page.submit("campaign-hours", form);
  assert.equal(calls[1].body.deliverySchedule, null);
  assert.equal(calls[1].body.expectedRevision, 8);
  view.campaigns.campaign.status = "active";
  await assert.rejects(
    page.submit("campaign-hours", form),
    /Pause this campaign/,
  );
  assert.equal(calls.length, 2);
  assert.throws(
    () =>
      readSchedule(
        { values: { sendingStart: "20:00", sendingEnd: "08:00" } },
        schedule,
      ),
    /after the start/,
  );
});

test("organization hours are admin-only, use the reviewed timezone, and ignore a late save after the organization changes", async (t) => {
  const listeners = browser(t),
    calls = [];
  let admin = false,
    resolveSave;
  let context = {
    organizationId: "org-one",
    userId: "user-one",
    section: "settings",
  };
  const page = createTextingIntakePage({
    context: () => context,
    changed: () => {},
    navigate: () => {},
    request: async (route, options) => {
      calls.push({ route, options });
      if (options.method === "PUT")
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      if (route.endsWith("/workspace"))
        return {
          ok: true,
          workspace: { capabilities: { manageBilling: admin } },
        };
      if (route.endsWith("/delivery-schedule"))
        return { ok: true, schedule, canManage: admin };
      return { ok: true, intake: null };
    },
  });
  t.after(() => page.reset());
  const form = {
    values: {
      sendingTimeZone: "Pacific/Honolulu",
      sendingStart: "09:00",
      sendingEnd: "19:00",
    },
    matches: () => true,
    reportValidity: () => true,
    closest: () => ({ dataset: { intakeRoot: "user-one:org-one" } }),
  };
  const submit = () =>
    listeners.get("submit")({ target: form, preventDefault: () => {} });
  await page.load();
  assert.doesNotMatch(page.render(), /data-intake-schedule/);
  submit();
  await flush();
  assert.equal(
    calls.some(({ options }) => options.method === "PUT"),
    false,
  );
  admin = true;
  await page.load({ force: true });
  assert.match(page.render(), /name="sendingTimeZone"[^>]*readonly/);
  submit();
  await flush();
  const save = calls.find(({ options }) => options.method === "PUT");
  assert.deepEqual(save.options.body, {
    expectedRevision: 4,
    timeZone: "America/Denver",
    startTime: "09:00",
    endTime: "19:00",
  });
  context = { ...context, organizationId: "org-two" };
  page.reset();
  resolveSave({
    ok: true,
    schedule: { ...schedule, revision: 5 },
    canManage: true,
  });
  await flush();
  assert.doesNotMatch(
    page.render(),
    /Organization sending hours saved|America\/Denver/,
  );
  assert.deepEqual(page.getMeta(), {});
});

test("reviewing an uncertain organization schedule sends only the exact saved hours and current revision", async (t) => {
  const listeners = browser(t),
    calls = [];
  const pending = {
    ...schedule,
    revision: 5,
    status: "needs_review",
    startTime: "09:00",
    endTime: "19:00",
  };
  const page = createTextingIntakePage({
    context: () => ({
      organizationId: "org-one",
      userId: "admin",
      section: "settings",
    }),
    changed: () => {},
    navigate: () => {},
    request: async (route, options) => {
      calls.push({ route, options });
      if (route.endsWith("/workspace"))
        return {
          ok: true,
          workspace: { capabilities: { manageBilling: true } },
        };
      if (route.endsWith("/delivery-schedule"))
        return {
          ok: true,
          canManage: true,
          schedule:
            options.method === "PUT"
              ? { ...pending, status: "verified", revision: 6 }
              : pending,
        };
      return { ok: true, intake: null };
    },
  });
  t.after(() => page.reset());
  await page.load();
  assert.match(page.render(), /Check saved hours/);
  assert.match(page.render(), /disabled>Save organization hours/);
  assert.equal(calls.filter(({ options }) => options.method).length, 0);
  const target = {
    dataset: { intakeAction: "check-hours" },
    closest: () => ({ dataset: { intakeRoot: "admin:org-one" } }),
  };
  listeners.get("click")({
    target: { closest: () => target },
    preventDefault: () => {},
  });
  await flush();
  const writes = calls.filter(({ options }) => options.method);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.method, "PUT");
  assert.deepEqual(writes[0].options.body, {
    expectedRevision: 5,
    timeZone: "America/Denver",
    startTime: "09:00",
    endTime: "19:00",
  });
  assert.match(page.render(), /Organization sending hours saved/);
  assert.doesNotMatch(page.render(), /Check saved hours/);
});
