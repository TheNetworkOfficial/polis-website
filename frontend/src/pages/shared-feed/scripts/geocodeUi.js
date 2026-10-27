export const geocodeErrors = Object.freeze({
  geocode_credits_insufficient:
    "There are not enough credits for this selection. Review a smaller selection or wait for the next daily reset.",
  geocode_daily_cap_reached:
    "The purchased credit daily limit has been reached. Included credits remain subject to today’s balance.",
  geocode_reset_pending:
    "Daily credits are resetting. Refresh the balance in a moment and review again.",
  geocode_quote_expired:
    "This quote expired. Review the selected addresses again.",
  geocode_selection_changed:
    "The selected contact data changed. Refresh and review this selection again.",
  geocode_quote_amount_changed:
    "This quote changed. Review the current address costs before confirming.",
  geocode_settings_changed:
    "Another administrator updated these settings. Your draft is preserved; refresh and review their changes before saving.",
  geocode_provider_not_ready:
    "New address lookups are temporarily unavailable. Existing geocodes remain available.",
  geocode_cache_not_configured:
    "Address lookup is temporarily unavailable. Your credits have not been spent.",
  geocode_job_busy:
    "An address is currently being processed. Refresh the job before cancelling the remaining work.",
  geocode_reservation_expired:
    "The credit reservation expired. Review the remaining addresses to create a new quote.",
  geocode_billing_hold:
    "A payment adjustment needs administrator review before credits can be spent.",
  geocode_checkout_outcome_review:
    "This purchase needs reconciliation. Check purchase history before starting another checkout.",
  geocode_purchases_unavailable:
    "Credit purchases are not currently available.",
  geocode_payment_terms_required:
    "Read and accept the current credit payment terms before continuing.",
  organization_data_rights_acceptance_required:
    "An authorized signatory must accept the organization data rights addendum.",
  organization_terms_changed:
    "The organization terms changed. Review the current addendum before continuing.",
  organization_legal_profile_changed:
    "The organization legal profile changed. Refresh and review the entity before signing.",
  organization_signatory_required:
    "Only an authorized organization signatory can accept these terms.",
  geocode_batch_limit_exceeded:
    "This selection is larger than one review batch. Use a prepared selection or choose fewer contacts.",
  geocode_nothing_to_process:
    "No eligible addresses in this selection need geocoding.",
});

export const geocodeReadPost = (path) =>
  ["/geocoding/credits/quotes", "/household-map"].includes(path);
export const geocodeTerminal = (job) =>
  ["complete", "cancelled"].includes(job?.status);
export const geocodeLabel = (value) => String(value || "").replaceAll("_", " ");
export const geocodeSelectionKey = (value) => JSON.stringify(value || null);
