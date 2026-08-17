function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function mediaTypeValue(value) {
  const normalized = stringValue(value).toLowerCase();
  return normalized === "image" || normalized === "video" ? normalized : "";
}

function mediaUrlValue(value) {
  const candidate = stringValue(value);
  if (!candidate) {
    return "";
  }
  if (/^\/(?!\/)/u.test(candidate)) {
    return candidate;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function readyPublicDerivative(raw = {}) {
  const derivative = objectValue(raw.publicDerivative || raw.public_derivative);
  if (stringValue(derivative.status).toLowerCase() !== "ready") {
    return null;
  }
  const url = mediaUrlValue(derivative.url);
  if (!url) {
    return null;
  }
  return {
    derivativeId: stringValue(
      derivative.derivativeId || derivative.derivative_id,
    ),
    provider: stringValue(derivative.provider),
    url,
    thumbnailUrl: mediaUrlValue(
      derivative.thumbnailUrl || derivative.thumbnail_url,
    ),
    status: "ready",
  };
}

function mediaUsageRecords(raw = {}) {
  const candidates =
    raw.usages || raw.usage || raw.provenance || raw.postUsages;
  return Array.isArray(candidates) ? candidates : [];
}

function normalizeCanonicalMediaItem(raw, sourceIndex) {
  const item = objectValue(raw);
  const mediaType = mediaTypeValue(item.mediaType || item.type);
  const publicDerivative = readyPublicDerivative(item);
  if (!mediaType || !publicDerivative) {
    return null;
  }
  const numericOrder = Number(item.order);
  return {
    assetId: stringValue(item.assetId || item.asset_id),
    sourceAssetVersionId: stringValue(
      item.sourceAssetVersionId || item.source_asset_version_id,
    ),
    mediaType,
    altText: stringValue(item.altText || item.alt),
    crop: objectValue(item.crop),
    order:
      Number.isInteger(numericOrder) && numericOrder >= 0
        ? numericOrder
        : sourceIndex,
    publicDerivative,
    usages: mediaUsageRecords(item),
    sourceIndex,
  };
}

function normalizeLegacyMediaItem(rawPost = {}) {
  const post = objectValue(rawPost);
  const normalizedType = mediaTypeValue(post.mediaType || post.type);
  const mediaType =
    normalizedType || (stringValue(post.imageUrl) ? "image" : "video");
  const imageUrl = stringValue(
    post.imageUrl || post.previewUrl || post.thumbUrl,
  );
  const videoUrl = stringValue(post.videoUrl || post.mediaUrl);
  const mp4Url = stringValue(post.mp4Url);
  const playbackId = stringValue(post.playbackId);
  if (
    (mediaType === "image" && !imageUrl) ||
    (mediaType === "video" && !videoUrl && !mp4Url && !playbackId)
  ) {
    return null;
  }
  return {
    assetId: stringValue(post.assetId),
    sourceAssetVersionId: stringValue(
      post.sourceAssetVersionId || post.assetVersionId || post.revisionId,
    ),
    mediaType,
    altText: stringValue(post.altText || post.previewTitle),
    crop: objectValue(post.crop),
    order: 0,
    publicDerivative: null,
    imageUrl,
    videoUrl,
    mp4Url,
    posterUrl: stringValue(
      post.posterUrl || post.thumbUrl || post.previewUrl || post.imageUrl,
    ),
    playbackId,
    durationMs: Number(post.durationMs) || null,
    usages: mediaUsageRecords(post),
    sourceIndex: 0,
  };
}

export function normalizeOrderedPostMedia(rawPost = {}) {
  const post = objectValue(rawPost);
  const hasCanonicalMedia = Array.isArray(post.mediaItems);
  const canonical = hasCanonicalMedia
    ? post.mediaItems
        .map(normalizeCanonicalMediaItem)
        .filter(Boolean)
        .sort(
          (left, right) =>
            left.order - right.order || left.sourceIndex - right.sourceIndex,
        )
        .slice(0, 10)
        .map((item, order) => ({ ...item, order }))
    : [];
  if (hasCanonicalMedia) {
    return canonical;
  }
  const legacy = normalizeLegacyMediaItem(post);
  return legacy ? [legacy] : [];
}

export function mediaPresentation(item = {}) {
  const media = objectValue(item);
  const derivative = objectValue(media.publicDerivative);
  const url = stringValue(derivative.url);
  const thumbnailUrl = stringValue(derivative.thumbnailUrl);
  const mediaType = mediaTypeValue(media.mediaType) || "image";
  if (mediaType === "image") {
    return {
      mediaType,
      imageUrl: url || stringValue(media.imageUrl),
      videoUrl: "",
      mp4Url: "",
      posterUrl: thumbnailUrl || stringValue(media.posterUrl),
      playbackId: "",
      durationMs: Number(media.durationMs) || null,
    };
  }
  return {
    mediaType,
    imageUrl: "",
    videoUrl: url || stringValue(media.videoUrl),
    mp4Url: stringValue(media.mp4Url),
    posterUrl: thumbnailUrl || stringValue(media.posterUrl),
    playbackId: stringValue(media.playbackId),
    durationMs: Number(media.durationMs) || null,
  };
}

export function safePublishedPostPath(value, origin = "") {
  const candidate = stringValue(value);
  if (!candidate || !origin) {
    return "";
  }
  try {
    const url = new URL(candidate, origin);
    if (url.origin !== new URL(origin).origin) {
      return "";
    }
    if (!/^\/posts\/[^/?#]+\/?$/u.test(url.pathname)) {
      return "";
    }
    return url.pathname;
  } catch {
    return "";
  }
}

export function visibleMediaUsageBadges(mediaItem = {}, origin = "") {
  return mediaUsageRecords(mediaItem)
    .filter((record) => {
      const usage = objectValue(record);
      const post = objectValue(usage.post);
      return (
        usage.badgeVisible === true && stringValue(post.status) === "published"
      );
    })
    .map((record) => {
      const usage = objectValue(record);
      const organization = objectValue(usage.organization);
      const post = objectValue(usage.post);
      const path =
        usage.canOpenPost === true
          ? safePublishedPostPath(usage.postPath, origin)
          : "";
      return {
        usageId: stringValue(usage.usageId),
        label: stringValue(organization.displayName) || "Polis organization",
        badgeUrl: mediaUrlValue(organization.badgeUrl),
        postId: stringValue(post.postId),
        path,
      };
    });
}

export function buildComposerMediaItems(upload = {}, mediaType = "") {
  const source = objectValue(upload);
  const raw = objectValue(source.raw);
  const assetId = stringValue(source.assetId || raw.assetId);
  const sourceAssetVersionId = stringValue(
    source.sourceAssetVersionId || raw.sourceAssetVersionId,
  );
  const normalizedType = mediaTypeValue(
    mediaType || source.type || raw.mediaType,
  );
  if (!assetId || !sourceAssetVersionId || !normalizedType) {
    return [];
  }
  return [
    { assetId, sourceAssetVersionId, mediaType: normalizedType, order: 0 },
  ];
}
