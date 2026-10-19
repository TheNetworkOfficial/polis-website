// Only this preflight boundary can establish that a request was never dispatched.
// A server response or network error cannot assert this client-local evidence.
const undispatched = new WeakSet();
/** Independent read-only setup discovery and workspace requests share one refresh result. */
export function createTextingSessionRestorer(restoreSession) {
  let pending;
  return () => {
    pending ||= Promise.resolve()
      .then(restoreSession)
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
export const textingRequestWasNotDispatched = (error) =>
  error instanceof Error && undispatched.has(error);

/** Exit uses an existing valid session synchronously, without token refresh,
 * route fencing, mutation replay, or persisting credentials in an exit payload. */
export function createTextingExitRequest({ request, getSession, userId }) {
  return (path, { expectedUserId, body } = {}) => {
    const session = getSession();
    if (
      !expectedUserId ||
      userId(session) !== expectedUserId ||
      !Number.isFinite(session?.expiresAt) ||
      session.expiresAt <= Date.now() ||
      !/^\/api\/text-banking\/(?:workspaces|prompt\/scopes)\/[^/]+\/campaigns\/[^/]+\/queue\/release$/.test(
        path,
      )
    )
      throw new Error("Texting exit session is unavailable.");
    return request(path, {
      auth: true,
      method: "POST",
      keepalive: true,
      body,
    });
  };
}

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
