import type {
  AgentJob,
  AgentPrincipal,
  AgentPublishedMessage,
  JsonObject,
} from "@chief/relay-contracts";
import {
  agentPublishedMessageSchema,
  channelCreateCommandSchema,
  channelMemberAddCommandSchema,
  channelMembersResultSchema,
  isJsonString,
  messagePageSchema,
  workspaceOnboardingResultSchema,
} from "@chief/relay-contracts";

import {
  channelIdForKey,
  deterministicUuid,
  workspaceOperation,
} from "./hosted-agent-tools/toolkits/channels";
import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import {
  WORKSPACE_ONBOARDING_OPENING_MESSAGE,
  workspaceOnboardingDelegation,
} from "./workspace-onboarding-job";

type MessagePublisher = (
  job: AgentJob,
  message: AgentPublishedMessage,
  commandId: string,
  actorPubkey?: string,
) => Promise<void>;

interface SpecialistKickoff {
  agentId: string;
  mention: string;
  kind: string;
  operationKey: string;
  payload: {
    name: string;
    website: string;
    selectedApps?: string[];
    conversationId: string;
    skillId?: string;
    title: string;
    instruction: string;
  };
}

export const PROSPECTOR_KICKOFF_INSTRUCTION =
  'First MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly "On it. I\'ll recommend the right prospecting connections and continue in #prospecting.", and idempotencyKey workspace-kickoff-prospector-ack. The relay has already created Prospecting and assigned its members; do not create, search for, or repair channels. This automatic kickoff is a capability handoff, not a web-research run. Do not browse Reddit, X, search engines, or the company website, and do not attempt to discover tools with tools_search or any invented tool name. Call plugins_list with a prospecting-related query, select only relevant plugins that the returned catalog genuinely contains, then call plugins_recommend once to publish no more than three actionable cards in Prospecting. Prefer Needle for public buying-signal discovery when present, Apollo.io for structured people and company discovery when present, and LunarCrush only when social intelligence is relevant and present. Do not install or authorize anything without the user choosing a card. Your final response is published verbatim in Prospecting: briefly explain what each recommended connection unlocks and ask which source the user wants to start with. Requested integrations from workspace setup are unrelated choices and must not be treated as product, audience, competitor, or prospect evidence.';

/** Finalizes Chief's opening and delegates the three independent kickoff cells. */
export async function publishOnboardingResult(
  env: Env,
  job: AgentJob,
  agent: AgentPrincipal,
  rawResult: JsonObject,
  publishMessage: MessagePublisher,
) {
  const result = workspaceOnboardingResultSchema.parse(rawResult);
  const workspace = env.WORKSPACES.get(
    env.WORKSPACES.idFromName(job.workspaceId),
  );
  await ensureOnboardingDelegation(env, job, agent, publishMessage);
  const published =
    result.publishedMessage ??
    agentPublishedMessageSchema.parse({
      conversationId: "mission-control",
      body: result.openingMessage,
    });
  let messages = await missionControlMessages(env, job, agent);
  const openerAlreadyPublished = messages.some(
    (message) =>
      message.author.kind === "agent" &&
      message.author.id === "chief" &&
      !message.threadRootId &&
      message.body === result.openingMessage,
  );
  if (!openerAlreadyPublished) {
    await publishMessage(job, published, job.id, agent.pubkey);
    messages = await missionControlMessages(env, job, agent);
  }
  const snapshotResponse = await workspace.fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "complete-onboarding",
        },
        body: JSON.stringify(result),
      }),
      {
        principal: agent,
        requestId: job.id,
        workspaceId: job.workspaceId,
        conversationId: "mission-control",
      },
    ),
  );
  if (!snapshotResponse.ok) {
    const detail = await snapshotResponse.text().catch(() => "");
    throw new HttpError(
      snapshotResponse.status,
      "onboarding_snapshot_failed",
      `Chief's workspace setup could not be finalized (${snapshotResponse.status}).${
        detail ? ` ${detail.slice(0, 500)}` : ""
      }`,
    );
  }
  await releaseInternalResponse(snapshotResponse);
  await enqueueKickoff(env, job, agent, kickoffThreadRoots(messages));
}

async function ensureOnboardingDelegation(
  env: Env,
  job: AgentJob,
  agent: AgentPrincipal,
  publishMessage: MessagePublisher,
) {
  const selectedApps = Array.isArray(job.payload.selectedApps)
    ? job.payload.selectedApps.map(String)
    : [];
  const delegation = workspaceOnboardingDelegation(selectedApps);
  await workspaceOperation(env, job, agent, "channels-members-add", {
    body: channelMemberAddCommandSchema.parse({
      commandId: await deterministicUuid(`${job.id}:onboarding:members`),
      protocolVersion: 1,
      occurredAt: job.createdAt,
      payload: {
        conversationId: "mission-control",
        members: delegation.map(({ agentId }) => ({
          kind: "agent",
          principalId: agentId,
        })),
      },
    }),
  });
  let messages = await missionControlMessages(env, job, agent);
  const required = [
    WORKSPACE_ONBOARDING_OPENING_MESSAGE,
    ...delegation.map(({ body }) => body),
  ];
  for (const [index, body] of required.entries()) {
    const exists = messages.some(
      (candidate) =>
        candidate.author.kind === "agent" &&
        candidate.author.id === "chief" &&
        !candidate.threadRootId &&
        candidate.body === body,
    );
    if (exists) continue;
    await publishMessage(
      job,
      agentPublishedMessageSchema.parse({
        conversationId: "mission-control",
        body,
      }),
      await deterministicUuid(`${job.id}:onboarding:message:${index}`),
      agent.pubkey,
    );
    messages = await missionControlMessages(env, job, agent);
  }
}

async function enqueueKickoff(
  env: Env,
  job: AgentJob,
  agent: AgentPrincipal,
  threadRoots: Record<string, string>,
) {
  const name =
    isJsonString(job.payload.name) && job.payload.name.trim()
      ? job.payload.name
      : "this workspace";
  const website = isJsonString(job.payload.website) ? job.payload.website : "";
  const selectedApps = Array.isArray(job.payload.selectedApps)
    ? job.payload.selectedApps.map(String)
    : [];
  const common = { name, website };
  const kickoff: SpecialistKickoff[] = [
    {
      agentId: "brand",
      mention: "Marketer",
      kind: "workspace.kickoff.marketing",
      operationKey: "marketing-channel",
      payload: {
        ...common,
        conversationId: "marketing",
        skillId: "build-brand-profile",
        title: "Research the brand and establish a working profile",
        instruction:
          "Privately complete these prerequisites: MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly \"On it. I'll build the first brand profile and continue in #marketing.\", and idempotencyKey workspace-kickoff-brand-ack; MUST call channels_create with operationKey marketing-channel, name marketing, and visibility public; MUST call channels_members_list with channelId mission-control and find the user with role owner; MUST call channels_members_add with the returned channel id and that exact owner in members; then MUST call channels_messages_post with the returned channel id, content exactly \"I'm getting oriented now. I'll share the first evidence-backed brand profile here once it's ready.\", and idempotencyKey workspace-kickoff-brand-arrival. Then perform the attached skill as real work: read the supplied company website and relevant first-party pages with web_read, and save a complete evidence-backed Markdown profile with brand_profile_save using the exact source URLs you inspected. Tool results are the only proof. Your final response is published verbatim in Marketing, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate, summarize the saved profile and its evidence naturally. Clearly label assumptions and ask at most one focused question only when the answer would materially change the work. Do not invent research or claim you inspected a source you could not access.",
      },
    },
    {
      agentId: "prospector",
      mention: "Prospector",
      kind: "workspace.kickoff.prospecting",
      operationKey: "prospecting-channel",
      payload: {
        ...common,
        conversationId: "prospecting",
        title: "Recommend prospecting connections",
        instruction: PROSPECTOR_KICKOFF_INSTRUCTION,
      },
    },
    {
      agentId: "engineer",
      mention: "Engineer",
      kind: "workspace.kickoff.engineering",
      operationKey: "engineering-channel",
      payload: {
        ...common,
        conversationId: "engineering",
        title: "Prepare the engineering workspace",
        instruction:
          'Privately complete these prerequisites: MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly "On it. I\'ll get oriented and continue in #engineering.", and idempotencyKey workspace-kickoff-engineer-ack; MUST call channels_create with operationKey engineering-channel, name engineering, and visibility public; MUST call channels_members_list with channelId mission-control and find the user with role owner; MUST call channels_members_add with the returned channel id and that exact owner in members; then MUST call channels_messages_post with the returned channel id, content exactly "I\'m getting oriented now. I\'ll share the engineering context and a concrete first pass here shortly.", and idempotencyKey workspace-kickoff-engineer-arrival. Tool results are the only proof. Your final response is published verbatim in Engineering, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate, summarize the engineering context actually supplied, call out what remains unknown, and propose one concrete read-only first pass. Requested integrations belong to Setup and are not product or engineering context. Do not claim code changes, repository access, or deployment.',
      },
    },
  ];
  if (selectedApps.length > 0) {
    kickoff.push({
      agentId: "setup",
      mention: "Setup",
      kind: "workspace.kickoff.setup",
      operationKey: "setup-channel",
      payload: {
        ...common,
        selectedApps,
        conversationId: "setup",
        skillId: "setup-integration",
        title: "Privately prepare the selected connections",
        instruction:
          "Privately complete these prerequisites: MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly \"I've got it. I'll check the selected connections and only pull you in when needed.\", and idempotencyKey workspace-kickoff-setup-ack; MUST call channels_create with operationKey setup-channel, name Setup, and visibility private; MUST call channels_members_list with channelId mission-control and find the user with role owner; MUST call channels_members_add with the returned channel id and that exact owner in members; then MUST call channels_messages_post with the returned channel id, content exactly \"I'm checking what is already connected first. I'll only ask you to step in for sign-in, consent, or an unavoidable account choice.\", and idempotencyKey workspace-kickoff-setup-arrival. Treat selected apps as requested setup targets, never as proof they are connected. Inspect each connection using only granted integration and browser tools. Never expose credentials in chat or ask the user to paste secrets into a normal message. Your final response is published verbatim in the private Setup channel: report only verified state and the single next human action, if one is unavoidable. Refer to the channel only when the user needs help locating it; do not repeatedly link or name it in ordinary status messages.",
      },
    });
  }
  const startedAt = Date.now();
  for (const [index, entry] of kickoff.entries()) {
    const threadRootId = threadRoots[entry.agentId];
    if (!threadRootId) {
      throw new HttpError(
        502,
        "kickoff_thread_missing",
        `Chief did not publish ${entry.mention}'s Mission Control kickoff.`,
      );
    }
    const conversationId = await channelIdForKey(entry.operationKey);
    if (entry.agentId === "prospector") {
      await ensureProspectorChannel(env, job, agent, conversationId);
    }
    const command = {
      commandId: crypto.randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        id: crypto.randomUUID(),
        agentId: entry.agentId,
        kind: entry.kind,
        payload: {
          ...entry.payload,
          workflowId: isJsonString(job.payload.workflowId)
            ? job.payload.workflowId
            : job.id,
          conversationId,
          kickoffThreadRootId: threadRootId,
          instruction: `${entry.payload.instruction} The exact Mission Control threadRootId is ${JSON.stringify(threadRootId)}.`,
        },
        availableAt: new Date(startedAt + index * 1_400).toISOString(),
      },
    };
    const stub = env.AGENTS.get(
      env.AGENTS.idFromName(`${job.workspaceId}:${entry.agentId}`),
    );
    const response = await stub.fetch(
      withTrustedContext(
        new Request("https://agent.internal/enqueue", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-workflow-id": isJsonString(job.payload.workflowId)
              ? job.payload.workflowId
              : job.id,
          },
          body: JSON.stringify(command),
        }),
        {
          principal: agent,
          requestId: job.id,
          workspaceId: job.workspaceId,
        },
      ),
    );
    const enqueued = response.ok;
    await releaseInternalResponse(response);
    if (!enqueued) {
      throw new HttpError(
        502,
        "kickoff_enqueue_failed",
        "Chief's follow-up work could not be queued.",
      );
    }
  }
}

async function ensureProspectorChannel(
  env: Env,
  job: AgentJob,
  agent: AgentPrincipal,
  conversationId: string,
) {
  await workspaceOperation(env, job, agent, "channels-create", {
    body: channelCreateCommandSchema.parse({
      commandId: await deterministicUuid(`${job.id}:prospecting:channel`),
      protocolVersion: 1,
      occurredAt: job.createdAt,
      payload: { conversationId, name: "prospecting", isPrivate: false },
    }),
  });
  const missionControl = channelMembersResultSchema.parse(
    await workspaceOperation(env, job, agent, "channels-members-list", {
      conversationId: "mission-control",
    }),
  );
  const owner = missionControl.members.find(
    (member) => member.kind === "user" && member.role === "owner",
  );
  if (!owner) {
    throw new HttpError(
      502,
      "workspace_owner_missing",
      "Chief could not find the workspace owner for Prospecting.",
    );
  }
  await workspaceOperation(env, job, agent, "channels-members-add", {
    body: channelMemberAddCommandSchema.parse({
      commandId: await deterministicUuid(`${job.id}:prospecting:members`),
      protocolVersion: 1,
      occurredAt: job.createdAt,
      payload: {
        conversationId,
        members: [
          { kind: "user", principalId: owner.principalId },
          { kind: "agent", principalId: "prospector" },
        ],
      },
    }),
  });
}

async function missionControlMessages(
  env: Env,
  job: AgentJob,
  agent: AgentPrincipal,
) {
  const conversation = env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${job.workspaceId}:mission-control`),
  );
  const response = await conversation.fetch(
    withTrustedContext(
      new Request("https://conversation.internal/messages?limit=200"),
      {
        principal: agent,
        requestId: job.id,
        workspaceId: job.workspaceId,
        conversationId: "mission-control",
      },
    ),
  );
  if (!response.ok) {
    await releaseInternalResponse(response);
    throw new HttpError(
      502,
      "kickoff_messages_unavailable",
      "Chief's Mission Control messages could not be verified.",
    );
  }
  return messagePageSchema.parse(await response.json()).messages;
}

function kickoffThreadRoots(
  messages: Awaited<ReturnType<typeof missionControlMessages>>,
) {
  const roots: Record<string, string> = {};
  for (const message of messages) {
    if (
      message.author.kind !== "agent" ||
      message.author.id !== "chief" ||
      message.threadRootId
    )
      continue;
    if (message.body.includes("@Marketer")) roots.brand = message.id;
    if (message.body.includes("@Prospector")) roots.prospector = message.id;
    if (message.body.includes("@Engineer")) roots.engineer = message.id;
    if (message.body.includes("@Setup")) roots.setup = message.id;
  }
  return roots;
}
