import type {
  AgentJob,
  AgentPrincipal,
  AgentPublishedMessage,
  JsonObject,
} from "@chief/relay-contracts";
import {
  agentPublishedMessageSchema,
  channelMemberAddCommandSchema,
  isJsonString,
  messagePageSchema,
  workspaceOnboardingResultSchema,
} from "@chief/relay-contracts";

import { ensureKickoffWorkChannel } from "./agent-kickoff-delivery";
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

function kickoffChannelInstruction(input: {
  ack: string;
  ackKey: string;
  arrival: string;
  arrivalKey: string;
  channelName: string;
  work: string;
}) {
  return `First MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly ${JSON.stringify(input.ack)}, and idempotencyKey ${input.ackKey}. The relay has already created ${input.channelName} and assigned its members; do not create, search for, or repair channels. Then MUST call channels_messages_post with this job's conversationId, content exactly ${JSON.stringify(input.arrival)}, and idempotencyKey ${input.arrivalKey}. ${input.work}`;
}

export const PROSPECTOR_KICKOFF_INSTRUCTION =
  'First MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly "On it. I\'ll recommend the right prospecting connections and continue in #prospecting.", and idempotencyKey workspace-kickoff-prospector-ack. The relay has already created Prospecting and assigned its members; do not create, search for, or repair channels. This automatic kickoff is a capability handoff, not a web-research run. Do not browse Reddit, X, search engines, or the company website, and do not attempt to discover tools with tools_search or any invented tool name. Call plugins_list with a prospecting-related query, select only relevant plugins that the returned catalog genuinely contains, then call plugins_recommend once to publish no more than three actionable cards in Prospecting. Prefer Needle for public buying-signal discovery when present, Apollo.io for structured people and company discovery when present, and LunarCrush only when social intelligence is relevant and present. Do not install or authorize anything without the user choosing a card. Your final response is published verbatim in Prospecting: briefly explain what each recommended connection unlocks and ask which source the user wants to start with. Requested integrations from workspace setup are unrelated choices and must not be treated as product, audience, competitor, or prospect evidence.';

export const MARKETING_KICKOFF_INSTRUCTION = kickoffChannelInstruction({
  ack: "On it. I'll build the first brand profile and continue in #marketing.",
  ackKey: "workspace-kickoff-brand-ack",
  arrival:
    "I'm getting oriented now. I'll share the first evidence-backed brand profile here once it's ready.",
  arrivalKey: "workspace-kickoff-brand-arrival",
  channelName: "Marketing",
  work: "Then perform the attached skill as real work: read the supplied company website and relevant first-party pages with web_read, and save a complete evidence-backed Markdown profile with brand_profile_save using the exact source URLs you inspected. Tool results are the only proof. Your final response is published verbatim in Marketing, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate, summarize the saved profile and its evidence naturally. Clearly label assumptions and ask at most one focused question only when the answer would materially change the work. Do not invent research or claim you inspected a source you could not access.",
});

export const ENGINEERING_KICKOFF_INSTRUCTION = kickoffChannelInstruction({
  ack: "On it. I'll get oriented and continue in #engineering.",
  ackKey: "workspace-kickoff-engineer-ack",
  arrival:
    "I'm getting oriented now. I'll share the engineering context and a concrete first pass here shortly.",
  arrivalKey: "workspace-kickoff-engineer-arrival",
  channelName: "Engineering",
  work: "Tool results are the only proof. Your final response is published verbatim in Engineering, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate, summarize the engineering context actually supplied, call out what remains unknown, and propose one concrete read-only first pass. Requested integrations belong to Setup and are not product or engineering context. Do not claim code changes, repository access, or deployment.",
});

export const SETUP_KICKOFF_INSTRUCTION = kickoffChannelInstruction({
  ack: "I've got it. I'll check the selected connections and only pull you in when needed.",
  ackKey: "workspace-kickoff-setup-ack",
  arrival:
    "I'm checking what is already connected first. I'll only ask you to step in for sign-in, consent, or an unavoidable account choice.",
  arrivalKey: "workspace-kickoff-setup-arrival",
  channelName: "Setup",
  work: "Treat selected apps as requested setup targets, never as proof they are connected. Inspect each connection using only granted integration and browser tools. Never expose credentials in chat or ask the user to paste secrets into a normal message. Your final response is published verbatim in the private Setup channel: report only verified state and the single next human action, if one is unavoidable. Refer to the channel only when the user needs help locating it; do not repeatedly link or name it in ordinary status messages.",
});

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
        instruction: MARKETING_KICKOFF_INSTRUCTION,
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
        instruction: ENGINEERING_KICKOFF_INSTRUCTION,
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
        instruction: SETUP_KICKOFF_INSTRUCTION,
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
    await ensureKickoffWorkChannel(env, job, agent, entry, conversationId);
    const instruction = `${entry.payload.instruction} The exact Mission Control threadRootId is ${JSON.stringify(threadRootId)}.`;
    const commandId = await deterministicUuid(
      `${job.id}:kickoff-command:${entry.agentId}`,
    );
    const jobId = await deterministicUuid(
      `${job.id}:kickoff-job:${entry.agentId}`,
    );
    const occurredAt = new Date().toISOString();
    const command = {
      commandId,
      protocolVersion: 1,
      occurredAt,
      payload: {
        id: jobId,
        agentId: entry.agentId,
        kind: entry.kind,
        payload: {
          ...entry.payload,
          workflowId: isJsonString(job.payload.workflowId)
            ? job.payload.workflowId
            : job.id,
          conversationId,
          kickoffThreadRootId: threadRootId,
          instruction,
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
