/** Shared identity search. Names and handles are visible; IDs stay in payloads. */
export function createOrganizationPersonSearch({
  request,
  identity,
  changed,
  surface = "audience_groups",
}) {
  let generation = 0;
  let state = {
    query: "",
    people: [],
    nextCursor: null,
    loading: false,
    error: "",
  };
  const reset = () => {
    generation++;
    state = {
      query: "",
      people: [],
      nextCursor: null,
      loading: false,
      error: "",
    };
  };
  async function search(query, { more = false } = {}) {
    const actor = identity(),
      token = ++generation;
    const normalized = String(query || "")
      .trim()
      .replace(/^@/u, "");
    const cursor = more ? state.nextCursor : null;
    const previous = more ? state.people : [];
    state = {
      query,
      people: previous,
      nextCursor: cursor,
      loading: normalized.length >= 2,
      error: "",
    };
    changed();
    if (!actor || normalized.length < 2) return;
    try {
      const params = new URLSearchParams({
        q: normalized,
        type: "users",
        surface,
        limit: "25",
      });
      if (cursor) params.set("cursor", cursor);
      const payload = await request(`/api/search/results?${params}`, {
        auth: true,
      });
      if (token !== generation || actor !== identity()) return;
      const items = payload.items || payload.results || payload.users || [];
      const seen = new Set(previous.map((p) => p.userId));
      const people = [];
      for (const item of items) {
        const userId = String(item.userId || item.id || "").trim();
        if (!userId || seen.has(userId)) continue;
        seen.add(userId);
        const username = String(item.username || "").replace(/^@/u, "");
        const displayName = String(
          item.displayName || item.title || username || "Polis member",
        );
        people.push({
          userId,
          displayName:
            displayName === userId ? username || "Polis member" : displayName,
          username,
          avatarUrl: item.avatarUrl || null,
        });
      }
      state = {
        query,
        people: [...previous, ...people],
        nextCursor: payload.nextCursor || null,
        loading: false,
        error: "",
      };
    } catch {
      if (token !== generation || actor !== identity()) return;
      state.loading = false;
      state.error = "Unable to search people. Try again.";
    }
    changed();
  }
  return {
    search,
    reset,
    get state() {
      return state;
    },
  };
}
