import { checksumBlob } from "../../files/scripts/sha256";

/** Upload exact bytes before parsing. The completed S3 version and digest are
 * immutable import evidence; parsed rows are never labeled as the original. */
export async function archiveContactOriginal(
  file,
  {
    api,
    guard,
    upload = fetch,
    pending,
    remember = () => {},
    progress = () => {},
    signal,
  },
) {
  progress("Checking original file");
  const checksum = await checksumBlob(file);
  const sha256 = Array.from(atob(checksum), (value) =>
    value.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
  guard();
  if (pending?.sha256 === sha256 && pending?.size === file.size) {
    const existing = (
      await api(`/import-originals/${encodeURIComponent(pending.id)}`)
    ).original;
    guard();
    if (existing?.status === "ready") {
      if (existing.sha256 !== sha256 || existing.size !== file.size)
        throw new Error("The archived original does not match this file.");
      progress("Original archive verified; preparing contact review");
      return existing;
    }
  }
  const { original } =
    pending?.sha256 === sha256 && pending?.size === file.size
      ? await api(
          `/import-originals/${encodeURIComponent(pending.id)}/resume`,
          {},
        )
      : await api("/import-originals", {
          filename: file.name,
          size: file.size,
          sha256,
        });
  remember({ ...original, sha256, size: file.size });
  guard();
  progress("Archiving exact original bytes");
  const url = new URL(original.uploadUrl);
  if (url.protocol !== "https:")
    throw new Error("Original file storage is unavailable.");
  const response = await upload(url.href, {
    method: "PUT",
    headers: original.headers,
    body: file,
    credentials: "omit",
    signal,
  });
  guard();
  if (!response.ok)
    throw new Error(
      "The original file could not be archived. Retry before importing.",
    );
  const versionId = response.headers.get("x-amz-version-id");
  if (!versionId)
    throw new Error(
      "Original file verification is unavailable. Contact your administrator.",
    );
  const completed = await api(
    `/import-originals/${encodeURIComponent(original.id)}/complete`,
    { versionId },
  );
  progress("Original archived; preparing contact review");
  return completed.original;
}
