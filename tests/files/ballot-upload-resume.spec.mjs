import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scripts = new URL(
  "../../frontend/src/pages/shared-feed/scripts/",
  import.meta.url,
);
const stubs = new Map(
  Object.entries({
    organizationContactsApi:
      "export const createOrganizationContactsApi=()=>({});",
    organizationContactBook:
      "export const createOrganizationContactBook=()=>({});",
    organizationContactCities: "export const loadContactCities=async()=>[];",
    ballotChaserCanvassing:
      'export const createBallotChaserCanvassing=()=>({reset(){},render(){return "";}});',
    ballotRegister: "export const createBallotRegister=()=>({});",
    textingBallotRecipients: "export const readBallotTextingAccess=()=>({});",
  }),
);
const modules = new Map();
const dataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function moduleUrl(url) {
  const name = url.pathname.split("/").at(-1).replace(/\.js$/, "");
  if (stubs.has(name)) return dataUrl(stubs.get(name));
  if (modules.has(url.href)) return modules.get(url.href);
  let source = (await readFile(url, "utf8"))
    .replace(/^import\s+"[^"\n]+\.css";\r?\n/gm, "")
    .replace(
      'new URL("./ballotPreparation.worker.js", import.meta.url)',
      '"https://fixture.invalid/ballotPreparation.worker.js"',
    );
  for (const match of [...source.matchAll(/from "(\.\.?\/[^"\n]+)"/g)]) {
    const dependency = new URL(
      /\.\w+$/.test(match[1]) ? match[1] : `${match[1]}.js`,
      url,
    );
    source = source.replaceAll(
      match[0],
      `from "${await moduleUrl(dependency)}"`,
    );
  }
  const result = dataUrl(source);
  modules.set(url.href, result);
  return result;
}
const { createBallotChaser } = await import(
  await moduleUrl(new URL("ballotChaser.js", scripts))
);

const countyColumns = ["VOTERID", "CONDIST", "PARTY", "BALSTATUS", "ELECTDATE"];
const capacity = {
  enabled: true,
  version: "bounded_v1",
  maxRows: 125000,
  maxSourceBytes: 50000000,
  maxColumns: 55,
  maxHeaderBytes: 64,
};
const sentUpdates = {
  enabled: true,
  maxRows: 5000,
  maxSourceBytes: 5000000,
  idColumn: "VOTERID",
  districtColumn: "CONDIST",
  districtValue: "8",
  partyColumn: "PARTY",
  partyValues: ["IND", "PND"],
  statusColumn: "BALSTATUS",
  issuedValue: "S",
  electionDateColumn: "ELECTDATE",
};
const savedJob = (status = "awaiting_mapping") => ({
  importId: "existing-county-upload",
  electionId: "c4d-election",
  fileName: "prepared-sent-ballots.csv",
  status,
  createdAt: new Date().toISOString(),
  sourceAsOf: "2026-10-27T00:00:00.000Z",
  preparation: { mode: "sent", snapshotId: "published-snapshot" },
  preparationPolicy: capacity,
  columns: countyColumns,
  counts: { rows: 1, newVoters: 1, conflicts: 0 },
});
const countyFile = () =>
  new File(
    [
      "VOTERID,CONDIST,PARTY,BALSTATUS,ELECTDATE\r\n0002,8,IND,S,11/03/2026\r\n",
    ],
    "county-sent.csv",
    { type: "text/csv" },
  );

function fixture(t, { initialJob = null } = {}) {
  const savedGlobals = new Map(
    ["document", "FormData", "Worker", "fetch"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const calls = [],
    workerCalls = [],
    listeners = new Map();
  let job = initialJob && structuredClone(initialJob),
    publishedSnapshot = "published-snapshot",
    importsReadCount = 0,
    beforeImportsRead = () => {},
    scopePages = null,
    rejectExport = false,
    successfulExports = 0,
    controller;
  const election = {
    electionId: "c4d-election",
    name: "C4D controlled election fixture",
    electionDate: "2026-11-03",
    state: "AZ",
    county: "Maricopa",
    storageMode: "register",
    preparationPolicy: capacity,
    preparationColumns: countyColumns,
    activeSnapshotId: publishedSnapshot,
    sourcePolicy: { permittedPurpose: "manual_sms", reviewRequired: false },
  };
  globalThis.document = {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
  };
  globalThis.FormData = class extends Map {
    constructor(form) {
      super(Object.entries(form.values));
    }
    getAll(name) {
      const value = this.get(name);
      return value === undefined ? [] : Array.isArray(value) ? value : [value];
    }
  };
  globalThis.Worker = class {
    terminate() {
      this.stopped = true;
    }
    postMessage(message) {
      workerCalls.push(message);
      const result =
        message.action === "inspect"
          ? {
              headers: countyColumns,
              sample: [["0002", "8", "IND", "S", "11/03/2026"]],
              delimiter: "comma",
              encoding: "utf-8",
            }
          : message.action === "ids"
            ? ["0001"]
            : {
                blob: new Blob([
                  countyColumns.join(",") + "\r\n0002,8,IND,S,11/03/2026\r\n",
                ]),
                receipt: {
                  inputRows: 1,
                  selectedRows: 1,
                  excludedRows: 0,
                  existingRows: 0,
                  outsideRows: 0,
                  voidedRows: 0,
                  duplicateRows: 0,
                  conflictingIds: 0,
                },
              };
      queueMicrotask(() => {
        if (!this.stopped)
          this.onmessage({ data: { id: message.id, type: "result", result } });
      });
    }
  };
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    if (options.method === "PUT")
      return new Response("", { headers: { etag: '"fixture-upload"' } });
    assert.match(String(url), /fixture-private\.s3\./);
    return new Response("ballotVoterId\r\n0001\r\n");
  };
  const response = (value) => ({ ok: true, ...structuredClone(value) });
  controller = createBallotChaser({
    context: () => ({
      userId: "fixture-staff",
      scopeType: "coalition",
      scopeId: "ns7aq23r",
      section: "ballot-chaser",
    }),
    changed: () => {},
    request: async (path, options = {}) => {
      options.beforeRequest?.();
      const url = new URL(path, "https://fixture.invalid"),
        suffix = url.pathname.split("/ballot-chaser")[1],
        method = options.method || "GET";
      calls.push({ path, suffix, method, body: options.body });
      if (url.pathname.endsWith("/schema"))
        return response({
          capabilities: {
            read: true,
            import: true,
            export: true,
            ballotChaser: true,
            manage: true,
          },
          fields: [],
        });
      if (suffix === "/elections")
        return response({
          items: [election],
          preparationAvailability: { ...capacity, sentUpdates },
        });
      if (suffix === "/elections/c4d-election") return response({ election });
      if (suffix === "/elections/c4d-election/dashboard")
        return response({
          dashboard: {
            snapshotId: publishedSnapshot,
            total: publishedSnapshot === "published-snapshot" ? 1 : 2,
            outstanding: 1,
            returned: 0,
          },
        });
      if (suffix === "/imports" && method === "GET") {
        beforeImportsRead(++importsReadCount);
        if (scopePages && !url.searchParams.has("electionId")) {
          const page = Number(url.searchParams.get("cursor") || 0);
          return response({
            items: scopePages[page],
            nextCursor: page + 1 < scopePages.length ? String(page + 1) : null,
          });
        }
        return response({ items: job ? [job] : [], nextCursor: null });
      }
      if (suffix === "/imports" && method === "POST") {
        job = { ...savedJob("uploading"), sizeBytes: options.body.sizeBytes };
        return response({ import: job });
      }
      if (suffix?.endsWith("/upload-start"))
        return response({
          upload: {
            method: "MULTIPART",
            uploadId: "fixture-upload",
            partSizeBytes: 8 * 1024 * 1024,
            completedParts: [],
            parts: [
              {
                partNumber: 1,
                sizeBytes: job.sizeBytes,
                url: "https://fixture-private.s3.us-west-2.amazonaws.com/upload",
              },
            ],
          },
        });
      if (suffix?.endsWith("/upload-complete"))
        return response({ import: job });
      if (suffix?.endsWith("/inspect")) {
        job.status = "awaiting_mapping";
        return response({ import: job });
      }
      if (suffix?.endsWith("/mapping")) {
        job.status = "reviewing";
        job.processingPhase = "comparing";
        return response({ import: job });
      }
      if (suffix?.endsWith("/apply")) {
        assert.equal(job.status, "review_ready");
        job.status = "complete";
        job.processingPhase = "complete";
        publishedSnapshot = job.importId;
        return response({ import: job });
      }
      if (suffix === "/imports/existing-county-upload")
        return response({ import: job });
      if (
        suffix === "/elections/c4d-election/exports" ||
        suffix === "/exports/private-ids"
      ) {
        if (method === "POST") {
          if (rejectExport) {
            rejectExport = false;
            job = savedJob();
            throw Object.assign(new Error("Concurrent upload appeared"), {
              status: 409,
              payload: { error: "ballot_preparation_job_active" },
            });
          }
          successfulExports++;
        }
        return response({
          export: {
            exportId: "private-ids",
            status: "ready",
            rows: 1,
            snapshotId: publishedSnapshot,
          },
          download: {
            method: "GET",
            url: "https://fixture-private.s3.us-west-2.amazonaws.com/ids.csv",
            expiresAt: Date.now() + 60000,
          },
        });
      }
      throw new Error(`Unexpected fixture request: ${method} ${path}`);
    },
  });
  t.after(() => {
    controller.reset();
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    controller,
    calls,
    workerCalls,
    setJob(value) {
      job = value && structuredClone(value);
    },
    setStatus(status) {
      job.status = status;
      job.processingPhase = status;
    },
    setScopePages(pages) {
      scopePages = structuredClone(pages);
    },
    rejectNextExport() {
      rejectExport = true;
    },
    successfulExports: () => successfulExports,
    appearBeforeIdExport() {
      const initialReads = importsReadCount;
      beforeImportsRead = (reads) => {
        if (reads === initialReads + 2) job = savedJob();
      };
    },
    async submit(type, values = {}, file) {
      const form = {
        dataset: { ballotForm: type },
        values,
        matches: () => false,
        closest: () => ({ dataset: { ballotKey: controller.state().key } }),
        reportValidity: () => true,
        querySelector: () => (file ? { files: [file] } : null),
      };
      for (const listener of listeners.get("submit") || [])
        listener({ target: form, preventDefault() {} });
      for (
        let attempts = 0;
        controller.state().busy && attempts < 100;
        attempts++
      )
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        controller.state().busy,
        false,
        "fixture action must finish",
      );
    },
  };
}
const admissions = (harness) =>
  harness.calls.filter(
    (call) =>
      call.method === "POST" &&
      (call.suffix === "/imports" || call.suffix?.endsWith("/exports")),
  );
const buttonFor = (html, caption) => {
  for (const [, attributes, text] of html.matchAll(
    /<button\b([^>]*)>(.*?)<\/button>/gs,
  ))
    if (text === caption)
      return {
        action: /data-workspace-action="([^"]+)"/.exec(attributes)?.[1],
        value: /data-value="([^"]*)"/.exec(attributes)?.[1],
      };
  assert.fail(`Expected visible ${caption} action`);
};

test("an uploaded county file awaiting mapping resumes its existing column review without another import or export", async (t) => {
  const h = fixture(t, { initialJob: savedJob() });
  await h.controller.load();
  const html = h.controller.render();
  assert.match(html, /Your uploaded file is waiting for column review/);
  assert.match(html, /Waiting for your review/);
  const resume = buttonFor(html, "Resume review");
  await h.controller.action(resume.action, resume.value);
  assert.equal(h.controller.state().job.importId, "existing-county-upload");
  assert.match(h.controller.render(), /data-ballot-form="mapping"/);
  await h.controller.action("ballot-sent-open");
  assert.equal(h.controller.state().job.importId, "existing-county-upload");
  assert.match(h.controller.render(), /data-ballot-form="mapping"/);
  assert.deepEqual(admissions(h), []);
  assert.deepEqual(h.workerCalls, []);
});

test("an unfinished upload discovered before local preparation sends the user back without scanning another file", async (t) => {
  const h = fixture(t);
  await h.controller.load();
  await h.controller.action("ballot-upload-open");
  h.setJob(savedJob());
  await h.submit(
    "prepare-source",
    { delimiter: "comma", encoding: "utf-8" },
    countyFile(),
  );
  assert.match(
    h.controller.render(),
    /Your uploaded file is waiting for column review/,
  );
  assert.deepEqual(admissions(h), []);
  assert.deepEqual(h.workerCalls, []);
});

test("an upload appearing after the preparation recheck is caught before creating another private voter-ID export", async (t) => {
  const h = fixture(t);
  await h.controller.load();
  await h.controller.action("ballot-sent-open");
  await h.submit(
    "prepare-source",
    { delimiter: "comma", encoding: "utf-8" },
    countyFile(),
  );
  assert.deepEqual(
    h.workerCalls.map((call) => call.action),
    ["inspect"],
  );
  h.appearBeforeIdExport();
  await h.submit("prepare-review", {
    headersReviewed: "on",
    idColumn: "VOTERID",
  });
  assert.match(
    h.controller.render(),
    /Your uploaded file is waiting for column review/,
  );
  assert.deepEqual(admissions(h), []);
  assert.deepEqual(
    h.workerCalls.map((call) => call.action),
    ["inspect"],
  );
});

test("normal sent-file completion immediately shows column review and requires explicit Apply after processing", async (t) => {
  const h = fixture(t);
  await h.controller.load();
  await h.controller.action("ballot-sent-open");
  await h.submit(
    "prepare-source",
    { delimiter: "comma", encoding: "utf-8" },
    countyFile(),
  );
  await h.submit("prepare-review", {
    headersReviewed: "on",
    idColumn: "VOTERID",
  });
  assert.equal(h.controller.state().error, "");
  await h.submit("prepare-upload", {
    preparedReviewed: "on",
    sourceAsOf: "2026-10-27",
  });
  assert.equal(h.controller.state().error, "");
  assert.match(
    h.controller.render(),
    /Your uploaded file is waiting for column review/,
  );
  assert.match(h.controller.render(), /data-ballot-form="mapping"/);
  await h.submit("mapping", {
    voterIdColumn: "VOTERID",
    rowStatusMeans: "issued",
  });
  assert.match(h.controller.render(), /Processing/);
  assert.equal(
    h.calls.filter((call) => call.suffix?.endsWith("/apply")).length,
    0,
  );
  h.setStatus("review_ready");
  await h.controller.action("ballot-job-refresh");
  assert.match(h.controller.render(), /Ready to apply/);
  assert.doesNotMatch(h.controller.render(), /Processing your file/);
  assert.ok(buttonFor(h.controller.render(), "Apply reviewed county update"));
  assert.equal(
    h.calls.filter((call) => call.suffix?.endsWith("/apply")).length,
    0,
  );
  await h.controller.action("ballot-apply");
  assert.equal(h.controller.state().job.status, "complete");
  assert.match(h.controller.render(), /Complete/);
  assert.doesNotMatch(h.controller.render(), /Processing your file/);
  assert.doesNotMatch(h.controller.render(), />Apply reviewed county update</);
  assert.equal(
    h.calls.filter(
      (call) => call.suffix === "/imports" && call.method === "POST",
    ).length,
    1,
  );
  assert.equal(
    h.calls.filter(
      (call) => call.suffix?.endsWith("/exports") && call.method === "POST",
    ).length,
    1,
  );
  assert.equal(
    h.calls.filter((call) => call.suffix?.endsWith("/apply")).length,
    1,
  );
});

test("unfinished-upload checks follow scope history pages before preparing another file", async (t) => {
  const h = fixture(t);
  await h.controller.load();
  h.setJob(savedJob());
  h.setScopePages([
    [{ ...savedJob("complete"), importId: "finished-update" }],
    [savedJob()],
  ]);
  await h.controller.action("ballot-upload-open");
  assert.equal(h.controller.state().job.importId, "existing-county-upload");
  assert.match(h.controller.render(), /data-ballot-form="mapping"/);
  assert.ok(h.calls.some((call) => call.path.endsWith("/imports?cursor=1")));
  assert.deepEqual(admissions(h), []);
  assert.deepEqual(h.workerCalls, []);
});

test("a concurrent-upload admission rejection resumes the uploaded review rather than retrying the ID export", async (t) => {
  const h = fixture(t);
  await h.controller.load();
  await h.controller.action("ballot-sent-open");
  await h.submit(
    "prepare-source",
    { delimiter: "comma", encoding: "utf-8" },
    countyFile(),
  );
  h.rejectNextExport();
  await h.submit("prepare-review", {
    headersReviewed: "on",
    idColumn: "VOTERID",
  });
  assert.equal(h.controller.state().error, "");
  assert.equal(h.controller.state().job.importId, "existing-county-upload");
  assert.match(h.controller.render(), /data-ballot-form="mapping"/);
  assert.equal(
    admissions(h).length,
    1,
    "one rejected attempt is never replayed",
  );
  assert.equal(h.successfulExports(), 0);
  assert.deepEqual(
    h.workerCalls.map((call) => call.action),
    ["inspect"],
  );
});

test("preparing the original source can resume its own paused upload without admitting a replacement upload", async (t) => {
  const h = fixture(t, {
    initialJob: { ...savedJob("uploading"), sizeBytes: countyFile().size },
  });
  await h.controller.load();
  await h.controller.action("ballot-job", "existing-county-upload");
  await h.controller.action("ballot-prepare-resume");
  await h.submit(
    "prepare-source",
    { delimiter: "comma", encoding: "utf-8" },
    countyFile(),
  );
  await h.submit("prepare-review", {
    headersReviewed: "on",
    idColumn: "VOTERID",
  });
  await h.submit("prepare-upload", {
    preparedReviewed: "on",
    sourceAsOf: "2026-10-27",
  });
  assert.equal(h.controller.state().error, "");
  assert.equal(h.controller.state().job.importId, "existing-county-upload");
  assert.equal(h.controller.state().job.status, "awaiting_mapping");
  assert.equal(
    h.calls.filter(
      (call) => call.suffix === "/imports" && call.method === "POST",
    ).length,
    0,
  );
  assert.equal(h.successfulExports(), 1);
});

test("held and expired history does not trap a new source preparation", async (t) => {
  const h = fixture(t);
  await h.controller.load();
  h.setScopePages([
    [
      {
        ...savedJob("needs_review"),
        importId: "held-upload",
        boundedHeld: true,
      },
      {
        ...savedJob(),
        importId: "expired-upload",
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ],
  ]);
  await h.controller.action("ballot-sent-open");
  await h.submit(
    "prepare-source",
    { delimiter: "comma", encoding: "utf-8" },
    countyFile(),
  );
  assert.equal(h.controller.state().error, "");
  assert.deepEqual(
    h.workerCalls.map((call) => call.action),
    ["inspect"],
  );
  assert.deepEqual(admissions(h), []);
  assert.equal(
    h.calls.filter((call) =>
      /\/imports\/(?:held|expired)-upload$/.test(call.path),
    ).length,
    0,
  );
});
