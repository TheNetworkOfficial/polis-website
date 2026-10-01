import {
  escapeText as e,
  checkedUrl,
  id,
  list,
  button,
} from "./textingWorkspaceUi";

const initials = (name) =>
  String(name || "Member")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0] || "")
    .join("")
    .toUpperCase();

/** Eligible-member search only. Selection is saved by the existing team action. */
export function createVolunteerPicker(
  r,
  state,
  { schedule = setTimeout, cancel = clearTimeout, delayMs = 275 } = {},
) {
  let sequence = 0,
    timer,
    controller,
    assignedController,
    assignedSequence = 0,
    disposed = false,
    lastState;
  const editable = (s) =>
    r.can("createCampaigns") && s.campaign?.status !== "archived";
  const stop = () => {
    sequence++;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  };
  const current = (s, ticket) => {
    if (disposed || ticket !== sequence) return false;
    try {
      r.guard?.();
      return state() === s && editable(s);
    } catch {
      return false;
    }
  };
  const remember = (s, members) => {
    const profiles = (s.memberProfiles ||= new Map());
    for (const member of members) {
      if (typeof member?.userId !== "string" || !member.userId) continue;
      profiles.set(member.userId, {
        userId: member.userId,
        displayName: String(member.displayName || "Member"),
        avatarUrl: checkedUrl(member.avatarUrl),
      });
    }
    const retained = new Set([
      ...list(s.campaign?.assignedUserIds),
      ...(s.selected || []),
      ...members.map((member) => member.userId),
    ]);
    for (const key of profiles.keys())
      if (!retained.has(key)) profiles.delete(key);
  };
  async function search(s, query, ticket) {
    if (!current(s, ticket)) return;
    controller = new AbortController();
    const signal = controller.signal;
    s.memberSearchStatus = "searching";
    r.changed();
    try {
      const result = await r.api(
        `/members?query=${id(query)}&limit=20`,
        undefined,
        undefined,
        { signal },
      );
      if (signal.aborted || !current(s, ticket)) return;
      s.members = list(result.members)
        .filter((member) => typeof member?.userId === "string" && member.userId)
        .slice(0, 20);
      remember(s, s.members);
      s.memberSearchStatus = "ready";
    } catch (error) {
      if (signal.aborted || !current(s, ticket)) return;
      s.members = [];
      if ([401, 403].includes(error?.status)) {
        s.memberProfiles?.clear();
        r.fail?.(error);
        return;
      }
      s.memberSearchStatus = "error";
    } finally {
      if (current(s, ticket)) r.changed();
    }
  }
  function update(value, immediate = false) {
    if (disposed) return Promise.resolve();
    r.guard?.();
    const s = state();
    lastState = s;
    if (!editable(s)) return Promise.resolve();
    const query = String(value || "").slice(0, 100);
    // Native input and change can report the same value; do not repeat a lookup.
    if (!immediate && s.query === query) return Promise.resolve();
    stop();
    s.query = query;
    s.members = [];
    remember(s, []);
    const normalized = query.trim();
    s.memberSearchStatus = normalized.length < 3 ? "idle" : "waiting";
    if (normalized.length < 3) return Promise.resolve();
    const ticket = sequence;
    if (immediate) return search(s, normalized, ticket);
    timer = schedule(() => {
      timer = undefined;
      void search(s, normalized, ticket);
    }, delayMs);
    return Promise.resolve();
  }
  function invalidateAssigned() {
    const s = state();
    assignedSequence++;
    assignedController?.abort();
    s.memberProfileCursor = null;
    s.memberProfileRevision = s.campaign?.revision;
    s.memberProfilesLoading = false;
    s.memberProfilesError = false;
  }
  async function loadAssigned(more = false) {
    if (disposed) return;
    r.guard?.();
    const s = state();
    lastState = s;
    if (!r.can("createCampaigns") || !s.campaign?.campaignId) return;
    if (s.memberProfileRevision !== s.campaign.revision) {
      invalidateAssigned();
      // A cursor from a previous assignment revision must never be replayed.
      more = false;
    }
    if (!list(s.campaign.assignedUserIds).length) return;
    if (more && !s.memberProfileCursor) return;
    const ticket = ++assignedSequence;
    assignedController?.abort();
    assignedController = new AbortController();
    const signal = assignedController.signal;
    const campaignId = s.campaign.campaignId;
    const valid = () => {
      if (disposed || signal.aborted || ticket !== assignedSequence)
        return false;
      try {
        r.guard?.();
        return (
          state() === s &&
          s.campaign?.campaignId === campaignId &&
          r.can("createCampaigns")
        );
      } catch {
        return false;
      }
    };
    s.memberProfilesLoading = true;
    s.memberProfilesError = false;
    if (!more) s.memberProfileCursor = null;
    try {
      const page = await r.api(
        `/campaigns/${id(campaignId)}/team?limit=50${more ? `&cursor=${id(s.memberProfileCursor)}` : ""}`,
        undefined,
        undefined,
        { signal },
      );
      if (!valid()) return;
      if (
        page.campaignId !== campaignId ||
        page.campaignRevision !== s.campaign.revision
      )
        throw Object.assign(
          new Error("Team changed. Refresh before loading profiles."),
          { status: 409 },
        );
      const assigned = new Set(list(s.campaign.assignedUserIds));
      remember(s, [
        ...list(s.members),
        ...list(page.members).filter((member) => assigned.has(member?.userId)),
      ]);
      s.memberProfileCursor = page.nextCursor || null;
    } catch (error) {
      if (!valid()) return;
      if ([401, 403].includes(error?.status)) {
        s.memberProfiles?.clear();
        r.fail?.(error);
        return;
      }
      if (error?.status === 409) {
        s.memberProfileCursor = null;
        s.assignmentsNeedRead = true;
        return;
      }
      s.memberProfilesError = true;
    } finally {
      if (valid()) {
        s.memberProfilesLoading = false;
        r.changed();
      }
    }
  }
  function profileControls(s) {
    if (s.assignmentsNeedRead || !r.can("createCampaigns")) return "";
    if (s.memberProfilesLoading)
      return '<p class="pt-muted" role="status">Loading teammate profiles…</p>';
    if (s.memberProfilesError)
      return `<p class="pt-muted">Some teammate profiles could not be loaded. Your selections are kept.</p>${button("members-refresh", "Retry teammate profiles", { secondary: true })}`;
    return s.memberProfileCursor
      ? button("members-more", "Load more teammate profiles", {
          secondary: true,
          disabled: r.busy(),
        })
      : list(s.campaign?.assignedUserIds).some(
            (userId) => !s.memberProfiles?.has(userId),
          )
        ? button("members-refresh", "Load teammate profiles", {
            secondary: true,
            disabled: r.busy(),
          })
        : "";
  }
  function memberRow(s, userId) {
    const member = s.memberProfiles?.get(userId),
      name = member?.displayName || "Assigned member",
      selected = s.selected?.has(userId),
      avatar =
        member?.avatarUrl && !s.memberAvatarErrors?.has(member.avatarUrl)
          ? member.avatarUrl
          : null,
      disabled = r.busy() || s.assignmentsNeedRead || !editable(s);
    return `<label class="pt-volunteer-row"><span class="pt-volunteer-avatar" aria-hidden="true"><span>${e(initials(name))}</span>${avatar ? `<img src="${e(avatar)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-workspace-volunteer-avatar="true">` : ""}</span><span class="pt-volunteer-name"><strong>${e(name)}</strong>${member ? "" : `<small class="pt-muted">${e(userId)}</small>`}</span><input type="checkbox" aria-label="${e(`Select ${name}`)}" data-workspace-member="${e(userId)}"${selected ? " checked" : ""}${disabled ? " disabled" : ""}></label>`;
  }
  function render() {
    const s = state();
    lastState = s;
    if (s.memberProfileRevision !== s.campaign?.revision) invalidateAssigned();
    remember(s, list(s.members));
    const selected = s.selected || new Set(),
      retained = [
        ...new Set([...list(s.campaign?.assignedUserIds), ...selected]),
      ],
      found = list(s.members).filter(
        (member) => !retained.includes(member.userId),
      ),
      status = s.memberSearchStatus,
      message =
        status === "waiting" || status === "searching"
          ? "Finding teammates…"
          : status === "error"
            ? "Teammates could not be loaded. Keep typing or press Enter to try again."
            : status === "ready"
              ? list(s.members).length
                ? `${list(s.members).length} matching teammate${list(s.members).length === 1 ? "" : "s"}.`
                : "No teammates with texting access match this name."
              : "Type at least three characters to find teammates with texting access.";
    return `<div class="pt-volunteer-picker"><form data-workspace-form="members" role="search"><label class="pt-field"><span>Find a teammate</span><input name="query" type="search" value="${e(s.query || "")}" maxlength="100" autocomplete="off" placeholder="Start typing a name" data-workspace-volunteer-query="true" aria-describedby="volunteer-search-status" aria-controls="volunteer-search-results"${!editable(s) ? " disabled" : ""}></label></form><p class="pt-muted pt-volunteer-status" id="volunteer-search-status" role="status" aria-live="polite">${e(message)}</p><div id="volunteer-search-results">${retained.length ? `<section class="pt-volunteer-group" aria-label="Campaign team"><h3>Campaign team <span class="pt-muted">${selected.size} selected</span></h3>${retained.map((userId) => memberRow(s, userId)).join("")}</section>` : `<p class="pt-muted">No teammates selected yet.</p>`}${profileControls(s)}${found.length ? `<section class="pt-volunteer-group" aria-label="Matching teammates"><h3>Matching teammates</h3>${found.map((member) => memberRow(s, member.userId)).join("")}</section>` : ""}</div></div>`;
  }
  return {
    render,
    loadAssigned,
    invalidateAssigned,
    avatarError(target) {
      if (disposed) return;
      r.guard?.();
      const errors = (state().memberAvatarErrors ||= new Set()),
        url = checkedUrl(target.currentSrc || target.src);
      if (url) {
        errors.add(url);
        if (errors.size > 100) errors.delete(errors.values().next().value);
      }
    },
    async action(name) {
      if (!["members-more", "members-refresh"].includes(name)) return false;
      await loadAssigned(name === "members-more");
      return true;
    },
    change(target) {
      if (!target.dataset.workspaceVolunteerQuery) return false;
      void update(target.value);
      return true;
    },
    submit(form) {
      return update(String(new FormData(form).get("query") || ""), true);
    },
    dispose() {
      disposed = true;
      stop();
      assignedSequence++;
      assignedController?.abort();
      if (lastState) {
        lastState.members = [];
        lastState.memberProfiles?.clear();
        lastState.memberAvatarErrors?.clear();
        lastState.query = "";
      }
    },
  };
}
