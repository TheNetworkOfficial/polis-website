import { uuid } from "./textingWorkspaceUi";

const identifier = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const sessionIdentifier = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Keep the server's actual assignment identity across internal workspace routes.
 * Exit never sends messages or clears uncertain-send fences. The server decides
 * which unattempted contacts can return to the pool; its deadline covers exits
 * the browser cannot deliver. */
export function createTextingQueueSession({ requestExit, makeId = uuid } = {}) {
  let sessionId = makeId();
  let assignment = null;
  const pendingAllocations = new Set();
  const requestedAssignments = new Set();
  const freezeAssignment = (
    queueSession,
    { userId, organizationId, neutralApi },
    expectedSessionId,
  ) => {
    if (
      !identifier(userId) ||
      !identifier(organizationId) ||
      !identifier(queueSession?.campaignId) ||
      !identifier(queueSession?.allocationId) ||
      !sessionIdentifier(queueSession?.sessionId) ||
      queueSession.sessionId !== expectedSessionId ||
      queueSession.canReleaseUnused !== true ||
      !Number.isSafeInteger(queueSession.assignmentExpiresAtMs)
    )
      return null;
    const key = JSON.stringify([
      userId,
      organizationId,
      queueSession.campaignId,
      queueSession.allocationId,
      queueSession.sessionId,
    ]);
    return {
      key,
      userId,
      organizationId,
      neutralApi: neutralApi === true,
      campaignId: queueSession.campaignId,
      allocationId: queueSession.allocationId,
      sessionId: queueSession.sessionId,
    };
  };
  const dispatch = (frozen) => {
    if (!requestExit || requestedAssignments.has(frozen.key)) return;
    requestedAssignments.add(frozen.key);
    const requestId = frozen.requestId || makeId();
    // Late allocation responses may reveal the token only after an SPA exit.
    // This is an exit of that exact old session, never adoption of its previews.
    try {
      const prefix = frozen.neutralApi ? "workspaces" : "prompt/scopes";
      const path = `/api/text-banking/${prefix}/${encodeURIComponent(`coalition:${frozen.organizationId}`)}/campaigns/${encodeURIComponent(frozen.campaignId)}/queue/release`;
      Promise.resolve(
        requestExit(path, {
          expectedUserId: frozen.userId,
          body: {
            allocationId: frozen.allocationId,
            sessionId: frozen.sessionId,
            requestId,
            reason: "exit",
          },
        }),
      ).catch(() => {});
    } catch {
      // No release was confirmed. The server's original deadline still holds.
    }
  };
  return {
    get sessionId() {
      return sessionId;
    },
    observe(queueSession, { userId, organizationId, neutralApi } = {}) {
      const frozen = freezeAssignment(
        queueSession,
        { userId, organizationId, neutralApi },
        sessionId,
      );
      if (!frozen) return false;
      if (assignment?.key !== frozen.key)
        assignment = {
          ...frozen,
          requestId: makeId(),
        };
      return true;
    },
    beginAllocation(context) {
      const ticket = { ...context, sessionId, exited: false };
      pendingAllocations.add(ticket);
      return ticket;
    },
    completeAllocation(ticket, queueSession) {
      if (!pendingAllocations.delete(ticket)) return;
      const frozen = freezeAssignment(queueSession, ticket, ticket.sessionId);
      if (!frozen) return;
      if (ticket.exited) dispatch(frozen);
      else if (ticket.sessionId === sessionId)
        this.observe(queueSession, ticket);
    },
    cancelAllocation(ticket) {
      pendingAllocations.delete(ticket);
    },
    release() {
      const pending = [...pendingAllocations].filter(
        (ticket) => !ticket.exited,
      );
      const owned = assignment && !requestedAssignments.has(assignment.key);
      if ((!owned && !pending.length) || !requestExit) return false;
      for (const ticket of pending) ticket.exited = true;
      // A resumed page adopts a new session even when the provider returns the
      // same batch. Its ownership cannot be released by this older exit event.
      sessionId = makeId();
      if (owned) dispatch(assignment);
      return true;
    },
    forget() {
      assignment = null;
    },
  };
}
