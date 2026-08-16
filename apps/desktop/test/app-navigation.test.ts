import assert from "node:assert/strict";
import test from "node:test";

import type { ChiefNavigationDestination } from "../src/lib/app-navigation";
import {
  chiefDeepLinkUrl,
  dispatchChiefNavigation,
  listenForChiefNavigation,
  messageDestination,
  normalizeChiefNavigationLinks,
  parseChiefDeepLink,
  parseChiefNavigationHref,
  routeForChiefDestination,
} from "../src/lib/app-navigation";

const destination = {
  kind: "conversation",
  channelId: "channel-id",
  channelSlug: "launch-planning",
  messageId: "message-id",
  threadRootId: "thread-id",
} satisfies ChiefNavigationDestination;

void test("Chief links round-trip exact channel, thread, and message targets", () => {
  assert.deepEqual(
    parseChiefDeepLink(chiefDeepLinkUrl(destination)),
    destination,
  );
  assert.deepEqual(
    parseChiefDeepLink(
      "chief-desktop:///message?channel=channel-id&message=message-id",
    ),
    {
      kind: "conversation",
      channelId: "channel-id",
      messageId: "message-id",
    },
  );
  assert.equal(parseChiefDeepLink("chief-desktop://message?channel=x"), null);
});

void test("destinations resolve to registered views, channels, and direct messages", () => {
  assert.equal(
    routeForChiefDestination(destination),
    "/conversations?channel=launch-planning&thread=thread-id&message=message-id",
  );
  assert.equal(
    routeForChiefDestination(
      messageDestination({
        channelId: "direct-channel",
        directAgentId: "chief",
        messageId: "reply-id",
      }),
    ),
    "/conversations?dm=chief&message=reply-id",
  );
  assert.equal(
    routeForChiefDestination({ kind: "view", view: "plugins" }),
    "/plugins",
  );
});

void test("app routes and external links share one navigation contract", () => {
  assert.deepEqual(
    parseChiefNavigationHref(
      "/conversations?channel=engineering&thread=root&message=reply",
    ),
    {
      kind: "conversation",
      channelId: "engineering",
      threadRootId: "root",
      messageId: "reply",
    },
  );
  assert.deepEqual(parseChiefNavigationHref("/plugins"), {
    kind: "view",
    view: "plugins",
  });
  assert.equal(parseChiefNavigationHref("/Users/daniel/report.md"), null);
});

void test("agent-authored Chief links survive Markdown sanitizing as app routes", () => {
  const markdown = `[Open the decision](${chiefDeepLinkUrl(destination)})`;
  assert.equal(
    normalizeChiefNavigationLinks(markdown),
    "[Open the decision](/conversations?channel=launch-planning&thread=thread-id&message=message-id)",
  );
});

void test("a destination received before the router mounts is delivered once", () => {
  dispatchChiefNavigation(destination);
  const received: ChiefNavigationDestination[] = [];
  const unlisten = listenForChiefNavigation((next) => received.push(next));
  assert.deepEqual(received, [destination]);
  unlisten();
});
