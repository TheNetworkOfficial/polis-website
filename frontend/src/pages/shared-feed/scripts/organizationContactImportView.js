import {
  escapeText as e,
  field,
  select,
  head,
  notice,
  count,
  list,
} from "./textingWorkspaceUi";
import { contactIcon as icon } from "./organizationContactPresentation";
import { contactNameReview } from "./organizationContactNameReview";

export const contactNameFormatOptions = [
  ["auto", "Auto-detect"],
  ["family_given", "Last, First Middle"],
  ["given_family", "First Middle Last"],
  ["keep", "Keep full name only"],
];

function illustration(done = false) {
  return `<div class="pt-import-illustration" aria-hidden="true"><span class="pt-import-sheet">${icon(done ? "check" : "people")}<i></i><i></i><i></i></span><span class="pt-import-orbit">${icon(done ? "check" : "plus")}</span></div>`;
}

/** Choose / review / import share the existing controller and durable row receipts. */
export function renderContactImport({
  s,
  canImport,
  busy,
  b,
  details,
  fields,
  guessField,
  prefix,
  importMatches,
  importReport,
  sourceNamespace,
  supportsNames,
}) {
  const formName = (suffix) => `${prefix}-${suffix}`;
  const review = !!s.filePreview;
  const format =
    s.importDraft?.nameFormat ||
    (s.resumeImport ? s.resumeImport.namePolicy?.format || "keep" : "auto");
  const namesAllowed = !s.nameParsingUnavailable || format === "keep";
  const availableFields = [...fields.filter((item) => !item.readOnly)];
  const nameReview =
    s.resumeImport?.namePolicy?.format === "auto"
      ? s.filePreview?.nameReviews?.auto ||
        contactNameReview(s.filePreview, format)
      : contactNameReview(s.filePreview, format);
  const examples =
    s.importMatchPreview?.nameAnalysis?.examples || nameReview.examples;
  const names =
    supportsNames && !s.nameParsingUnavailable
      ? `<section class="pt-import-names"><div class="pt-row"><h3>Names</h3><span class="pt-import-badge">Whole file checked</span></div>${select("nameFormat", "Name format", contactNameFormatOptions, format)}${examples
          .slice(0, 1)
          .map(
            (row) =>
              `<div class="pt-import-name-example"><span>${e(row.original || "Name parts supplied")}</span><small class="pt-import-name-labels">First / Middle / Last</small><strong>${[row.firstName, row.middleName, row.lastName].some(Boolean) ? e([row.firstName, row.middleName, row.lastName].filter(Boolean).join(" / ")) : "Full name kept"}${row.status === "preserved" ? " · Existing parts kept" : ""}</strong></div>`,
          )
          .join(
            "",
          )}<small>Originals kept. Unclear names stay whole.</small></section>`
      : notice(
          "Full names kept",
          "Automatic name conversion is unavailable on this server. Original names and columns stay.",
        ) +
        select(
          "nameFormat",
          "Name format",
          [["keep", "Keep full name only"]],
          "keep",
        );
  const saved =
    s.importProgress?.processed ??
    (s.importJob?.accepted || 0) + (s.importJob?.conflicts || 0);
  const progress =
    s.importSaving || s.importProgress || s.importJob
      ? `<section class="pt-notice pt-import-status" role="status"><strong>${s.importSaving ? "Saving your contacts" : "Import paused"}</strong><p>${count(saved)} source rows confirmed${s.filePreview?.rowCount ? ` · ${count(s.filePreview.rowCount)} in this file` : ""}</p><p>Keep this page open while saving. If interrupted, reselect the unchanged file to resume safely.</p></section>`
      : "";
  const complete = s.importCompleted
    ? `<section class="pt-card pt-import-status">${illustration(true)}<h2>${s.importCompleted.publication?.status === "ready" ? "Your list is in." : "Saved. Almost ready."}</h2><p><strong>${count(s.importCompleted.rows)} source rows saved</strong></p><p class="pt-muted">${s.importCompleted.publication?.status === "ready" ? "Ready in Contacts." : "Search and contact lists are updating. Saved rows stay safe."}</p><p class="pt-muted">All original values are kept. No messages have been sent.</p>${b("panel", "Open Contacts", { value: "contacts" })}${b("import-new", "Import another file", { secondary: true })}</section>`
    : "";
  const matching = review
    ? details(
        "Field matching",
        `<div class="pt-contact-mapping">${s.filePreview.headers.map((header, index) => select(`column_${index}`, `${index + 1}. ${header || "Unnamed column"}`, [["__custom__", "Keep as its own field"], ...availableFields.map((item) => [item.fieldId, item.label])], s.importDraft?.mapping?.[String(index)] ?? s.importPayload?.mapping?.[String(index)] ?? guessField(header))).join("")}</div>`,
      )
    : "";
  const advanced = review
    ? details(
        "Advanced",
        `<div class="pt-fields">${field("name", "Import name", s.importDraft?.name || s.importPayload?.name || s.file?.name || "", { required: true })}${field("sourceNamespace", "Source namespace", sourceNamespace, { required: true })}</div>${details("Replace a source", "<p>Import and review the new file first. Remove previous source memberships separately from a reviewed selection.</p>")}`,
      )
    : "";
  const sourceSample = review
    ? details(
        "Source sample",
        `<div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr>${s.filePreview.headers.map((header) => `<th>${e(header)}</th>`).join("")}</tr></thead><tbody>${s.filePreview.rows
          .slice(0, 8)
          .map(
            (row) =>
              `<tr>${row.map((value) => `<td>${e(value)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      )
    : "";
  const choose = `<form data-workspace-form="${formName("import-preview")}"><label class="pt-field"><span>Contact file</span><input type="file" accept=".csv,.tsv,.txt" data-contact-change="${prefix}-file"></label>${details(
    "File settings",
    `<div class="pt-fields">${select(
      "delimiter",
      "File format",
      [
        [",", "CSV"],
        ["\t", "TSV"],
        ["|", "Pipe separated"],
      ],
      s.delimiter || ",",
    )}${select(
      "encoding",
      "Encoding",
      [
        ["utf-8", "UTF-8"],
        ["utf-16le", "UTF-16 LE"],
        ["windows-1252", "Windows-1252"],
      ],
      s.encoding || "utf-8",
    )}</div>`,
  )}<button class="pt-btn" type="submit">Review contacts</button></form>`;
  const confirmation = `<footer class="pt-import-footer"><label class="pt-workspace-check"><input type="checkbox" data-contact-change="${prefix}-import-reviewed"${s.importReviewed ? " checked" : ""}${(!s.resumeImport && !s.importMatchPreview) || !namesAllowed || busy ? " disabled" : ""}>I reviewed this source’s permitted use.</label><button type="submit" class="pt-btn"${!s.importReviewed || !namesAllowed || busy ? " disabled" : ""}>${s.importJob ? "Resume import" : "Import contacts"}</button></footer>`;
  const checks = review
    ? details(
        "Additional checks",
        `<p>${count(s.filePreview.phoneEntries)} phone entries · ${count(s.filePreview.missingPhones)} rows without a mapped phone.</p><p>${count(nameReview.counts.derived)} source names can be split · ${count(nameReview.counts.ambiguous + nameReview.counts.kept)} kept whole · ${count(nameReview.counts.explicit)} already supplied.</p><p>Missing phones do not remove contacts. Check shared numbers before texting.</p>${sourceSample}${s.resumeImport ? "" : importMatches()}`,
      )
    : "";
  const reviewContent = review
    ? `<div class="pt-import-file"><strong>${e(s.file?.name || s.resumeImport?.name || "Contact file")}</strong>${b("import-change-file", "Change", { secondary: true })}</div><p class="pt-import-inline-stats">${count(s.filePreview.rowCount)} source rows · ${count(s.filePreview.headers.length)} columns retained</p><form class="pt-import-review-form" data-workspace-form="${formName("import-save")}"><div class="pt-import-review-body" role="region" aria-label="Import review details" tabindex="0">${s.resumeImport || busy ? "<fieldset disabled>" : ""}${names}${select(
        "sourcePolicy",
        "Permitted use",
        [
          ["unreviewed", "Not reviewed"],
          ["manual_sms", "Manual texting permitted"],
          ["sms_with_opt_in", "Only with recorded opt-in"],
          ["not_for_sms", "Not permitted for texting"],
        ],
        s.importDraft?.sourcePolicy ||
          s.importPayload?.sourcePolicy?.permittedPurpose ||
          "unreviewed",
      )}${matching}${advanced}${checks}${s.resumeImport || busy ? "</fieldset>" : ""}${progress}</div>${confirmation}</form>`
    : `${illustration()}<h2>Add your contacts</h2><p class="pt-muted">Choose a CSV, TSV, or text file. Every column stays.</p>${choose}`;
  const content = canImport
    ? complete ||
      `<section class="pt-card pt-import-card${review ? " is-review" : ""}">${s.resumeImport ? notice(`Resume ${s.resumeImport.name}`, "Use the original unchanged file to resume.") : ""}${reviewContent}${review ? "" : progress}</section>`
    : "";
  return (
    head(
      "CONTACT BOOK",
      review ? "Review contacts" : "Import contacts",
      "",
      b("panel", "Back to contacts", { value: "contacts", secondary: true }),
    ) +
    `<ol class="pt-import-steps" aria-label="Import steps"><li${!review && !complete ? ' aria-current="step"' : ""}>1 Choose</li><li${review ? ' aria-current="step"' : ""}>2 Review</li><li${s.importSaving || complete ? ' aria-current="step"' : ""}>3 Import</li></ol>` +
    content +
    details(
      "Source history",
      `<section class="pt-card">${list(s.imports).length ? s.imports.map((job) => `<article class="pt-row"><div><strong>${e(job.name || "Contact import")}</strong><p>${e(job.status)} · ${count(job.accepted || 0)} accepted · ${count(job.conflicts || 0)} need review</p></div><div class="pt-actions">${canImport && job.status === "open" ? b("import-resume", "Resume", { secondary: true, value: job.importId }) : canImport && job.status === "completing" ? b("import-finalize", "Finish import", { secondary: true, value: job.importId }) : ""}${b("import-report", "Review records", { secondary: true, value: job.importId })}</div></article>`).join("") : '<p class="pt-muted">Your imports will appear here.</p>'}${s.importCursor ? b("imports-more", "More imports", { secondary: true }) : ""}</section>`,
    ) +
    importReport()
  );
}
