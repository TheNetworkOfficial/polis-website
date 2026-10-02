const version = 1;
const lifetime = 7 * 86400000;
const draftKeys = [
  "campaignId",
  "name",
  "audienceId",
  "templateText",
  "mediaId",
  "budgetMicros",
  "deliveryNotBeforeMs",
  "deliveryBeforeMs",
  "deliverySchedule",
];

/** This tab retains only the user's draft, selection intent and job references. No contact rows or grants. */
export function createCampaignDraftStore(
  { userId, organizationId },
  { storage, now = Date.now } = {},
) {
  const key = `polis.texting.draft.${encodeURIComponent(userId || "")}.${encodeURIComponent(organizationId || "")}`;
  const available = () => storage || globalThis.sessionStorage;
  function clear() {
    try {
      available()?.removeItem(key);
    } catch {
      /* Storage may be disabled. */
    }
  }
  function read() {
    try {
      const raw = available()?.getItem(key);
      if (!raw || raw.length > 350000) return null;
      const saved = JSON.parse(raw);
      if (
        saved.version !== version ||
        saved.userId !== userId ||
        saved.organizationId !== organizationId ||
        !Number.isSafeInteger(saved.savedAt) ||
        now() - saved.savedAt > lifetime ||
        saved.savedAt > now() + 60000
      ) {
        clear();
        return null;
      }
      return saved;
    } catch {
      clear();
      return null;
    }
  }
  function save(draft, recipients, composeStep) {
    if (!userId || !organizationId || !draft?.campaignId) return;
    const value = {
      version,
      userId,
      organizationId,
      savedAt: now(),
      draft: Object.fromEntries(
        draftKeys
          .filter((name) => draft[name] !== undefined)
          .map((name) => [name, draft[name]]),
      ),
      composeStep: composeStep === "message" ? "message" : "recipients",
      recipients,
    };
    try {
      const raw = JSON.stringify(value);
      if (raw.length <= 350000) available()?.setItem(key, raw);
    } catch {
      /* In-memory draft still works without browser storage. */
    }
  }
  return { read, save, clear };
}
