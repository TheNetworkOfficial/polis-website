// Only this preflight boundary can establish that a request was never dispatched.
// A server response or network error cannot assert this client-local evidence.
const undispatched = new WeakSet();
export const textingRequestWasNotDispatched = (error) =>
  error instanceof Error && undispatched.has(error);

/** Refresh text-banking authentication before a request; never replay a mutation. */
export function createTextingSessionRequest({
  request,
  getSession,
  restoreSession,
  saveSession,
  userId,
  contextKey,
}) {
  let restoring;
  return async (path, options = {}) => {
    if (!options.auth) return request(path, options);
    const previous = getSession(),
      actor = userId(previous),
      route = contextKey();
    const expired = () =>
      Object.assign(
        new Error("Your session could not be refreshed. Please sign in again."),
        {
          status: 401,
        },
      );
    try {
      if (!actor) throw expired();
      // The existing session restorer returns locally while valid and refreshes
      // through Cognito only when needed. Concurrent reads share that refresh.
      restoring ||= Promise.resolve()
        .then(restoreSession)
        .finally(() => {
          restoring = null;
        });
      const session = await restoring;
      if (
        contextKey() !== route ||
        userId(getSession()) !== actor ||
        (getSession() !== previous && getSession() !== session)
      )
        throw new Error("Workspace changed; previous operation stopped.");
      if (!session || userId(session) !== actor) throw expired();
      saveSession(session);
      options.beforeRequest?.();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      undispatched.add(failure);
      throw failure;
    }
    return request(path, options);
  };
}
