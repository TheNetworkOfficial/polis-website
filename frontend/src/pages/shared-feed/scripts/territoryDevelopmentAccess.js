// Webpack folds production builds to false even when the explicit opt-in is set.
export const territoryDevelopmentBuildEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.POLIS_TERRITORY_DEVELOPMENT_ENABLED === "true";

const scopeKey = ({ scopeType, scopeId } = {}) =>
  ["coalition", "candidate"].includes(scopeType) &&
  typeof scopeId === "string" &&
  /^[A-Za-z0-9_-]{1,160}$/.test(scopeId)
    ? `${scopeType}:${scopeId}`
    : "";

/** A grant comes only from a completed access read for this actor and location.
 * Cached organization roles, browser flags and old responses cannot enable it.
 * Production authoring never enables the separate development-only controls.
 */
export function createTerritoryAuthoringAccess({
  enabled = territoryDevelopmentBuildEnabled,
  context,
}) {
  let actor = null,
    generation = 0;
  const grants = new Map(),
    pending = new Map();
  function sync() {
    const next = context();
    if (
      !actor ||
      next?.userId !== actor.userId ||
      next?.session !== actor.session ||
      next?.location !== actor.location
    ) {
      generation++;
      grants.clear();
      pending.clear();
      actor = next
        ? {
            userId: next.userId,
            session: next.session,
            location: next.location,
          }
        : null;
    }
    return Boolean(actor?.userId && actor.session);
  }
  function begin(scope) {
    sync();
    const key = scopeKey(scope),
      ticket = { key, generation };
    grants.delete(key);
    if (key) pending.set(key, ticket);
    return ticket;
  }
  function finish(ticket, payload) {
    const ready = sync();
    if (
      !ticket.key ||
      ticket.generation !== generation ||
      pending.get(ticket.key) !== ticket
    )
      return false;
    pending.delete(ticket.key);
    if (!ready) return false;
    const access =
      payload?.access && typeof payload.access === "object"
        ? payload.access
        : payload;
    const successful =
      (payload?.ok === true || access?.ok === true) &&
      payload?.ok !== false &&
      access?.ok !== false;
    const development =
      successful &&
      enabled === true &&
      access?.capabilities?.territoryDevelopmentAccess === true;
    const authoring =
      successful &&
      access?.canManageTerritories === true &&
      ["full", "territories"].includes(access?.scope) &&
      access?.capabilities?.territoryAuthoringAccess === true;
    if (development || authoring)
      grants.set(ticket.key, { development, authoring });
    return development || authoring;
  }
  function fail(ticket) {
    sync();
    if (pending.get(ticket?.key) !== ticket) return;
    pending.delete(ticket.key);
    grants.delete(ticket.key);
  }
  async function read(scope, request) {
    const ticket = begin(scope);
    try {
      const payload = await request();
      finish(ticket, payload);
      return payload;
    } catch (error) {
      fail(ticket);
      throw error;
    }
  }
  return {
    read,
    allowed: (scope) =>
      sync() &&
      Boolean(grants.get(scopeKey(scope))) &&
      !pending.has(scopeKey(scope)),
    developmentAllowed: (scope) =>
      sync() &&
      grants.get(scopeKey(scope))?.development === true &&
      !pending.has(scopeKey(scope)),
  };
}

export function visibleTerritorySections(items, authoringAllowed) {
  return items.filter(
    (item) => item.key !== "territories/admin" || authoringAllowed === true,
  );
}
