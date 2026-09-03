import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL(
  "../../frontend/src/pages/shared-feed/scripts/postMedia.js",
  import.meta.url,
);
const source = await readFile(sourceUrl, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const {
  buildComposerMediaItems,
  mediaPresentation,
  normalizeOrderedPostMedia,
  visibleMediaUsageBadges,
} = await import(moduleUrl);

function canonicalMedia(order, overrides = {}) {
  return {
    assetId: `asset-${order}`,
    sourceAssetVersionId: `version-${order}`,
    mediaType: "image",
    order,
    publicDerivative: {
      derivativeId: `derivative-${order}`,
      provider: "cloudflare",
      url: `https://media.polis.test/image-${order}.jpg`,
      status: "ready",
    },
    ...overrides,
  };
}

test("legacy single-media posts normalize as one ordered media item", () => {
  const media = normalizeOrderedPostMedia({
    postId: "legacy-post",
    type: "image",
    imageUrl: "https://media.polis.test/legacy.jpg",
    altText: "A legacy campaign photo",
  });

  assert.equal(media.length, 1);
  assert.equal(media[0].order, 0);
  assert.equal(media[0].mediaType, "image");
  assert.equal(
    mediaPresentation(media[0]).imageUrl,
    "https://media.polis.test/legacy.jpg",
  );
});

test("canonical media is stably ordered, made contiguous, and bounded to ten", () => {
  const media = normalizeOrderedPostMedia({
    mediaItems: [
      canonicalMedia(8),
      canonicalMedia(1, { assetId: "first-at-one" }),
      canonicalMedia(1, { assetId: "second-at-one" }),
      ...Array.from({ length: 8 }, (_, index) => canonicalMedia(index + 10)),
    ],
  });

  assert.equal(media.length, 10);
  assert.deepEqual(
    media.map((item) => item.order),
    Array.from({ length: 10 }, (_, index) => index),
  );
  assert.deepEqual(
    media.slice(0, 2).map((item) => item.assetId),
    ["first-at-one", "second-at-one"],
  );
});

test("canonical derivatives fail closed when unready, malformed, or unsafe", () => {
  const media = normalizeOrderedPostMedia({
    imageUrl: "https://media.polis.test/legacy-must-not-leak.jpg",
    mediaItems: [
      canonicalMedia(0, {
        publicDerivative: {
          url: "javascript:alert(1)",
          status: "ready",
        },
      }),
      canonicalMedia(1, {
        publicDerivative: {
          url: "https://media.polis.test/not-ready.jpg",
          status: "processing",
        },
      }),
      canonicalMedia(2, {
        mediaType: "document",
      }),
    ],
  });

  assert.deepEqual(media, []);
});

test("canonical video files use native playback while HLS playlists use the HLS slot", () => {
  const [mp4, webm, hls] = [
    "https://media.polis.test/video.mp4",
    "https://media.polis.test/video.webm",
    "https://media.polis.test/video.m3u8",
  ].map((url, order) =>
    normalizeOrderedPostMedia({
      mediaItems: [
        canonicalMedia(order, {
          mediaType: "video",
          publicDerivative: {
            derivativeId: `video-derivative-${order}`,
            provider: "s3",
            url,
            status: "ready",
          },
        }),
      ],
    }),
  );

  assert.deepEqual(
    [mp4, webm, hls].map(([item]) => {
      const presentation = mediaPresentation(item);
      return [presentation.videoUrl, presentation.mp4Url];
    }),
    [
      ["", "https://media.polis.test/video.mp4"],
      ["", "https://media.polis.test/video.webm"],
      ["https://media.polis.test/video.m3u8", ""],
    ],
  );
});

test("provenance requires explicit published visibility and safe link authority", () => {
  const badges = visibleMediaUsageBadges(
    {
      usages: [
        {
          usageId: "draft",
          badgeVisible: true,
          canOpenPost: true,
          postPath: "/posts/draft",
          organization: { displayName: "Draft team" },
          post: { postId: "draft", status: "draft" },
        },
        {
          usageId: "hidden",
          badgeVisible: false,
          canOpenPost: true,
          postPath: "/posts/hidden",
          organization: { displayName: "Hidden team" },
          post: { postId: "hidden", status: "published" },
        },
        {
          usageId: "missing-status",
          badgeVisible: true,
          canOpenPost: true,
          postPath: "/posts/missing-status",
          organization: { displayName: "Missing status team" },
          post: { postId: "missing-status" },
        },
        {
          usageId: "view-only",
          badgeVisible: true,
          canOpenPost: false,
          postPath: "/posts/view-only",
          organization: { displayName: "View-only team" },
          post: { postId: "view-only", status: "published" },
        },
        {
          usageId: "unsafe-link",
          badgeVisible: true,
          canOpenPost: true,
          postPath: "https://example.invalid/posts/unsafe",
          organization: { displayName: "External team" },
          post: { postId: "unsafe", status: "published" },
        },
        {
          usageId: "published",
          badgeVisible: true,
          canOpenPost: true,
          postPath: "/posts/published",
          organization: { displayName: "Florida State Party" },
          post: { postId: "published", status: "published" },
        },
      ],
    },
    "https://polisapp.io",
  );

  assert.deepEqual(
    badges.map((badge) => [badge.usageId, badge.path]),
    [
      ["view-only", ""],
      ["unsafe-link", ""],
      ["published", "/posts/published"],
    ],
  );
});

test("composer emits canonical immutable media only when upload IDs are available", () => {
  assert.deepEqual(
    buildComposerMediaItems(
      {
        assetId: "asset-1",
        sourceAssetVersionId: "version-1",
        revisionId: "must-not-emit",
      },
      "video",
    ),
    [
      {
        assetId: "asset-1",
        sourceAssetVersionId: "version-1",
        mediaType: "video",
        order: 0,
      },
    ],
  );
  assert.deepEqual(
    buildComposerMediaItems(
      { assetId: "asset-1", revisionId: "legacy" },
      "image",
    ),
    [],
  );
});
