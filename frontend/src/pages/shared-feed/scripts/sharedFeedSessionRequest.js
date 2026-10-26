const REFRESH_LEEWAY_MS = 60 * 1000;

const sameCredentials = (left, right) =>
  Boolean(
    left &&
      right &&
      left.idToken === right.idToken &&
      left.accessToken === right.accessToken &&
      left.refreshToken === right.refreshToken,
  );

const sessionError = (message, status) =>
  Object.assign(new Error(message), { status });

/** Renew before dispatch, preserving the prepared operation and its actor.
 * The auth layer owns refresh deduplication and guarded credential persistence.
 * Requests are never replayed after a response or an uncertain network outcome. */
export function createSharedFeedSessionGuard({
  getSession,
  restoreSession,
  saveSession,
  userId,
  contextKey,
  now = Date.now,
}) {
  return {
    async prepare({ signal } = {}) {
      const previous = getSession();
      const actor = userId(previous);
      const context = contextKey();
      let session = previous;
      const expired = () =>
        sessionError("Your session expired. Please sign in again.", 401);
      const assertCurrent = () => {
        if (signal?.aborted) {
          throw new DOMException("The request was cancelled.", "AbortError");
        }
        const current = getSession();
        if (
          contextKey() !== context ||
          !actor ||
          userId(current) !== actor ||
          (!sameCredentials(current, previous) &&
            !sameCredentials(current, session))
        ) {
          throw sessionError(
            "Your sign-in or page changed. Please retry from the current page.",
            409,
          );
        }
      };

      if (!actor) throw expired();
      assertCurrent();
      if (
        !Number.isFinite(previous.expiresAt) ||
        previous.expiresAt <= now() + REFRESH_LEEWAY_MS
      ) {
        try {
          session = await restoreSession(previous);
        } catch (error) {
          assertCurrent();
          const status = Number(error?.statusCode || error?.status || 0);
          if (status === 400 || status === 401 || status === 403) {
            throw expired();
          }
          throw sessionError(
            "Unable to renew your session right now. Please try again; your saved work is unchanged.",
            503,
          );
        }
        assertCurrent();
        if (
          !session ||
          userId(session) !== actor ||
          !Number.isFinite(session.expiresAt) ||
          session.expiresAt <= now()
        ) {
          throw expired();
        }
        saveSession(session);
      }
      assertCurrent();
      return { session, assertCurrent };
    },
  };
}
