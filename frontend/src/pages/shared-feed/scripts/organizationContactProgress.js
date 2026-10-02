/** One request at a time; durable jobs continue on the server when this view closes. */
export function createContactProgress(
  r,
  {
    read,
    accept,
    pending,
    failed,
    schedule = setTimeout,
    cancel = clearTimeout,
    now = Date.now,
    visible = () => globalThis.document?.hidden !== true,
    recoverAfterMs = null,
  },
) {
  let timer,
    flight,
    generation = 0,
    disposed = false,
    failures = 0;
  let progress = "",
    progressAt = now(),
    lastRecoveryAt = 0,
    recoveries = 0;
  const active = (version = generation) => {
    if (disposed || version !== generation) return false;
    try {
      r.guard?.();
      return true;
    } catch {
      return false;
    }
  };
  function stop() {
    cancel(timer);
    timer = null;
  }
  function reset() {
    stop();
    generation++;
    flight = null;
    failures = 0;
    progress = "";
    progressAt = now();
    lastRecoveryAt = 0;
    recoveries = 0;
  }
  function arm() {
    stop();
    if (!active() || flight || !pending() || failures > 3) return;
    timer = schedule(
      () => {
        timer = null;
        if (!visible() || r.busy?.()) {
          arm();
          return;
        }
        void refresh();
      },
      failures ? Math.min(30000, 3000 * 2 ** failures) : 3000,
    );
    timer?.unref?.();
  }
  async function refresh({ manual = false } = {}) {
    if (!active()) return;
    if (flight) return flight;
    if (manual) {
      failures = 0;
      progressAt = now();
    }
    stop();
    const version = generation;
    flight = (async () => {
      try {
        const recover =
          !!recoverAfterMs &&
          pending() &&
          now() - progressAt >= recoverAfterMs &&
          now() - lastRecoveryAt >= recoverAfterMs &&
          recoveries < 2;
        if (recover) {
          recoveries++;
          lastRecoveryAt = now();
        }
        const result = await read({ manual, recover });
        if (!active(version)) return;
        const next = JSON.stringify([
          result?.status,
          result?.count,
          result?.counted,
          result?.total,
          result?.nextCursor,
          result?.includeOffset,
        ]);
        if (next !== progress) {
          progress = next;
          progressAt = now();
          recoveries = 0;
          lastRecoveryAt = 0;
        }
        await accept(result, () => active(version));
        if (!active(version)) return;
        failures = 0;
        if (pending() && now() - progressAt > 900000) {
          failures = 4;
          failed(
            new Error(
              "Progress has paused. Your selection is saved; check again to reconnect.",
            ),
          );
        }
      } catch (error) {
        if (!active(version)) return;
        failures++;
        if ([401, 403].includes(error?.status || error?.statusCode)) {
          failures = 4;
          r.fail(error);
        } else if (
          failures > 3 ||
          (error?.status &&
            error.status < 500 &&
            ![408, 429].includes(error.status))
        ) {
          failures = 4;
          failed(error);
        }
      } finally {
        if (active(version)) {
          flight = null;
          r.changed();
          arm();
        }
      }
    })();
    return flight;
  }
  return {
    refresh,
    reset,
    dispose() {
      reset();
      disposed = true;
    },
  };
}
