export const campaignPreparationPending = (campaign) =>
  !!campaign?.preparation &&
  campaign.preparation.status !== "complete" &&
  ["draft", "prepared"].includes(campaign.status);

/** Poll durable preparation only. New recipient/provider approval is never created here. */
export function createCampaignPreparation(
  r,
  state,
  {
    schedule = setTimeout,
    cancel = clearTimeout,
    now = Date.now,
    visible = () => globalThis.document?.hidden !== true,
    maxReads = 180,
    maxDurationMs = 3600000,
  } = {},
) {
  let timer,
    flight,
    disposed = false,
    reads = 0,
    startedAt = now(),
    progressAt = now(),
    progressKey = "",
    readFailures = 0,
    recoveringWrite = false,
    preparationId;
  const automaticAttempts = new Set();
  const active = () => {
    if (disposed) return false;
    try {
      r.guard();
      return true;
    } catch {
      return false;
    }
  };
  const pending = campaignPreparationPending;
  function stopTimer() {
    cancel(timer);
    timer = null;
  }
  function accept(campaign, expectedId) {
    if (
      !campaign ||
      campaign.campaignId !== expectedId ||
      !Number.isSafeInteger(campaign.revision)
    )
      throw new Error("Campaign preparation status could not be verified.");
    const s = state();
    // A status read can finish after another action saved a newer campaign.
    if (
      s.campaign?.campaignId === expectedId &&
      campaign.revision < s.campaign.revision
    )
      return false;
    if (campaign.preparation?.preparationId !== preparationId) {
      preparationId = campaign.preparation?.preparationId;
      reads = 0;
      startedAt = now();
      progressAt = now();
      s.preparationPollingPaused = false;
      s.preparationCompletionAttempted = false;
      s.preparationPollError = "";
      s.preparationRetryMessage = "";
      readFailures = 0;
      recoveringWrite = false;
    }
    const nextProgress = `${campaign.preparation?.status}:${campaign.preparation?.stage}`;
    if (nextProgress !== progressKey) {
      progressKey = nextProgress;
      progressAt = now();
    }
    s.campaign = campaign;
    s.preparingRecipients = !!pending(campaign);
    if (!pending(campaign)) {
      s.preparationPollingPaused = false;
      s.preparationPollError = "";
      s.preparationRetryMessage = "";
      recoveringWrite = false;
    }
    return true;
  }
  function arm() {
    stopTimer();
    if (!active() || flight) return;
    const s = state(),
      p = s.campaign?.preparation;
    if (
      !pending(s.campaign) ||
      (p.status === "needs_attention" && !recoveringWrite && !readFailures) ||
      s.preparationPollError
    )
      return;
    if (reads >= maxReads || now() - startedAt >= maxDurationMs) {
      s.preparationPollingPaused = true;
      r.changed();
      return;
    }
    if (!visible()) return;
    timer = schedule(
      () => {
        timer = null;
        if (!active() || !visible()) return;
        if (r.busy()) {
          arm();
          return;
        }
        return refresh().catch(() => {});
      },
      Math.max(
        2000,
        Math.min(
          30000,
          Math.max(
            Number(p.pollAfterMs) || 5000,
            readFailures
              ? 5000 * 2 ** (readFailures - 1)
              : now() - progressAt < 60000
                ? 5000
                : now() - progressAt < 300000
                  ? 15000
                  : 30000,
          ),
        ),
      ),
    );
  }
  function observe(campaign) {
    if (!active()) return;
    accept(campaign, campaign?.campaignId);
    arm();
  }
  async function refresh({ manual = false, resume = false } = {}) {
    if (!active()) return;
    if (flight) return flight;
    stopTimer();
    const s = state(),
      campaignId = s.campaign?.campaignId;
    if (!campaignId) return;
    if (manual) {
      reads = 0;
      startedAt = now();
      s.preparationPollingPaused = false;
      s.preparationPollError = "";
      s.preparationRetryMessage = "";
      readFailures = 0;
    }
    const execute = async () => {
      let writing = false;
      try {
        reads++;
        const saved = (
          await r.api(`/campaigns/${encodeURIComponent(campaignId)}`)
        ).campaign;
        if (!active()) return;
        if (!accept(saved, campaignId)) return;
        readFailures = 0;
        s.preparationRetryMessage = "";
        const p = saved.preparation;
        if (
          recoveringWrite &&
          ["ready_to_finalize", "needs_attention"].includes(p?.status)
        ) {
          recoveringWrite = false;
          s.preparationPollingPaused = true;
          s.preparationPollError = p.canResume
            ? "The saved campaign still needs completion. Resume this approved preparation when you are ready."
            : "The saved preparation still needs review before it can continue. Check its saved status after the issue has been resolved.";
          return;
        }
        const automatic =
          r.can("createCampaigns") &&
          pending(saved) &&
          p?.status === "ready_to_finalize" &&
          p.automaticResume === true &&
          p.canResume === true &&
          !automaticAttempts.has(p.preparationId);
        if (resume || automatic) {
          if (
            !r.can("createCampaigns") ||
            !pending(saved) ||
            !p?.preparationId ||
            p.canResume !== true
          )
            throw new Error(
              "This saved preparation cannot be resumed. Refresh its status before continuing.",
            );
          automaticAttempts.add(p.preparationId);
          s.preparationCompletionAttempted = true;
          writing = true;
          const result = await r.api(
            `/campaigns/${encodeURIComponent(campaignId)}/preparation/resume`,
            {
              preparationId: p.preparationId,
              expectedRevision: saved.revision,
            },
          );
          if (!active()) return;
          accept(result.campaign, campaignId);
          recoveringWrite = false;
        }
      } catch (error) {
        if (!active()) return;
        if ([401, 403].includes(error?.status)) {
          dispose();
          r.fail(error);
          r.changed();
        } else if (writing) {
          recoveringWrite = true;
          s.preparationRetryMessage =
            "Checking the saved result of campaign preparation…";
        } else if (
          (!error?.status ||
            error.status >= 500 ||
            [408, 429].includes(error.status)) &&
          ++readFailures <= 3
        ) {
          s.preparationRetryMessage =
            "The connection was interrupted. Checking saved preparation again…";
        } else {
          s.preparationPollingPaused = true;
          s.preparationPollError =
            "The latest preparation result could not be confirmed. Check the saved status before resuming.";
        }
        if (manual && !writing && !s.preparationRetryMessage) throw error;
      }
    };
    flight = execute();
    try {
      await flight;
    } finally {
      flight = null;
      if (active()) {
        r.changed();
        arm();
      }
    }
  }
  function visibilityChanged() {
    if (!active()) return;
    if (!visible()) stopTimer();
    else arm();
  }
  function dispose() {
    disposed = true;
    stopTimer();
    globalThis.document?.removeEventListener?.(
      "visibilitychange",
      visibilityChanged,
    );
  }
  globalThis.document?.addEventListener?.(
    "visibilitychange",
    visibilityChanged,
  );
  return { observe, refresh, dispose };
}
