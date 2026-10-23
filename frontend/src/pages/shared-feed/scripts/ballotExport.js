/** Private server-built exports keep large CSVs out of browser memory. */
export const ballotExportFields = Object.freeze([
  "contactId",
  "ballotVoterId",
  "ballotStatus",
  "ballotReturnedAt",
  "ballotSourceAsOf",
  "ballotComparisonFrom",
  "ballotComparisonTo",
]);

export function createBallotExport({
  request,
  guard,
  changed,
  schedule = setTimeout,
  cancel = clearTimeout,
  explainError = () => null,
}) {
  let state = {},
    generation = 0,
    timer,
    flight;
  const reset = () => {
    generation++;
    cancel(timer);
    state = {};
    flight = null;
  };
  const current = (version) => {
    guard();
    if (version !== generation)
      throw new Error("This export is no longer open.");
  };
  async function call(path, body, version) {
    current(version);
    const result = await request(path, {
      auth: true,
      beforeRequest: () => current(version),
      ...(body ? { method: "POST", body } : {}),
    });
    current(version);
    if (
      result?.ok !== true ||
      !result.export?.exportId ||
      !["building", "ready", "needs_review"].includes(result.export.status)
    )
      throw new Error("The export status could not be confirmed.");
    state = {
      ...state,
      job: result.export,
      download: result.download || null,
      error: "",
    };
    if (state.job.status === "needs_review") {
      fail(
        Object.assign(
          new Error(
            "This export needs review. Start a new export from the current list.",
          ),
          { payload: { error: state.job.reason } },
        ),
        version,
      );
      return result;
    }
    cancel(timer);
    if (state.job.status === "building")
      timer = schedule(() => {
        void refresh();
      }, 3000);
    changed();
    return result;
  }
  function fail(error, version) {
    if (version !== generation) return;
    try {
      guard();
    } catch {
      reset();
      return;
    }
    const code = error?.payload?.error || error?.code;
    const stale = [
      "ballot_snapshot_changed",
      "ballot_publication_pending",
      "contact_book_changed",
    ].includes(code);
    cancel(timer);
    state = {
      ...state,
      download: null,
      ...(stale ? { job: null, stale: true } : {}),
      error:
        explainError(error) ||
        (code === "contact_book_changed"
          ? "The list changed. Refresh the ballot list and start a new export."
          : stale
            ? "A new county update is available. Refresh Ballot Chaser and choose your list again."
            : error.message || "Export paused. Check progress to retry."),
    };
    changed();
  }
  async function start(base, body) {
    reset();
    guard();
    state.base = base;
    const version = generation;
    try {
      await call(
        `${base}/elections/${encodeURIComponent(body.electionId)}/exports`,
        Object.fromEntries(
          Object.entries({
            ...body,
            columns: [
              ...new Set([
                ...(body.columns || []),
                ...ballotExportFields.filter(
                  (key) =>
                    key !== "ballotVoterId" ||
                    !Array.isArray(body.registerSchema) ||
                    body.registerSchema.includes(key),
                ),
              ]),
            ],
          }).filter(([key]) =>
            [
              "operationId",
              "snapshotId",
              "view",
              "filter",
              "search",
              "sort",
              "columns",
              "selection",
            ].includes(key),
          ),
        ),
        version,
      );
    } catch (error) {
      fail(error, version);
    }
  }
  async function refresh() {
    if (flight || !state.job?.exportId) return flight;
    const version = generation;
    flight = call(
      `${state.base}/exports/${encodeURIComponent(state.job.exportId)}`,
      null,
      version,
    )
      .catch((error) => fail(error, version))
      .finally(() => {
        if (version === generation) flight = null;
      });
    return flight;
  }
  async function download() {
    const version = generation;
    current(version);
    await refresh();
    current(version);
    if (!state.error && state.job?.status === "ready")
      return checkedBallotDownload(state.download);
    return null;
  }
  return { reset, start, refresh, download, view: () => state };
}

export function checkedBallotDownload(download) {
  const url = new URL(download?.url || "");
  const expiry =
    typeof download.expiresAt === "number"
      ? download.expiresAt * (download.expiresAt < 1e12 ? 1000 : 1)
      : Date.parse(download.expiresAt);
  if (
    download.method !== "GET" ||
    !Number.isFinite(expiry) ||
    expiry <= Date.now() ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !/^[a-z0-9][a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/i.test(url.hostname)
  )
    throw new Error(
      "The private download expired. Check progress and try again.",
    );
  return url.href;
}
