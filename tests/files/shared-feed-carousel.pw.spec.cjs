const { test, expect } = require("@playwright/test");
const nodePath = require("node:path");

const pixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nAAAAABJRU5ErkJggg==",
  "base64",
);

function mediaItem(order, overrides = {}) {
  return {
    assetId: `asset-${order}`,
    sourceAssetVersionId: `asset-version-${order}`,
    mediaType: "image",
    altText: `Photo ${order}`,
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    order,
    publicDerivative: {
      derivativeId: `derivative-${order}`,
      provider: "cloudflare",
      url: `/test-media/photo-${order}.png`,
      status: "ready",
    },
    ...overrides,
  };
}

function feedItems() {
  return [
    {
      postId: "carousel-post",
      displayName: "Jordan Candidate",
      username: "jordan",
      description: "Fourth of July in District 3",
      mediaItems: [
        mediaItem(2, { altText: "Third photo" }),
        mediaItem(0, {
          altText: "First photo",
          usages: [
            {
              usageId: "published-link",
              sourceAssetVersionId: "asset-version-0",
              derivativeId: "derivative-0",
              organization: { displayName: "Florida State Party" },
              post: { postId: "used-post", status: "published" },
              badgeVisible: true,
              canOpenPost: true,
              postPath: "/posts/used-post",
            },
            {
              usageId: "published-no-link",
              organization: { displayName: "View-only Team" },
              post: { postId: "view-only", status: "published" },
              badgeVisible: true,
              canOpenPost: false,
              postPath: "/posts/view-only",
            },
            {
              usageId: "external-link",
              organization: { displayName: "External Link Team" },
              post: { postId: "external", status: "published" },
              badgeVisible: true,
              canOpenPost: true,
              postPath: "https://example.invalid/posts/external",
            },
            {
              usageId: "draft",
              organization: { displayName: "Draft Team" },
              post: { postId: "draft", status: "draft" },
              badgeVisible: true,
              canOpenPost: true,
              postPath: "/posts/draft",
            },
            {
              usageId: "hidden",
              organization: { displayName: "Hidden Team" },
              post: { postId: "hidden", status: "published" },
              badgeVisible: false,
              canOpenPost: true,
              postPath: "/posts/hidden",
            },
          ],
        }),
        mediaItem(1, {
          mediaType: "video",
          altText: "Parade video",
          publicDerivative: {
            derivativeId: "derivative-1",
            provider: "cloudflare",
            url: "/test-media/parade.mp4",
            thumbnailUrl: "/test-media/parade.png",
            status: "ready",
          },
        }),
      ],
    },
    {
      postId: "legacy-post",
      displayName: "Legacy Organizer",
      type: "image",
      imageUrl: "/test-media/legacy.png",
      altText: "Legacy single photo",
      description: "A post created before carousels",
    },
  ];
}

async function mockSharedFeed(page, items = feedItems()) {
  await page.addInitScript(() => {
    let runtimeConfig;
    Object.defineProperty(window, "__POLIS_WEB_APP__", {
      configurable: true,
      get() {
        return runtimeConfig;
      },
      set(value) {
        runtimeConfig = {
          ...(value || {}),
          apiBaseUrl: window.location.origin,
        };
      },
    });
  });
  await page.route("**/test-media/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(".mp4")) {
      return route.fulfill({
        status: 200,
        contentType: "video/mp4",
        body: Buffer.alloc(0),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: pixelPng,
    });
  });
  await page.route("**/api/public/posts/carousel-post/web-feed**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, nextCursor: null }),
    }),
  );
}

test("ordered post media supports keyboard, mobile controls, and legacy fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSharedFeed(page);
  await page.goto("/posts/carousel-post");

  const post = page.locator('article[data-post-id="carousel-post"]');
  const carousel = post.locator("[data-post-carousel]");
  await expect(carousel).toHaveAttribute(
    "aria-label",
    "Post media carousel, item 1 of 3",
  );
  await expect(post.getByAltText("First photo")).toBeVisible();

  const next = post.getByRole("button", { name: "Next media" });
  const target = await next.boundingBox();
  const actionTarget = await post
    .getByRole("button", { name: "Like post" })
    .boundingBox();
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.x + target.width).toBeLessThanOrEqual(actionTarget.x);
  await next.click();
  await expect(carousel).toBeFocused();
  await expect(carousel).toHaveAttribute(
    "aria-label",
    "Post media carousel, item 2 of 3",
  );
  const video = post.locator("video[data-video-key]");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("data-video-url", "");
  await expect(video).toHaveAttribute("data-mp4-url", "/test-media/parade.mp4");
  await expect
    .poll(() => video.evaluate((element) => new URL(element.src).pathname))
    .toBe("/test-media/parade.mp4");

  await carousel.press("End");
  await expect(post.getByAltText("Third photo")).toBeVisible();
  await carousel.press("ArrowLeft");
  await expect(post.locator("video[data-video-key]")).toHaveCount(1);
  await carousel.press("Home");
  await expect(post.getByAltText("First photo")).toBeVisible();

  const legacy = page.locator('article[data-post-id="legacy-post"]');
  await expect(legacy.getByAltText("Legacy single photo")).toHaveCount(1);
  await expect(legacy.locator("[data-post-carousel]")).toHaveCount(0);
  if (process.env.POLIS_VISUAL_QA_OUTPUT) {
    await page.screenshot({
      path: nodePath.join(
        process.env.POLIS_VISUAL_QA_OUTPUT,
        "shared-feed-carousel-mobile.png",
      ),
    });
  }
});

test("canonical HLS and MP4 slides never inherit the first slide playback source", async ({
  page,
}) => {
  const items = feedItems();
  items[0].mediaItems = [
    mediaItem(0, {
      mediaType: "video",
      publicDerivative: {
        derivativeId: "hls-derivative",
        url: "/test-media/first.m3u8",
        status: "ready",
      },
    }),
    mediaItem(1, {
      mediaType: "video",
      publicDerivative: {
        derivativeId: "mp4-derivative",
        url: "/test-media/second.mp4",
        status: "ready",
      },
    }),
  ];
  items.push({
    postId: "legacy-video",
    displayName: "Legacy Video Author",
    type: "video",
    videoUrl: "/test-media/legacy.m3u8",
    mp4Url: "/test-media/legacy.mp4",
    posterUrl: "/test-media/legacy.png",
  });
  await mockSharedFeed(page, items);
  await page.goto("/posts/carousel-post");
  const post = page.locator('article[data-post-id="carousel-post"]');
  const video = post.locator("video[data-video-key]");
  await expect(video).toHaveAttribute(
    "data-video-url",
    "/test-media/first.m3u8",
  );
  await expect(video).toHaveAttribute("data-mp4-url", "");

  await post.getByRole("button", { name: "Next media" }).click();
  await expect(video).toHaveAttribute("data-video-url", "");
  await expect(video).toHaveAttribute("data-mp4-url", "/test-media/second.mp4");
  await expect
    .poll(() => video.evaluate((element) => new URL(element.src).pathname))
    .toBe("/test-media/second.mp4");
  await post.getByRole("button", { name: "Previous media" }).click();
  await expect(video).toHaveAttribute(
    "data-video-url",
    "/test-media/first.m3u8",
  );
  await expect(video).toHaveAttribute("data-mp4-url", "");

  const legacyVideo = page.locator(
    'article[data-post-id="legacy-video"] video',
  );
  await expect(legacyVideo).toHaveAttribute(
    "data-video-url",
    "/test-media/legacy.m3u8",
  );
  await expect(legacyVideo).toHaveAttribute(
    "data-mp4-url",
    "/test-media/legacy.mp4",
  );
  await expect(legacyVideo).toHaveAttribute("poster", "/test-media/legacy.png");
});

test("media provenance is visible and linked only with explicit server authority", async ({
  page,
}) => {
  await mockSharedFeed(page);
  await page.goto("/posts/carousel-post");

  const post = page.locator('article[data-post-id="carousel-post"]');
  await expect(post.getByText("Florida State Party")).toBeVisible();
  await expect(
    post.getByRole("link", {
      name: "View published post by Florida State Party",
    }),
  ).toHaveAttribute("href", "/posts/used-post");
  await expect(post.getByText("View-only Team")).toBeVisible();
  await expect(post.locator('a:has-text("View-only Team")')).toHaveCount(0);
  await expect(post.getByText("External Link Team")).toBeVisible();
  await expect(post.locator('a:has-text("External Link Team")')).toHaveCount(0);
  await expect(post.getByText("Draft Team")).toHaveCount(0);
  await expect(post.getByText("Hidden Team")).toHaveCount(0);
  const nextTarget = await post
    .getByRole("button", { name: "Next media" })
    .boundingBox();
  const actionTarget = await post
    .getByRole("button", { name: "Like post" })
    .boundingBox();
  expect(nextTarget.x + nextTarget.width).toBeLessThanOrEqual(actionTarget.x);
  if (process.env.POLIS_VISUAL_QA_OUTPUT) {
    await page.screenshot({
      path: nodePath.join(
        process.env.POLIS_VISUAL_QA_OUTPUT,
        "shared-feed-carousel-desktop.png",
      ),
    });
  }
});
