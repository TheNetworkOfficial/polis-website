const blockers = {
  purchases_not_enabled: [
    "Purchasing has not been enabled for this organization. Your existing balance is unchanged.",
    "Polis support",
    "check-status",
  ],
  billing_setup_required: [
    "Your organization’s billing setup needs review before purchases can open.",
    "Polis support",
    "check-status",
  ],
  messaging_charge_disclosure_required: [
    "Your messaging charge details need review before purchases can open.",
    "Polis support",
    "check-status",
  ],
  tax_setup_required: [
    "Your purchase tax policy needs review. This does not change your existing balance.",
    "Polis support",
    "check-status",
  ],
  purchase_window_expiring: [
    "A purchase approval or rates review is due. Polis support must review the listed deadline before checkout opens.",
    "Polis support",
    "check-status",
  ],
  processor_fee_review_required: [
    "The payment processing fee needs review before checkout opens.",
    "Polis support",
    "check-status",
  ],
  payment_terms_required: [
    "Current payment terms must be available before checkout opens.",
    "Polis support",
    "check-status",
  ],
  funding_environment_mismatch: [
    "This balance needs payment support review. Don’t pay again to resolve it.",
    "Polis support",
    "check-status",
  ],
  billing_contact_required: [
    "Verify your billing details to add funds.",
    "Organization administrator",
    "billing-details",
  ],
  billing_contact_not_ready: [
    "Finish verifying your billing email to add funds.",
    "Organization administrator",
    "billing-details",
  ],
  registration_approval_required: [
    "Your registration is awaiting review. Your saved campaign can still be edited.",
    "Polis support",
    "registration",
  ],
  provider_acceptance_required: [
    "Your texting activation needs review. Your saved work is retained.",
    "Polis support",
    "registration",
  ],
  provider_acceptance_evidence_required: [
    "Your texting activation needs review. Your saved work is retained.",
    "Polis support",
    "registration",
  ],
  verified_tariff_required: [
    "Your texting rates need review before this purchase can continue.",
    "Polis support",
    "check-status",
  ],
  prepaid_tariff_required: [
    "Your texting rates need review before this purchase can continue.",
    "Polis support",
    "check-status",
  ],
  tax_configuration_required: [
    "Your purchase tax policy needs review. This does not change your existing balance.",
    "Polis support",
    "check-status",
  ],
  tax_collection_required: [
    "Your purchase tax policy needs review. This does not change your existing balance.",
    "Polis support",
    "check-status",
  ],
  acceptance_purchase_expired: [
    "The temporary purchase approval ended. Polis support must review normal purchasing access.",
    "Polis support",
    "check-status",
  ],
  acceptance_purchase_completed: [
    "The one-time purchase is complete. Polis support must review normal purchasing access.",
    "Polis support",
    "check-status",
  ],
  billing_hold: [
    "A billing hold needs review. Adding funds will not remove it.",
    "Polis support",
    "check-status",
  ],
  funding_required: [
    "Your organization needs additional texting funds.",
    "Organization administrator",
    "balance",
  ],
  provider_funding_required: [
    "The texting service account needs review. Do not make another customer payment to resolve it.",
    "Polis support",
    "check-status",
  ],
  volunteer_assignment_required: [
    "Assign a volunteer to this campaign.",
    "Campaign manager",
    "team",
  ],
  operator_assignment_required: [
    "Assign a volunteer to this campaign.",
    "Campaign manager",
    "team",
  ],
  open_campaign_required: [
    "Review and open the prepared campaign before volunteers can text.",
    "Campaign manager",
    "campaign",
  ],
  audience_not_prepared: [
    "Prepare the saved recipients and message.",
    "Campaign manager",
    "prepare",
  ],
  content_not_prepared: [
    "Prepare the saved recipients and message.",
    "Campaign manager",
    "prepare",
  ],
  delivery_window_expired: [
    "The saved delivery window has ended. Review the campaign timing.",
    "Campaign manager",
    "campaign",
  ],
  organization_admin_required: [
    "An organization administrator with billing access must review this step.",
    "Organization administrator",
    "billing-details",
  ],
};

/** Display only known customer guidance; server capabilities still authorize every action. */
export function textingBlocker(value) {
  const code = typeof value === "string" ? value : value?.code;
  const row = blockers[code];
  return row
    ? { code, message: row[0], owner: row[1], nextAction: row[2] }
    : {
        code: "setup_review_required",
        message:
          "A texting setup requirement needs review. Your saved work is retained.",
        owner: "Polis support",
        nextAction: "check-status",
      };
}

export function textingPurchaseBlockers(billing) {
  const structured = billing.purchaseReadiness;
  const reasons = Array.isArray(structured?.blockers)
    ? structured.blockers
    : (billing.blockedReasons || []).filter(
        (code) =>
          Object.hasOwn(blockers, code) &&
          ![
            "funding_required",
            "provider_funding_required",
            "volunteer_assignment_required",
            "operator_assignment_required",
            "open_campaign_required",
            "audience_not_prepared",
            "content_not_prepared",
            "delivery_window_expired",
          ].includes(code),
      );
  return reasons.length ? reasons.map(textingBlocker) : [textingBlocker(null)];
}

/** Never infer a captured payment from a checkout return or from message reservations. */
export function textingPurchaseStatus(purchase, { delayed = false } = {}) {
  const terminal = {
    funded: [
      "Funds added",
      "Your confirmed payment was added to the texting balance.",
    ],
    failed: [
      "Payment failed",
      "This payment failed. Check the saved purchase before starting another payment.",
    ],
    canceled: [
      "Checkout canceled",
      "Checkout was closed. No funds are added until payment is confirmed.",
    ],
    expired: [
      "Checkout expired",
      "This checkout expired. Check the saved purchase before starting another payment.",
    ],
    refunded: [
      "Payment refunded",
      "Your balance reflects the confirmed refund.",
    ],
    disputed: [
      "Payment under review",
      "This payment needs review. Your balance reflects confirmed account activity.",
    ],
    reversed: [
      "Payment reversed",
      "Your balance reflects the confirmed reversal.",
    ],
  }[purchase?.status];
  if (terminal)
    return { title: terminal[0], message: terminal[1], terminal: true };
  if (["payment_confirmed", "credit_pending"].includes(purchase?.status))
    return {
      title: "Updating your balance",
      message:
        "Payment received. We’re updating your texting balance. Don’t pay again.",
      terminal: false,
    };
  if (["created", "checkout_open"].includes(purchase?.status))
    return {
      title: "Checkout not finished",
      message: "Continue the same saved checkout to finish this payment.",
      terminal: false,
    };
  return {
    title: delayed ? "Payment is still processing" : "Payment processing",
    message:
      "We’re confirming your payment. You can leave this page; don’t pay again.",
    terminal: false,
  };
}
