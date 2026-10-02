const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const label = (value) => String(value ?? "").replaceAll("_", " ");
const valueText = (value) =>
  Array.isArray(value)
    ? value.map(valueText).join("; ")
    : value && typeof value === "object"
      ? Object.entries(value)
          .map(([key, item]) => `${label(key)}: ${valueText(item)}`)
          .join("; ")
      : label(value);
const signText = (value) => {
  const row = object(value);
  if (!Object.keys(row).length) return label(value);
  return [
    row.name || row.candidateName || row.candidateId,
    row.party,
    row.office,
    row.quantity == null ? null : `Quantity: ${row.quantity}`,
  ]
    .filter(Boolean)
    .join(" · ");
};

// Produces plain text only. The caller escapes every line before rendering.
export function canvassingJournalPresentation(entry = {}) {
  const property = object(entry.property),
    round = object(entry.round),
    place = object(entry.place);
  const lines = [
    ...(entry.deleted ? ["This visit was retracted."] : []),
    `Recorded: ${entry.recordedAt || "Unknown"}`,
    `Round: ${round.label || round.roundId || "Unassigned"}`,
    ...[
      place.addressLabel,
      place.unitLabel ? `Unit: ${place.unitLabel}` : null,
    ].filter(Boolean),
    "Household observations; these are not personal statements by each resident.",
    ...(property.yardSignStatus
      ? [`Sign check: ${label(property.yardSignStatus)}`]
      : []),
  ];
  for (const [key, fallback, title] of [
    ["yardSigns", "yardSignCandidateIds", "Observed signs"],
    ["notSeenSigns", "notSeenCandidateIds", "Signs not seen"],
    ["requestedSigns", "requestedSigns", "Recorded sign requests"],
    ["deliveredSigns", "deliveredSigns", "Recorded sign deliveries"],
  ]) {
    const values = property[key]?.length ? property[key] : property[fallback];
    if (Array.isArray(values) && values.length)
      lines.push(`${title}: ${values.map(signText).join("; ")}`);
  }
  if (entry.snapshotStatus === "legacy_identifiers_only")
    lines.push(
      "Historical candidate labels were not recorded; original identifiers are shown.",
    );
  for (const [key, title] of Object.entries({
    contactResponse: "Recorded household response",
    notes: "Notes",
    followUpActions: "Recorded follow-up",
    followUpDetails: "Follow-up details",
    noKnockReason: "Do not knock reason",
    dangerReport: "Safety report",
  })) {
    const value = valueText(property[key]);
    if (value) lines.push(`${title}: ${value}`);
  }
  const status = entry.contactProcessing?.status;
  lines.push(
    {
      ready: "Contact Book: up to date",
      pending: "Contact Book: processing",
      failed:
        "Contact Book: processing needs another attempt. The saved visit remains available.",
    }[status] || "Contact Book: historical processing has not been completed",
  );
  return {
    title: label(property.outcome) || "Address and unit observation",
    lines,
    canRetry:
      status === "failed" &&
      entry.canRetryContacts === true &&
      typeof entry.submissionId === "string",
  };
}
