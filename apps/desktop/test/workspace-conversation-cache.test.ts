import assert from "node:assert/strict";
import test from "node:test";

import {
  activateWorkspaceConversationCache,
  cacheChannelEvent,
  cacheChannelEvents,
  cachedChannelEvents,
  cachedTranscript,
  cachedWorkspaceChannels,
  cachedWorkspaceChats,
  cacheTranscript,
  cacheWorkspaceChannels,
  cacheWorkspaceChats,
  isConversationHydrated,
  markConversationHydrated,
  reconcileChannelEvents,
} from "../src/lib/workspace-conversation-cache.js";

void test("conversation caches are isolated at the workspace boundary", () => {
  activateWorkspaceConversationCache("workspace-a");
  assert.equal(cacheTranscript("workspace-a", "same-chat", []), true);
  assert.equal(cacheChannelEvents("workspace-a", "same-channel", []), true);
  assert.equal(cacheWorkspaceChannels("workspace-a", []), true);
  assert.equal(cacheWorkspaceChats("workspace-a", []), true);
  assert.equal(
    markConversationHydrated(
      "workspace-a",
      "same-chat",
      "channel",
      "same-channel",
    ),
    true,
  );
  assert.equal(
    isConversationHydrated(
      "workspace-a",
      "same-chat",
      "channel",
      "same-channel",
    ),
    true,
  );

  activateWorkspaceConversationCache("workspace-b");
  assert.equal(cachedTranscript("workspace-b", "same-chat"), undefined);
  assert.equal(cachedChannelEvents("workspace-b", "same-channel"), undefined);
  assert.equal(cachedTranscript("workspace-a", "same-chat"), undefined);
  assert.equal(cachedChannelEvents("workspace-a", "same-channel"), undefined);
  assert.equal(cachedWorkspaceChannels("workspace-a"), undefined);
  assert.equal(cachedWorkspaceChats("workspace-a"), undefined);
  assert.equal(
    isConversationHydrated(
      "workspace-b",
      "same-chat",
      "channel",
      "same-channel",
    ),
    false,
  );

  assert.equal(cacheTranscript("workspace-a", "late-chat", []), false);
  assert.equal(cacheChannelEvents("workspace-a", "late-channel", []), false);
  assert.equal(cacheWorkspaceChannels("workspace-a", []), false);
  assert.equal(cacheWorkspaceChats("workspace-a", []), false);
  assert.equal(
    markConversationHydrated("workspace-a", "late-chat", "direct"),
    false,
  );
  assert.equal(cachedTranscript("workspace-b", "late-chat"), undefined);
  assert.equal(cachedChannelEvents("workspace-b", "late-channel"), undefined);
});

void test("workspace-wide live events update the channel navigation cache", () => {
  activateWorkspaceConversationCache("workspace-a");
  cacheChannelEvents("workspace-a", "mission-control", []);
  const event = {
    protocol: "nip29" as const,
    kind: 9 as const,
    id: "heartbeat-reply",
    channelId: "mission-control",
    pubkey: "chief",
    actor: { type: "agent" as const, id: "chief", name: "Chief" },
    content: "I moved the work forward.",
    tags: [["e", "heartbeat-root", "", "root"]],
    createdAt: 2,
  };

  assert.equal(cacheChannelEvent("workspace-a", event), true);
  assert.equal(cacheChannelEvent("workspace-a", event), true);
  assert.deepEqual(cachedChannelEvents("workspace-a", "mission-control"), [
    event,
  ]);

  activateWorkspaceConversationCache("workspace-b");
  assert.equal(cacheChannelEvent("workspace-a", event), false);
  assert.equal(
    cachedChannelEvents("workspace-b", "mission-control"),
    undefined,
  );
});

void test("late channel snapshots cannot erase newer live component events", () => {
  const olderEvent = {
    protocol: "nip29" as const,
    kind: 9 as const,
    id: "older-message",
    channelId: "setup",
    pubkey: "setup",
    actor: { type: "agent" as const, id: "setup", name: "Setup" },
    content: "I am checking your connections.",
    tags: [],
    createdAt: 1,
  };
  const pluginEvent = {
    ...olderEvent,
    id: "plugin-cards",
    content: "Choose the plugins to connect.",
    createdAt: 2,
    components: [
      {
        type: "plugin.recommendation" as const,
        props: { pluginIds: ["notion", "granola"] },
      },
    ],
  };
  const correctedOlderEvent = {
    ...olderEvent,
    content: "I checked your connections.",
  };

  assert.deepEqual(
    reconcileChannelEvents([olderEvent, pluginEvent], [correctedOlderEvent]),
    [correctedOlderEvent, pluginEvent],
  );
});

void test("hydration is retained only while its renderable caches exist", () => {
  activateWorkspaceConversationCache("workspace-hydration");
  assert.equal(
    markConversationHydrated(
      "workspace-hydration",
      "channel-chat",
      "channel",
      "marketing",
    ),
    true,
  );
  assert.equal(
    isConversationHydrated(
      "workspace-hydration",
      "channel-chat",
      "channel",
      "marketing",
    ),
    false,
  );

  cacheTranscript("workspace-hydration", "channel-chat", []);
  assert.equal(
    isConversationHydrated(
      "workspace-hydration",
      "channel-chat",
      "channel",
      "marketing",
    ),
    false,
  );

  cacheChannelEvents("workspace-hydration", "marketing", []);
  assert.equal(
    isConversationHydrated(
      "workspace-hydration",
      "channel-chat",
      "channel",
      "marketing",
    ),
    true,
  );

  markConversationHydrated("workspace-hydration", "direct-chat", "direct");
  cacheTranscript("workspace-hydration", "direct-chat", []);
  assert.equal(
    isConversationHydrated("workspace-hydration", "direct-chat", "direct"),
    true,
  );
});
