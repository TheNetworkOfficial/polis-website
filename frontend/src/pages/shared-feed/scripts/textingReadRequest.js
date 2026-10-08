/** Bound read latency, including authentication, even if a transport ignores abort. */
export async function textingReadRequest(
  operation,
  { signal, timeoutMs = 20000 } = {},
) {
  const controller = new AbortController();
  let timer, abort;
  const stopped = new Promise((_, reject) => {
    abort = () => {
      controller.abort();
      reject(
        Object.assign(new Error("Read cancelled."), { name: "AbortError" }),
      );
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(
        Object.assign(new Error("Updates took too long. Retrying shortly."), {
          name: "TimeoutError",
        }),
      );
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      stopped,
      Promise.resolve().then(() => {
        if (controller.signal.aborted)
          throw Object.assign(new Error("Read cancelled."), {
            name: "AbortError",
          });
        return operation(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
