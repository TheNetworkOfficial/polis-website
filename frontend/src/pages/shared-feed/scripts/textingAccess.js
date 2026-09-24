/** Retry only the idempotent setup operation, never a queue or message action. */
export async function prepareTextingAccess(
  r,
  state,
  campaignId,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  if (!campaignId) throw new Error("Campaign access could not be verified.");
  state.preparingAccess = true;
  r.changed();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      r.guard();
      const result = (await r.api("/texter/ensure", { campaignId })).texter;
      r.guard();
      if (result?.state === "ready") return;
      if (result?.state !== "preparing")
        throw new Error("Texting access could not be verified.");
      if (attempt < 2)
        await wait(
          Math.max(1000, Math.min(30000, Number(result.retryAfterMs) || 1000)),
        );
    }
    throw new Error(
      "Texting access is still being prepared. Try again shortly.",
    );
  } finally {
    state.preparingAccess = false;
  }
}

/** Delta batches preserve all untouched volunteers and use each saved revision. */
export async function saveAssignmentChanges(api, campaign, selected, onSaved) {
  if (selected.size > 1000)
    throw new Error("A campaign supports up to 1,000 volunteers.");
  const assigned = new Set(campaign.assignedUserIds || []),
    remove = [...assigned].filter((userId) => !selected.has(userId)),
    add = [...selected].filter((userId) => !assigned.has(userId));
  let saved = campaign;
  while (remove.length || add.length) {
    const removeUserIds = remove.slice(0, 50),
      addUserIds = add.slice(0, 50 - removeUserIds.length);
    const result = (
      await api(
        `/campaigns/${encodeURIComponent(campaign.campaignId)}/assignments`,
        {
          expectedRevision: saved.revision,
          addUserIds,
          removeUserIds,
        },
      )
    ).campaign;
    if (
      result?.campaignId !== campaign.campaignId ||
      !Number.isSafeInteger(result.revision) ||
      result.revision <= saved.revision ||
      !Array.isArray(result.assignedUserIds)
    )
      throw new Error("Campaign assignments could not be verified.");
    saved = result;
    onSaved(saved);
    remove.splice(0, removeUserIds.length);
    add.splice(0, addUserIds.length);
  }
  return saved;
}
