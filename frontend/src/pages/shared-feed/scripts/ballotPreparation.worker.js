import {
  inspectBallotFile,
  prepareBallotFile,
  readRetainedBallotIds,
  ballotPreparationError,
} from "./ballotPreparationModel.js";

const active = new Map();

// Source parsing stays off the main thread. Cancellation aborts the next bounded read.
self.addEventListener("message", async ({ data }) => {
  const { id, action, file, options = {} } = data || {};
  if (typeof id !== "string" && typeof id !== "number") return;
  if (action === "cancel") {
    active.get(id)?.abort();
    return;
  }
  if (active.size || !["inspect", "prepare", "ids"].includes(action)) {
    self.postMessage({
      id,
      type: "error",
      error: {
        message: "Wait for the current file operation to finish.",
        code: "ballot_preparation_busy",
      },
    });
    return;
  }
  const controller = new AbortController();
  active.set(id, controller);
  try {
    const run =
      action === "inspect"
        ? inspectBallotFile
        : action === "ids"
          ? readRetainedBallotIds
          : prepareBallotFile;
    const result = await run(file, {
      ...options,
      signal: controller.signal,
      onProgress: (progress) =>
        self.postMessage({ id, type: "progress", progress }),
    });
    self.postMessage({ id, type: "result", result });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      error: ballotPreparationError(error),
    });
  } finally {
    active.delete(id);
  }
});
