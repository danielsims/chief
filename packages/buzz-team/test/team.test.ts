import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  chiefAgentAvatarDataUrl,
  chiefAgentCatalog,
  chiefBuzzAppManifest,
  chiefChannels,
  chiefMarketingTeamSnapshot,
  chiefToolProfiles,
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

void test("the release imports the complete Chief team", () => {
  assert.deepEqual(chiefBuzzAppManifest.release.includedAgents, [
    "chief",
    "setup",
    "analyst",
    "content",
    "prospector",
    "engineering",
  ]);
  assert.deepEqual(
    chiefMarketingTeamSnapshot.members.map(
      (member) => member.profile.displayName,
    ),
    [
      "Chief",
      "Setup",
      "Analyst",
      "Content Writer",
      "Prospector",
      "Engineering",
    ],
  );
  assert.deepEqual(
    chiefAgentCatalog.map((agent) => agent.id),
    ["chief", "setup", "analyst", "content", "prospector", "engineering"],
  );
  assert.match(chiefAgentAvatarDataUrl, /^data:image\/svg\+xml;base64,/);
  assert.ok(
    chiefMarketingTeamSnapshot.members.every(
      (member) => member.profile.avatarDataUrl === chiefAgentAvatarDataUrl,
    ),
  );
});

void test("every agent has one dedicated Executor toolkit", () => {
  assert.equal(chiefToolProfiles.length, chiefAgentCatalog.length);
  assert.equal(
    new Set(chiefToolProfiles.map((profile) => profile.executorToolkit)).size,
    chiefToolProfiles.length,
  );

  for (const agent of chiefAgentCatalog) {
    assert.ok(
      chiefToolProfiles.some((profile) => profile.id === agent.toolProfile),
      `${agent.id} is missing its tool profile`,
    );
  }
});

void test("Setup owns the portable agent-browser workflow", () => {
  const setupPrompt = chiefMarketingTeamSnapshot.members.find(
    (member) => member.profile.displayName === "Setup",
  )?.definition.systemPrompt;

  assert.deepEqual(
    chiefToolProfiles.find((profile) => profile.id === "chief-setup")
      ?.hostCapabilities,
    [],
  );
  assert.ok(setupPrompt);
  assert.match(setupPrompt, /buzz:browser-session/);
  assert.match(setupPrompt, /buzz:browser-session-status/);
  assert.match(
    setupPrompt,
    /When the pinned `agent-browser` CLI below is available/,
  );
  assert.match(
    setupPrompt,
    /do not require a separate `chief\.browser` entry in session metadata/,
  );
  assert.match(setupPrompt, /npx --yes agent-browser@0\.32\.3/);
  assert.match(setupPrompt, /"\$AGENT_BROWSER_CLI"/);
  assert.match(setupPrompt, /never depend on npm or network access/);
  assert.match(setupPrompt, /BROWSER_UI_SOURCE_CLI/);
  assert.match(setupPrompt, /complete credential-free version 2 attachment/);
  assert.match(setupPrompt, /"version":2/);
  assert.match(setupPrompt, /Never print browser protocol JSON into chat/);
  assert.match(setupPrompt, /two-to-five-word present-tense label/);
  assert.match(setupPrompt, /get box TARGET/);
  assert.match(setupPrompt, /Browser UI owns interpolation and rendering/);
  assert.match(setupPrompt, /"cursor":\{"x":0\.64/);
  assert.match(setupPrompt, /"state":"waiting"/);
  assert.match(setupPrompt, /"state":"complete"/);
  assert.match(setupPrompt, /emit no attachment/);
  assert.match(setupPrompt, /the live browser is the deliverable/);
  assert.match(setupPrompt, /never mark it complete merely because/);
  assert.match(setupPrompt, /stream status/);
  assert.match(setupPrompt, /PORT_FROM_STREAM_STATUS/);
  assert.match(setupPrompt, /"session_id":"SESSION_ID"/);
  assert.doesNotMatch(setupPrompt, /"session_name"/);
  assert.doesNotMatch(setupPrompt, /127\.0\.0\.1:9223/);
});

void test("Chief owns the idempotent workspace topology", () => {
  assert.deepEqual(
    chiefChannels.map((channel) => channel.id),
    [
      "chief-hq",
      "chief-marketing",
      "chief-prospecting",
      "chief-engineering",
      "chief-setup",
    ],
  );
  assert.ok(
    chiefChannels.every((channel) => channel.members.includes("chief")),
  );
  assert.deepEqual(
    chiefChannels.find((channel) => channel.id === "chief-hq")?.members,
    ["chief", "setup", "analyst", "content", "prospector", "engineering"],
  );
  assert.deepEqual(
    chiefChannels.map(({ id, visibility, includeInstaller }) => ({
      id,
      visibility,
      includeInstaller,
    })),
    [
      { id: "chief-hq", visibility: "open", includeInstaller: true },
      { id: "chief-marketing", visibility: "open", includeInstaller: true },
      { id: "chief-prospecting", visibility: "open", includeInstaller: true },
      { id: "chief-engineering", visibility: "open", includeInstaller: true },
      { id: "chief-setup", visibility: "private", includeInstaller: true },
    ],
  );

  const chiefPrompt = chiefMarketingTeamSnapshot.members.find(
    (member) => member.profile.displayName === "Chief",
  )?.definition.systemPrompt;
  assert.ok(chiefPrompt);
  assert.match(chiefPrompt, /weekly all-hands/);
  assert.match(chiefPrompt, /List existing channels and memberships/);
  assert.match(
    chiefPrompt,
    /The absence of a team-list tool is not a setup blocker/,
  );
  assert.match(chiefPrompt, /avatar is byte-for-byte identical/);
  assert.match(chiefPrompt, /lexicographically smallest normalized public key/);
  assert.match(chiefPrompt, /Build one role-to-pubkey map/);
  assert.match(chiefPrompt, /Perform one repair pass/);
  assert.match(chiefPrompt, /Never abandon the whole setup/);
  assert.match(
    chiefPrompt,
    /must still complete when one specialist is unresolved/,
  );
  assert.doesNotMatch(
    chiefPrompt,
    /create no partial or ambiguous memberships/,
  );
  assert.match(chiefPrompt, /author of that first explicit setup request/);
  assert.match(chiefPrompt, /one-to-one DM/);
  assert.match(chiefPrompt, /ordinary replies wake Chief/);
  assert.match(chiefPrompt, /Do not use a channel thread/);
  assert.match(chiefPrompt, /Ask one compact question at a time/);
  assert.match(chiefPrompt, /Chief kickoff: <role>/);
  assert.match(chiefPrompt, /resolved pubkey mention tag/);
  assert.match(
    chiefPrompt,
    /Adding a managed agent to a channel does not wake it/,
  );
  assert.match(chiefPrompt, /Google Analytics/);
  assert.match(chiefPrompt, /Buzz's native Git repositories/);
  assert.match(chiefPrompt, /five-field cron schedules in UTC/);
  assert.match(chiefPrompt, /send_message step must mention/);
  assert.match(chiefPrompt, /Chief - /);
  assert.match(chiefPrompt, /Pulse notes are community-visible/);
  assert.match(chiefPrompt, /native Buzz image attachments/);
});

void test("generated artifacts match the package definitions", async () => {
  const [appArtifact, teamArtifact] = await Promise.all([
    readFile(resolve(packageRoot, "artifacts/chief.app.json"), "utf8"),
    readFile(resolve(packageRoot, "artifacts/chief.team.json"), "utf8"),
  ]);

  assert.deepEqual(JSON.parse(appArtifact), chiefBuzzAppManifest);
  assert.deepEqual(JSON.parse(teamArtifact), chiefMarketingTeamSnapshot);
});
