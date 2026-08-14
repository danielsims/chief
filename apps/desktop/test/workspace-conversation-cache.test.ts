import assert from "node:assert/strict";
import test from "node:test";

import {
  activateWorkspaceConversationCache,
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
