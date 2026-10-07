const text = (value) => String(value ?? "").trim();
const escape = (value) =>
  text(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const requestId = () => crypto.randomUUID();
const keyOf = (scope) =>
  scope ? `${scope.userId}:${scope.scopeType}:${scope.scopeId}` : "";
export const organizationApiBase = (scope) =>
  `/api/organizations/${encodeURIComponent(scope.scopeType)}/${encodeURIComponent(scope.scopeId)}`;
export const organizationWorkspacePath = (scope) =>
  `/workspace/${encodeURIComponent(scope.scopeType)}/${encodeURIComponent(scope.scopeId)}`;

export function organizationPostPermissions(workspace = {}) {
  const permissions = new Set(workspace.permissions || []);
  const admin = workspace.isOwner === true || workspace.isAdmin === true;
  const manage = admin || permissions.has("posts_approve_manage");
  const direct = admin || permissions.has("posts_publish_direct");
  return {
    manage,
    direct,
    submit: manage || direct || permissions.has("posts_submit"),
    hideAttribution: admin || permissions.has("posts_hide_actor_attribution"),
  };
}

/** Organization ownership stays explicit while the existing composer handles media/editing. */
export function createOrganizationPublishingPage({
  request: rawRequest,
  context,
  changed,
  navigate,
  confirm = async () => false,
}) {
  async function request(...args) {
    try {
      return await rawRequest(...args);
    } catch (error) {
      const messages = {
        draft_version_conflict:
          "This draft changed while you were reviewing it. Return to Organization drafts and reopen its latest version.",
        revision_source_is_stale:
          "A newer revision is already live. Open its latest draft before making another revision.",
        publishing_request_conflict:
          "This saved operation differs from an earlier attempt. Review the organization queue before starting again.",
        files_media_replacement_requires_new_draft:
          "Replace the failed source in Files and create a new draft.",
        failed_publication_requires_replacement_media:
          "Replace the failed media before saving or publishing.",
        forbidden:
          "Your organization permissions changed. Reopen the workspace to check available actions.",
        missing_permission:
          "You no longer have permission for this action. Reopen the organization workspace.",
        draft_publication_in_progress:
          "This post is still processing. Check its status in Organization drafts.",
      };
      const message = messages[error?.payload?.error || error?.message];
      if (message) error.message = message;
      throw error;
    }
  }
  const empty = () => ({
    key: "",
    loading: false,
    error: "",
    drafts: [],
    workspace: null,
    nextCursor: "",
  });
  let resource = empty();
  let timer = null;
  let activeComposer = null;
  let generation = 0;
  let retrying = false;
  const storageKey = (scope) => `polis.organization.pending.v1:${keyOf(scope)}`;
  const sameContext = (scope) => keyOf(context()) === keyOf(scope);
  const readPending = (scope) => {
    try {
      return JSON.parse(localStorage.getItem(storageKey(scope)) || "null");
    } catch {
      return null;
    }
  };
  async function workspaceFor(scope) {
    const result = await request("/api/me/organization-workspaces", {
      auth: true,
    });
    const workspace = (result.workspaces || []).find(
      (w) => w.scopeType === scope.scopeType && w.scopeId === scope.scopeId,
    );
    if (!workspace) throw new Error("Organization access is unavailable.");
    return workspace;
  }
  async function load({ force = false, more = false } = {}) {
    const scope = context();
    if (!scope) return;
    const key = keyOf(scope);
    if (
      more &&
      (resource.loading || resource.key !== key || !resource.nextCursor)
    )
      return;
    if (!force && !more && resource.key === key && resource.workspace) return;
    const ticket = ++generation;
    const previous = resource.key === key ? resource : empty();
    clearTimeout(timer);
    resource = { ...previous, key, loading: true, error: "" };
    changed();
    try {
      const workspace = await workspaceFor(scope);
      const result = await request(
        `${organizationApiBase(scope)}/post-drafts?limit=100${more ? `&cursor=${encodeURIComponent(previous.nextCursor)}` : ""}`,
        { auth: true },
      );
      const drafts = result.drafts || [];
      for (let i = 0, checked = 0; i < drafts.length && checked < 8; i++) {
        if (!["publishing", "approved_waiting_media"].includes(drafts[i].state))
          continue;
        checked++;
        try {
          drafts[i] = (
            await request(
              `${organizationApiBase(scope)}/post-drafts/${encodeURIComponent(drafts[i].draftId)}`,
              { auth: true },
            )
          ).draft;
        } catch {
          /* Keep the durable server state and allow another refresh. */
        }
      }
      if (!sameContext(scope) || ticket !== generation) return;
      resource = {
        key,
        loading: false,
        error: "",
        drafts: more
          ? [
              ...new Map(
                [...previous.drafts, ...drafts].map((d) => [d.draftId, d]),
              ).values(),
            ]
          : drafts,
        workspace,
        nextCursor: result.nextCursor || "",
      };
      if (
        drafts.some((d) =>
          ["publishing", "approved_waiting_media"].includes(d.state),
        )
      ) {
        timer = setTimeout(() => {
          if (sameContext(scope) && !document.hidden) load({ force: true });
        }, 10000);
      }
    } catch (error) {
      if (sameContext(scope) && ticket === generation)
        resource = { ...resource, loading: false, error: error.message };
    }
    changed();
  }
  async function prepareComposer(composer, { draftId = "" } = {}) {
    const scope = context();
    if (!scope?.userId) throw new Error("Sign in to continue.");
    const workspace = await workspaceFor(scope);
    const [draftResult, audienceResult, connectionsResult] = await Promise.all([
      draftId
        ? request(
            `${organizationApiBase(scope)}/post-drafts/${encodeURIComponent(draftId)}`,
            { auth: true },
          )
        : {},
      request(`${organizationApiBase(scope)}/audience-groups`, {
        auth: true,
      }).catch((error) => ({ error: error.message })),
      request(`${organizationApiBase(scope)}/social/connections`, {
        auth: true,
      }).catch((error) => ({ error: error.message })),
    ]);
    if (!sameContext(scope))
      throw new Error("The active account changed. Reopen this draft.");
    const saved = draftResult.draft;
    const content = saved?.content || {};
    composer.organization = {
      ...scope,
      displayName: workspace.displayName,
      permissions: organizationPostPermissions(workspace),
      requestId: requestId(),
      draftId: saved?.draftId || "",
      draftVersion: saved?.version,
      state: saved?.state || "editing",
      actorUserId: scope.userId,
      draftActorUserId: saved?.actorUserId || scope.userId,
      readOnly:
        [
          "published",
          "publishing",
          "approved_waiting_media",
          "withdrawn",
        ].includes(saved?.state) ||
        (saved?.state === "publication_failed" &&
          Boolean(content.mediaItems?.length)),
      rejectionReason: saved?.rejectionReason || "",
      publicationError: saved?.publicationError || null,
    };
    composer.organizationSocial = {
      connections: connectionsResult.connections || [],
      loaded: !connectionsResult.error,
      loading: false,
      error: connectionsResult.error || "",
    };
    composer.organizationAudiences = {
      items: audienceResult.groups || [],
      loaded: !audienceResult.error,
      loading: false,
      error: audienceResult.error || "",
    };
    composer.existingContent = saved ? content : null;
    composer.description = content.description || "";
    composer.visibility = content.visibility || "public";
    composer.audienceGroupIds = (content.audienceGroupIds || []).join(",");
    composer.issueIds = (content.issueIds || []).join(",");
    composer.mediaType = content.type || "image";
    composer.previewUrl =
      content.imageUrl ||
      content.mediaUrl ||
      content.videoUrl ||
      (content.type === "video" && content.cfUid
        ? `https://videodelivery.net/${encodeURIComponent(content.cfUid)}/manifest/video.m3u8`
        : "");
    composer.hideActorAttribution = saved?.attributionVisible === false;
    const previews = [];
    for (const item of content.mediaItems || []) {
      try {
        const preview = await request(
          `/api/files/assets/${encodeURIComponent(item.assetId)}/versions/${encodeURIComponent(item.sourceAssetVersionId)}/preview`,
          { auth: true },
        );
        previews.push({
          url: preview.url,
          type: preview.contentType?.startsWith("video/") ? "video" : "image",
          expiresAt:
            Date.now() +
            Math.min(300, Number(preview.expiresInSeconds) || 0) * 1000,
          altText: item.altText || "",
        });
      } catch {
        previews.push({ error: "Preview unavailable. Reload to try again." });
      }
    }
    if (!sameContext(scope))
      throw new Error("The active account changed. Reopen this draft.");
    composer.organizationMedia = previews;
    const preferences = content.postReviewPreferences || {};
    for (const name of [
      "allowComments",
      "allowReuseContent",
      "aiGeneratedContent",
    ]) {
      if (typeof preferences[name] === "boolean")
        composer[name] = preferences[name];
    }
    composer.selectedCrosspostTargetKeys = (
      content.crosspostSelections || []
    ).map((s) => `${s.connectionId}::${s.targetId}`);
    for (const name of [
      "youtubeTitle",
      "youtubeDescription",
      "youtubePrivacy",
      "brandingOverlayEnabled",
    ]) {
      if (content.crosspostDraft?.[name] != null)
        composer[name] = content.crosspostDraft[name];
    }
    composer.crosspostSelectionInitialized = true;
    composer.publishingDefaultsApplied = true;
    activeComposer = composer;
  }
  async function perform(record) {
    const scope = context();
    if (
      !scope ||
      keyOf(scope) !== keyOf(record.scope) ||
      record.actorUserId !== scope.userId ||
      !["save", "submit", "approve", "direct-publish"].includes(record.action)
    ) {
      throw new Error("The signed-in account changed. Reopen this operation.");
    }
    const base = organizationApiBase(scope);
    const body = {
      ...record.content,
      expectedActorUserId: record.actorUserId,
      ...(record.draftId
        ? {
            expectedVersion: record.draftVersion,
            clientMutationId: `${record.requestId}:save`,
          }
        : { clientRequestId: record.requestId }),
    };
    if (record.draftId) delete body.mediaItems;
    const saved = (
      await request(
        `${base}/post-drafts${record.draftId ? `/${encodeURIComponent(record.draftId)}` : ""}`,
        { auth: true, method: record.draftId ? "PATCH" : "POST", body },
      )
    ).draft;
    if (!sameContext(scope))
      throw new Error("The active account changed. Reopen this operation.");
    if (record.action !== "save") {
      await request(
        `${base}/post-drafts/${encodeURIComponent(saved.draftId)}/${record.action}`,
        {
          auth: true,
          method: "POST",
          body: {
            expectedActorUserId: record.actorUserId,
            expectedVersion: saved.version,
            clientMutationId: `${record.requestId}:action`,
          },
        },
      );
    }
    localStorage.removeItem(storageKey(scope));
    if (sameContext(scope))
      navigate(`${organizationWorkspacePath(scope)}/work/publishing`);
    return saved;
  }
  async function saveComposer(composer, content, action = "save") {
    const author = composer.organization;
    if (
      !author ||
      author.readOnly ||
      (!author.permissions.manage &&
        (author.draftActorUserId !== author.actorUserId ||
          !author.permissions.submit))
    )
      throw new Error("This draft is read only.");
    if (author.state === "publication_failed" && !composer.file)
      throw new Error("Replace the failed media before saving.");
    if (action !== "save" && action !== composerAction(composer))
      throw new Error("This publishing action is unavailable.");
    if (content.crosspostDraft && content.crosspostSelections?.length) {
      content = {
        ...content,
        crosspostDraft: {
          ...composer.existingContent?.crosspostDraft,
          ...content.crosspostDraft,
        },
      };
    }
    if (content.visibility === "custom") {
      const groups = new Set(
        (composer.organizationAudiences?.items || []).map((g) => g.groupId),
      );
      if (
        composer.organizationAudiences?.error ||
        !content.audienceGroupIds?.length ||
        content.audienceGroupIds.some((id) => !groups.has(id))
      ) {
        throw new Error(
          "Choose an available organization audience before saving.",
        );
      }
    }
    const record = {
      scope: author,
      actorUserId: author.actorUserId,
      requestId: author.requestId,
      draftId: author.draftId,
      draftVersion: author.draftVersion,
      content,
      action,
    };
    // Persist the operation before transmission, including the uploaded media.
    // A reload retries the same operation, never a personal publish.
    const pending = readPending(author);
    if (pending && JSON.stringify(pending) !== JSON.stringify(record))
      throw new Error(
        "An earlier operation needs recovery. Return to Organization drafts to retry it first.",
      );
    localStorage.setItem(storageKey(author), JSON.stringify(record));
    return perform(record);
  }
  function composerAction(composer) {
    const author = composer.organization;
    if (!author || author.readOnly) return "";
    if (author.permissions.manage)
      return author.state === "pending_approval" ? "approve" : "direct-publish";
    if (author.draftActorUserId !== author.actorUserId) return "";
    return author.permissions.direct
      ? "direct-publish"
      : author.permissions.submit
        ? "submit"
        : "";
  }
  function renderDraftActions(composer) {
    const author = composer.organization;
    if (!author?.draftId) return "";
    const disabled = composer.pending ? " disabled" : "";
    const scheduledAt =
      composer.existingContent?.crosspostDraft?.scheduledAt ||
      composer.existingContent?.scheduledCrosspostAt;
    const scheduleDate = scheduledAt ? new Date(scheduledAt) : null;
    const schedule =
      scheduleDate && Number.isFinite(scheduleDate.getTime())
        ? `<p role="status">Crosspost scheduled: ${escape(scheduleDate.toLocaleString())}</p>`
        : "";
    const preview =
      schedule +
      (composer.existingContent?.mediaItems?.length
        ? `<button class="shared-feed-chip" type="button" data-org-draft-action="refresh-media"${disabled}>Refresh media previews</button>`
        : "");
    if (
      author.state === "publication_failed" &&
      composer.existingContent?.mediaItems?.length
    )
      return `${preview}<button class="shared-feed-chip" type="button" data-org-draft-action="open-files"${disabled}>Replace source in Files</button><p>Choose replacement media in Files and create a new draft.</p>`;
    if (author.state === "published" && author.permissions.submit)
      return `${preview}<button class="shared-feed-chip" type="button" data-org-draft-action="revise"${disabled}>Create revision</button>`;
    if (author.readOnly || author.state === "publication_failed")
      return preview;
    return `${preview}${author.permissions.manage && author.state === "pending_approval" ? `<label>Changes needed<textarea data-org-review-reason maxlength="500"${disabled}></textarea></label><button class="shared-feed-chip" type="button" data-org-draft-action="reject"${disabled}>Request changes</button>` : ""}
      ${author.draftActorUserId === author.actorUserId && author.permissions.submit ? `<button class="shared-feed-chip" type="button" data-org-draft-action="withdraw"${disabled}>Withdraw draft</button>` : ""}`;
  }
  async function draftAction(action, reason = "") {
    const composer = activeComposer,
      author = composer?.organization;
    if (!author || !sameContext(author) || composer.pending) return;
    if (action === "open-files") {
      composer.pending = true;
      changed();
      try {
        const result = await request(
          `/api/files/workspaces/${author.scopeType === "candidate" ? "political_account" : "organization"}/${encodeURIComponent(author.scopeId)}`,
          { auth: true },
        );
        const workspace = result.workspace || result;
        if (!workspace.filesWorkspaceId)
          throw new Error("This organization Files workspace is unavailable.");
        if (sameContext(author))
          navigate(
            `/files?workspace=${encodeURIComponent(workspace.filesWorkspaceId)}`,
          );
      } catch (error) {
        composer.error = error.message;
      } finally {
        composer.pending = false;
        changed();
      }
      return;
    }
    if (action === "refresh-media") {
      composer.pending = true;
      changed();
      try {
        const previews = await Promise.all(
          (composer.existingContent?.mediaItems || []).map(async (item) => {
            try {
              const p = await request(
                `/api/files/assets/${encodeURIComponent(item.assetId)}/versions/${encodeURIComponent(item.sourceAssetVersionId)}/preview`,
                { auth: true },
              );
              return {
                url: p.url,
                type: p.contentType?.startsWith("video/") ? "video" : "image",
                expiresAt:
                  Date.now() +
                  Math.min(300, Number(p.expiresInSeconds) || 0) * 1000,
                altText: item.altText || "",
              };
            } catch {
              return { error: "Preview unavailable. Refresh to try again." };
            }
          }),
        );
        if (sameContext(author)) composer.organizationMedia = previews;
      } finally {
        composer.pending = false;
        changed();
      }
      return;
    }
    if (!["revise", "reject", "withdraw"].includes(action)) return;
    if (action === "reject" && !text(reason)) {
      composer.error = "Describe the changes needed.";
      changed();
      return;
    }
    composer.pending = true;
    composer.error = "";
    changed();
    try {
      const result = await request(
        `${organizationApiBase(author)}/post-drafts/${encodeURIComponent(author.draftId)}/${action}`,
        {
          auth: true,
          method: "POST",
          body: {
            expectedActorUserId: author.actorUserId,
            expectedVersion: author.draftVersion,
            clientMutationId: `${author.requestId}:${action}`,
            ...(action === "reject" ? { reason: text(reason) } : {}),
          },
        },
      );
      if (sameContext(author))
        navigate(
          `${organizationWorkspacePath(author)}/work/publishing${action === "revise" ? `/drafts/${encodeURIComponent(result.draft.draftId)}` : ""}`,
        );
    } catch (error) {
      composer.error = error.message;
    } finally {
      composer.pending = false;
      changed();
    }
  }
  function render() {
    const scope = context();
    if (!scope) return "";
    const base = organizationWorkspacePath(scope);
    const permissions = organizationPostPermissions(resource.workspace || {});
    return `<section class="shared-page shared-organization-publishing"><div class="shared-page__content">
      <h1>${escape(resource.workspace?.displayName || "Organization")} publishing</h1>
      <nav class="shared-create-actions"><button class="shared-feed-chip" data-org-publish="refresh">Refresh</button>
        <a class="shared-feed-chip" href="${base}/people">People</a>
        <a class="shared-feed-chip" href="${base}/more/social-connections">Connected accounts</a>
        ${permissions.submit ? `<a class="shared-feed-chip shared-feed-chip--primary" href="${base}/work/publishing/new">New post</a>` : ""}</nav>
      ${resource.loading ? '<p role="status">Loading drafts…</p>' : ""}
      ${resource.error ? `<p role="alert">${escape(resource.error)}</p>` : ""}
      ${readPending(scope) ? `<div class="shared-create-actions"><button class="shared-feed-chip" data-org-publish="retry"${retrying ? " disabled" : ""}>${retrying ? "Recovering…" : "Retry saved operation"}</button><button class="shared-feed-chip" data-org-publish="discard-retry"${retrying ? " disabled" : ""}>Discard saved retry</button></div>` : ""}
      ${!resource.loading && !resource.error && !resource.drafts.length ? "<p>No drafts yet.</p>" : ""}
      ${resource.drafts
        .map(
          (
            d,
          ) => `<article class="shared-settings-panel"><h2>${escape(d.description || d.content?.description || "Organization draft")}</h2>
        <p>${escape(text(d.state).replaceAll("_", " "))}</p>
        <a class="shared-feed-chip" href="${base}/work/publishing/drafts/${encodeURIComponent(d.draftId)}">${d.state === "published" ? "View post" : "Open draft"}</a></article>`,
        )
        .join("")}
      ${resource.nextCursor ? `<button class="shared-feed-chip" data-org-publish="more"${resource.loading ? " disabled" : ""}>Load more drafts</button>` : ""}
      </div></section>`;
  }
  async function discardRetry() {
    const scope = context(),
      pending = scope && readPending(scope);
    if (!pending || retrying) return;
    if (
      !(await confirm({
        title: "Discard saved retry?",
        message:
          "This removes the saved retry from this browser. Any draft already saved remains in the organization queue. Review the queue before starting another post.",
        confirmLabel: "Discard retry",
      }))
    )
      return;
    if (
      !sameContext(scope) ||
      JSON.stringify(readPending(scope)) !== JSON.stringify(pending)
    )
      return;
    localStorage.removeItem(storageKey(scope));
    await load({ force: true });
  }
  document.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-org-draft-action]");
    if (action && context()) {
      event.preventDefault();
      draftAction(
        action.dataset.orgDraftAction,
        document.querySelector("[data-org-review-reason]")?.value || "",
      );
      return;
    }
    const button = event.target.closest?.("[data-org-publish]");
    if (!button || !context()) return;
    event.preventDefault();
    if (button.dataset.orgPublish === "refresh") load({ force: true });
    if (button.dataset.orgPublish === "more") load({ more: true });
    if (button.dataset.orgPublish === "discard-retry") discardRetry();
    if (button.dataset.orgPublish === "retry") {
      if (retrying) return;
      const record = readPending(context());
      if (record) {
        retrying = true;
        changed();
        perform(record)
          .catch((error) => {
            resource.error = error.message;
          })
          .finally(() => {
            retrying = false;
            changed();
          });
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (
      !document.hidden &&
      resource.key === keyOf(context()) &&
      resource.drafts.some((d) =>
        ["publishing", "approved_waiting_media"].includes(d.state),
      )
    )
      load({ force: true });
  });
  return {
    load,
    render,
    prepareComposer,
    saveComposer,
    composerAction,
    renderDraftActions,
    draftAction,
    discardRetry,
    workspaceFor,
    reset: () => {
      clearTimeout(timer);
      generation++;
      activeComposer = null;
      resource = empty();
    },
  };
}
