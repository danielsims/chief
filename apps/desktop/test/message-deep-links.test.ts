import assert from "node:assert/strict";
import test from "node:test";

import type { MessageDeepLinkTarget } from "../src/lib/message-deep-links";
import {
  dispatchMessageDeepLink,
  listenForMessageDeepLinks,
  messageDeepLinkUrl,
  parseMessageDeepLink,
  routeForMessageDeepLink,
} from "../src/lib/message-deep-links";

const target = {
  channelId: "channel-id",
  channelSlug: "launch-planning",
  messageId: "message-id",
  threadRootId: "thread-id",
};

void test("message deep links round-trip channel, thread, and message targets", () => {
  assert.deepEqual(parseMessageDeepLink(messageDeepLinkUrl(target)), target);
  assert.deepEqual(
    parseMessageDeepLink(
      "chief-desktop:///message?channel=channel-id&message=message-id",
    ),
    {
      channelId: "channel-id",
      messageId: "message-id",
    },
  );
  assert.equal(parseMessageDeepLink("chief-desktop://message?channel=x"), null);
});

void test("message targets resolve to channel and direct-message routes", () => {
  assert.equal(
    routeForMessageDeepLink(target),
    "/conversations?channel=launch-planning&thread=thread-id&message=message-id",
  );
  assert.equal(
    routeForMessageDeepLink({
      channelId: "direct-channel",
      directAgentId: "chief",
      messageId: "reply-id",
    }),
    "/conversations?dm=chief&message=reply-id",
  );
});

void test("a message target received before the router mounts is delivered once", () => {
  dispatchMessageDeepLink(target);
  const received: MessageDeepLinkTarget[] = [];
  const unlisten = listenForMessageDeepLinks((next) => received.push(next));
  assert.deepEqual(received, [target]);
  unlisten();
});
