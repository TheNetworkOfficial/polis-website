/** Five nearby pages, shifting toward either edge without growing with the contact book. */
export function contactPageWindow(current, totalPages, width = 5) {
  const page = Number.isSafeInteger(current) && current > 0 ? current : 1;
  const total =
    Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : page;
  const start = Math.max(
    1,
    Math.min(page - Math.floor(width / 2), total - width + 1),
  );
  return Array.from(
    { length: Math.min(width, total) },
    (_, index) => start + index,
  );
}

/** Partial directories expose only whole pages; the final short page waits for completion. */
export function contactDirectoryHasPage(job, page, size) {
  const directory = job?.pageDirectory;
  if (!directory || !Number.isSafeInteger(page) || page < 1) return false;
  if (directory.status === "ready") {
    return (
      Number.isSafeInteger(job.total) &&
      page <= Math.max(1, Math.ceil(job.total / size))
    );
  }
  return (
    directory.status === "building" &&
    Number.isSafeInteger(directory.readyThrough) &&
    page * size <= directory.readyThrough
  );
}
