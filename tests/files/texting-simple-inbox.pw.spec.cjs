const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { mockBook, BASE, PROMPT } = require("./contact-book-fixture.cjs");

const captures = path.resolve(
  __dirname,
  "../../output/playwright/simple-inbox",
);
const hours = (count) => Date.now() - count * 3600000;
const message = (content, direction, at) => ({
  content,
  direction,
  createdAtMs: at,
  hasMedia: false,
});

async function inboxFixture(page, { sparse = false } = {}) {
  const base = await mockBook(page);
  const rows = [
    [
      "alex",
      "Alex Morgan",
      "Yes, I’d like to help. What time do volunteers meet?",
      1,
      3,
      "october",
    ],
    [
      "jordan",
      "Jordan Lee",
      "Thanks for the update. Can you send me the details?",
      2,
      1,
      "october",
    ],
    ["sam", "Sam Rivera", "That works for me. Thank you!", 3, 0, "volunteer"],
    [
      "casey",
      "Casey Patel",
      "Please remove me from this list.",
      4,
      5,
      "october",
    ],
    [
      "taylor",
      "Taylor Chen",
      "Thanks for your time. Have a good evening.",
      5,
      0,
      "october",
    ],
    [
      "morgan",
      "Morgan Ellis",
      "I’ll check and get back to you.",
      30,
      0,
      "volunteer",
    ],
  ].map(
    ([
      conversationId,
      displayName,
      content,
      age,
      unreadReplies,
      campaignId,
    ]) => {
      const suppressed = conversationId === "casey",
        outbound = ["taylor", "morgan"].includes(conversationId);
      return {
        conversationId,
        displayName,
        campaignId,
        phone: "+12025550124",
        suppressed,
        canReply: !suppressed,
        hasReceivedReply: conversationId !== "morgan",
        hasConversationalReply: !suppressed && conversationId !== "morgan",
        unreadReplies,
        unreadReplyCount: suppressed ? 0 : unreadReplies,
        lastMessageAtMs: hours(age),
        latestInboundAtMs: conversationId === "taylor" ? hours(48) : hours(age),
        latestMessage: message(
          content,
          outbound ? "outbound" : "inbound",
          hours(age),
        ),
        latestInboundMessage: message(
          conversationId === "taylor" ? "An older reply" : content,
          "inbound",
          conversationId === "taylor" ? hours(48) : hours(age),
        ),
        previewStatus: "available",
        inboundPreviewStatus: "available",
        replyState:
          conversationId === "morgan"
            ? "provider_outcome_unknown"
            : "available",
      };
    },
  );
  const calls = [];
  let releaseRefresh,
    blockRefresh = false,
    pageCount = 0;
  await page.route(`**${PROMPT}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      suffix = url.pathname.slice(PROMPT.length);
    calls.push({
      path: suffix,
      query: Object.fromEntries(url.searchParams),
      method: request.method(),
    });
    const respond = (data) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...data }),
      });
    if (suffix === "/campaigns")
      return respond({
        items: [
          { campaignId: "october", name: "October outreach" },
          { campaignId: "volunteer", name: "Volunteer follow-up" },
        ],
        nextCursor: null,
      });
    if (suffix === "/conversations") {
      if (blockRefresh) {
        blockRefresh = false;
        await new Promise((resolve) => {
          releaseRefresh = resolve;
        });
      }
      const folder = url.searchParams.get("folder") || "all",
        campaign = url.searchParams.get("campaignId");
      let items = rows.filter(
        (row) => !campaign || row.campaignId === campaign,
      );
      if (folder === "replies")
        items = items.filter((row) => row.hasConversationalReply);
      if (folder === "opt_outs") items = items.filter((row) => row.suppressed);
      if (folder === "needs_review")
        items = items.filter(
          (row) => row.replyState === "provider_outcome_unknown",
        );
      if (sparse && ++pageCount < 7)
        return respond({
          items: [],
          nextCursor: `sparse-${pageCount}`,
          order: "provider_id",
        });
      return respond({ items, nextCursor: null, order: "recent_activity" });
    }
    if (suffix.startsWith("/conversations/")) {
      const row = rows.find(
        (row) => row.conversationId === suffix.split("/")[2],
      );
      return respond({
        conversation: row,
        messages: [
          {
            ...row.latestMessage,
            messageId: "recorded-message",
            status: "received",
          },
        ],
        nextCursor: null,
      });
    }
    return route.fallback();
  });
  return {
    ...base,
    inboxCalls: calls,
    rows,
    blockNextRefresh() {
      blockRefresh = true;
    },
    releaseRefresh() {
      releaseRefresh?.();
    },
  };
}

async function open(page, suffix = "") {
  await page.goto(`${BASE}/organizations/org-1/texting/inbox${suffix}`);
  await expect(page.locator(".pt-inbox-message").first()).toBeVisible();
  await expect(
    page.getByLabel("Campaign", { exact: true }).locator("option"),
  ).toHaveCount(3);
}
async function selectView(page, name) {
  await page.locator(".pt-inbox-folder summary").click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(page.locator(".pt-inbox-folder summary")).toContainText(name);
}
async function capture(page, name) {
  fs.mkdirSync(captures, { recursive: true });
  await page.screenshot({ path: path.join(captures, name), fullPage: true });
}

test("simple inbox shows automatic snippets, real unread counts and four views at mobile/desktop/dark sizes", async ({
  page,
}) => {
  const fixture = await inboxFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-polis-theme-resolved", "light"),
  );
  const alex = page.locator('[data-conversation-id="alex"]'),
    casey = page.locator('[data-conversation-id="casey"]');
  await expect(alex).toContainText("Yes, I’d like to help.");
  await expect(alex.locator(".pt-inbox-unread")).toHaveText("3");
  await expect(alex.locator(".pt-inbox-preview")).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(casey).toContainText("Opted out");
  await expect(casey.locator(".pt-inbox-unread")).toHaveCount(0);
  await expect(casey.locator(".pt-inbox-preview")).toHaveCSS(
    "font-weight",
    "400",
  );
  await expect(
    page.getByText("Show message previews", { exact: true }),
  ).toHaveCount(0);
  await capture(page, "mobile-light-closed.png");
  await page.locator(".pt-inbox-folder summary").click();
  await expect(page.getByRole("menuitemradio")).toHaveText([
    "All messages✓",
    "Replies",
    "Opt outs",
    "Needs review",
  ]);
  await capture(page, "mobile-light-open.png");
  await page.locator(".pt-inbox-folder summary").press("Escape");
  await page.setViewportSize({ width: 1365, height: 900 });
  await capture(page, "desktop-light.png");
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-polis-theme-resolved", "dark"),
  );
  await capture(page, "desktop-dark.png");
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const summary = page.locator(".pt-inbox-folder summary");
  await summary.focus();
  await summary.press("ArrowUp");
  await expect(
    page.getByRole("menuitemradio", { name: "Needs review", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await summary.press("ArrowDown");
  await expect(
    page.getByRole("menuitemradio", { name: "All messages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(summary).toContainText("Replies");
  await expect(page.locator('[data-conversation-id="casey"]')).toHaveCount(0);
  expect(fixture.inboxCalls.every((call) => call.method === "GET")).toBe(true);
  expect(
    fixture.inboxCalls.some((call) => /history|reporting/.test(call.path)),
  ).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test("campaign and 24hr choice survive each view, using inbound time for Replies", async ({
  page,
}) => {
  await inboxFixture(page);
  await open(page);
  await page.getByLabel("Campaign", { exact: true }).selectOption("october");
  await page.getByRole("button", { name: "24 hr", exact: true }).click();
  await expect(page.locator('[data-conversation-id="taylor"]')).toBeVisible();
  await selectView(page, "Replies");
  await expect(page.locator('[data-conversation-id="taylor"]')).toHaveCount(0);
  await expect(page.locator('[data-conversation-id="casey"]')).toHaveCount(0);
  await expect(page.getByLabel("Campaign", { exact: true })).toHaveValue(
    "october",
  );
  await expect(
    page.getByRole("button", { name: "24 hr", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await selectView(page, "Opt outs");
  await expect(page.locator('[data-conversation-id="casey"]')).toBeVisible();
  await selectView(page, "Needs review");
  await expect(
    page.getByText("No conversations in this view.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "24 hr", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await page.getByLabel("Campaign", { exact: true }).selectOption("");
  await expect(page.locator('[data-conversation-id="morgan"]')).toBeVisible();
});

test("rows stay visible during refresh and opted-out history stays readable without a send form", async ({
  page,
}) => {
  const fixture = await inboxFixture(page);
  await open(page);
  fixture.blockNextRefresh();
  await page
    .getByRole("button", { name: "Refresh conversations", exact: true })
    .click();
  await expect(page.locator('[data-conversation-id="alex"]')).toBeVisible();
  fixture.releaseRefresh();
  await expect(
    page.getByRole("button", { name: "Refresh conversations", exact: true }),
  ).toBeEnabled();
  await page.locator('[data-conversation-id="casey"]').click();
  await expect(
    page.getByText("This person opted out", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Please remove me from this list.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-workspace-form="reply"]')).toHaveCount(0);
  expect(fixture.inboxCalls.every((call) => call.method === "GET")).toBe(true);
});

test("filtered sparse pages continue automatically beyond four pages", async ({
  page,
}) => {
  const fixture = await inboxFixture(page, { sparse: true });
  await page.goto(`${BASE}/organizations/org-1/texting/inbox/folder%3Areplies`);
  await expect(page.locator('[data-conversation-id="alex"]')).toBeVisible();
  expect(
    fixture.inboxCalls.filter((call) => call.path === "/conversations"),
  ).toHaveLength(7);
  expect(
    fixture.inboxCalls.some((call) => /history|reporting/.test(call.path)),
  ).toBe(false);
});
