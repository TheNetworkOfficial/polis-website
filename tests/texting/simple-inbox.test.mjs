import test from "node:test";
import assert from "node:assert/strict";
import { moduleUrl } from "./module-fixture.mjs";
const {
  textingFolders,
  textingFolderRoute,
  parseTextingFolder,
  conversationInView,
  conversationUnreadCount,
  renderTextingInbox,
} = await import(await moduleUrl("textingFolders"));
const { createConversations } = await import(
  await moduleUrl("textingConversations")
);

test("four views retain campaign/time and translate former Sent/Unread routes", () => {
  assert.deepEqual(
    textingFolders.map(([key]) => key),
    ["all", "replies", "opt_outs", "needs_review"],
  );
  for (const [folder] of textingFolders) {
    for (const campaign of ["", "campaign"]) {
      assert.deepEqual(
        parseTextingFolder(textingFolderRoute(folder, campaign, true)),
        {
          folder,
          campaignId: campaign,
          last24Hours: true,
        },
      );
    }
  }
  assert.equal(parseTextingFolder("folder:unread:campaign").folder, "replies");
  assert.equal(parseTextingFolder("folder:sent:campaign").folder, "all");
});

test("opt-outs are quiet in All/Opt outs and excluded from Replies even on legacy responses", () => {
  const row = {
    conversationId: "quiet",
    displayName: "Quiet contact",
    suppressed: true,
    hasReceivedReply: true,
    unreadReplies: 12,
  };
  assert.equal(conversationUnreadCount(row), 0);
  assert.equal(conversationInView(row, { folder: "replies" }), false);
  for (const folder of ["all", "opt_outs"]) {
    const html = renderTextingInbox([row], { folder, when: () => "Today" });
    assert.match(html, /Quiet contact/);
    assert.match(html, /Opted out/);
    assert.doesNotMatch(html, /pt-inbox-unread|pt-inbox-message--unread/);
  }
});

test("24hr Replies uses inbound evidence while all other views use latest activity", () => {
  const windowEnd = 1000000000;
  const row = {
    hasReceivedReply: true,
    lastMessageAtMs: windowEnd - 1000,
    latestInboundAtMs: windowEnd - 172800000,
    replyState: "provider_outcome_unknown",
  };
  assert.equal(
    conversationInView(row, {
      folder: "replies",
      last24Hours: true,
      windowEnd,
    }),
    false,
  );
  for (const folder of ["all", "needs_review"])
    assert.equal(
      conversationInView(row, { folder, last24Hours: true, windowEnd }),
      true,
    );
  assert.equal(
    conversationInView(
      { ...row, suppressed: true },
      { folder: "opt_outs", last24Hours: true, windowEnd },
    ),
    true,
  );
  assert.equal(
    conversationInView(
      { ...row, latestInboundAtMs: null },
      { folder: "replies", last24Hours: true, windowEnd },
    ),
    false,
  );
});

test("automatic snippets normalize display whitespace, escape content and show media without caption", () => {
  const row = {
    conversationId: "text",
    displayName: "<name>",
    unreadReplyCount: 3,
    hasConversationalReply: true,
    previewStatus: "available",
    latestMessage: {
      direction: "outbound",
      content: "  <hello>\n   & welcome  ",
    },
  };
  const html = renderTextingInbox([row], { when: () => "Now" });
  assert.match(html, /You: &lt;hello&gt; &amp; welcome/);
  assert.match(html, /&lt;name&gt;/);
  assert.match(html, /aria-label="3 unread replies">3/);
  assert.match(html, /pt-inbox-message--unread/);
  const media = renderTextingInbox(
    [
      {
        ...row,
        latestMessage: {
          direction: "inbound",
          content: " \t\n",
          hasMedia: true,
        },
      },
    ],
    { when: () => "Now" },
  );
  assert.match(media, /Media message/);
  const blank = renderTextingInbox(
    [{ ...row, latestMessage: { direction: "inbound", content: "" } }],
    { when: () => "Now" },
  );
  assert.match(blank, /pt-inbox-preview">Message</);
});

test("partial 24hr results disclose unknown times while retaining certified replies", () => {
  const windowEnd = 1000000000;
  const html = renderTextingInbox(
    [
      {
        conversationId: "known",
        displayName: "Verified reply",
        hasConversationalReply: true,
        latestInboundAtMs: windowEnd - 1000,
      },
      {
        conversationId: "unknown",
        displayName: "Unverified time",
        hasConversationalReply: true,
        latestInboundAtMs: null,
        inboundPreviewStatus: "unavailable",
      },
    ],
    { folder: "replies", last24Hours: true, windowEnd, when: () => "Now" },
  );
  assert.match(html, /Verified reply/);
  assert.doesNotMatch(html, /Unverified time/);
  assert.match(html, /Some message times could not be checked/);
});

test("automatic empty-page search stops on repeated cursors and explicit retry can continue", async (t) => {
  const view = {},
    timers = new Set();
  let calls = 0,
    retry = false;
  const resourceId = "folder:replies";
  const page = createConversations(
    {
      view: () => view,
      context: () => ({ resourceId }),
      workspace: () => ({}),
      can: () => false,
      guard() {},
      busy: () => false,
      changed() {},
      sendHeld: () => false,
      api: async () => {
        calls++;
        return retry
          ? {
              items: [
                {
                  conversationId: "found",
                  displayName: "Found reply",
                  hasConversationalReply: true,
                },
              ],
              nextCursor: null,
            }
          : {
              items: [],
              nextCursor: `page-${Math.min(calls, 4)}`,
              order: "provider_id",
            };
      },
    },
    {
      schedule: (callback, delay) => {
        const timer = { callback, delay };
        timers.add(timer);
        return timer;
      },
      cancel: (timer) => timers.delete(timer),
    },
  );
  t.after(() => page.dispose());
  await page.load(resourceId);
  assert.equal(calls, 4);
  const search = [...timers].find((timer) => timer.delay === 300);
  assert.ok(search);
  timers.delete(search);
  await search.callback();
  assert.equal(calls, 5);
  assert.equal(view.conversations.searchError, true);
  assert.equal([...timers].filter((timer) => timer.delay === 300).length, 0);
  assert.match(page.render(), /More conversations could not be checked/);
  retry = true;
  await page.action("conversations-more");
  assert.equal(view.conversations.searchError, false);
  assert.match(page.render(), /Found reply/);
});

test("head refresh advances24hr window so newly received replies are not hidden", async (t) => {
  let currentTime = 1000000000;
  const view = {},
    resourceId = "folder:replies::24h",
    routes = [];
  const page = createConversations(
    {
      view: () => view,
      context: () => ({ resourceId }),
      workspace: () => ({}),
      can: () => false,
      guard() {},
      busy: () => false,
      changed() {},
      sendHeld: () => false,
      navigate: (...route) => routes.push(route),
      api: async () => ({
        items: [
          {
            conversationId: "fresh",
            displayName: `Reply at ${currentTime}`,
            hasReceivedReply: true,
            latestInboundAtMs: currentTime - 1,
            lastMessageAtMs: currentTime - 1,
          },
        ],
        nextCursor: null,
      }),
    },
    { now: () => currentTime, schedule: () => 1, cancel() {} },
  );
  t.after(() => page.dispose());
  await page.load(resourceId);
  currentTime += 60000;
  await page.refresh(resourceId);
  assert.match(page.render(), new RegExp(`Reply at ${currentTime}`));
  for (const [folder] of textingFolders) {
    const before = routes.length;
    await page.action("conversation-folder", folder);
    if (folder === "replies") {
      assert.equal(routes.length, before, "the current folder does not reload");
      continue;
    }
    assert.deepEqual(routes.at(-1), [
      "inbox",
      textingFolderRoute(folder, "", true),
    ]);
  }
});
