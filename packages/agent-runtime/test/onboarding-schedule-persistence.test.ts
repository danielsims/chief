import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { channelChatId } from "../src/channels/nip29.js";
import { LocalStore } from "../src/local-store.js";
import { SessionManager } from "../src/manager.js";
import { persistOnboardingSchedules } from "../src/onboarding-schedule-persistence.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-onboarding-schedule-persistence-test-key";

void test("onboarding materializes a subject channel before saving its schedule", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-onboarding-schedule-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const manager = new SessionManager(store);
  try {
    const channels = await store.channelStore().list("workspace");
    const mission = channels.find(
      (channel) => channel.slug === "mission-control",
    );
    const marketing = channels.find((channel) => channel.slug === "marketing");
    assert.ok(mission);
    assert.ok(marketing);
    const missionConversationId = channelChatId("workspace", mission.id);
    await manager.createRootChat(
      "workspace",
      missionConversationId,
      "#mission-control",
      "codex",
    );

    const result = await persistOnboardingSchedules({
      manager,
      workspaceId: "workspace",
      schedules: [
        {
          id: "onboarding-brand-content",
          playbookId: "brand-content",
          agentId: "content",
          title: "Brand content",
          instructions: "Prepare one useful brand-led post.",
          cron: "0 10 * * 4",
          timezone: "UTC",
          status: "active",
          approvalSummary: "Draft one brand post.",
          proposedToolPatterns: [],
        },
      ],
      missionChannelId: mission.id,
      fallbackConversationId: missionConversationId,
      driver: "codex",
      now: 1,
    });

    assert.deepEqual(result, { failed: 0, saved: 1 });
    const marketingConversationId = channelChatId("workspace", marketing.id);
    const conversation = await store.chatRecord(
      "workspace",
      marketingConversationId,
    );
    assert.ok(conversation);
    assert.equal(conversation.kind, "conversation");
    assert.equal(conversation.agent, "chief");
    const [work] = await store.listRecurringWork("workspace");
    assert.ok(work);
    assert.equal(work.conversationId, marketingConversationId);
  } finally {
    await manager.stopAll();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
