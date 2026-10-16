import { inspectContactFile } from "./organizationContactImport";
import {
  deriveImportNames,
  IMPORT_NAME_FORMATS,
} from "./organizationContactImportNames";

const emptyReview = (format) => ({
  version: 1,
  sampleOnly: false,
  format,
  suggestedFormat: "keep",
  counts: {
    rows: 0,
    derived: 0,
    ambiguous: 0,
    explicit: 0,
    preserved: 0,
    kept: 0,
  },
  examples: [],
  reasons: [],
});

/** Constant-space whole-file review: no source row is changed or discarded. */
export async function reviewContactFile(
  file,
  delimiter,
  encoding,
  options = {},
) {
  const reviews = Object.fromEntries(
    IMPORT_NAME_FORMATS.map((format) => [format, emptyReview(format)]),
  );
  const suggested = new Set();
  let phones = 0;
  let missingPhones = 0;
  const preview = await inspectContactFile(file, delimiter, encoding, {
    ...options,
    visit(row, headers, index) {
      const mapped = {};
      headers.forEach((header, column) => {
        const target =
          options.mapping?.[String(column)] ?? options.guessField?.(header);
        if (target && target !== "__custom__" && column < row.length)
          mapped[target] = row[column];
      });
      if (mapped.phone?.trim()) phones++;
      else missingPhones++;
      for (const format of IMPORT_NAME_FORMATS) {
        const result = deriveImportNames(mapped, { version: 1, format });
        const analysis = result.analysis;
        const review = reviews[format];
        review.counts.rows++;
        if (Object.hasOwn(review.counts, analysis.status))
          review.counts[analysis.status]++;
        if (review.examples.length < 8)
          review.examples.push({
            row: index,
            original: analysis.original,
            ...analysis.proposed,
            ...Object.fromEntries(
              ["firstName", "middleName", "lastName"]
                .filter(
                  (field) =>
                    result.fields[field] != null &&
                    String(result.fields[field]).trim() !== "",
                )
                .map((field) => [field, result.fields[field]]),
            ),
            status: analysis.status,
            reason: analysis.reason,
          });
        if (!review.reasons.includes(analysis.reason))
          review.reasons.push(analysis.reason);
        if (format === "auto" && analysis.suggestedFormat !== "keep")
          suggested.add(analysis.suggestedFormat);
      }
    },
  });
  const suggestedFormat = suggested.size === 1 ? [...suggested][0] : "keep";
  for (const review of Object.values(reviews))
    review.suggestedFormat = suggestedFormat;
  return {
    ...preview,
    nameReviews: reviews,
    suggestedFormat,
    phoneEntries: phones,
    missingPhones,
  };
}

/** Auto is accepted from the complete file, never from the match sample. */
export function reviewedNamePolicy(preview, selected = "auto") {
  return {
    version: 1,
    format: selected === "auto" ? preview?.suggestedFormat || "keep" : selected,
  };
}

export function contactNameReview(preview, selected = "auto") {
  return (
    preview?.nameReviews?.[reviewedNamePolicy(preview, selected).format] ||
    emptyReview("keep")
  );
}
