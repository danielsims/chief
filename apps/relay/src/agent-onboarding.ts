import type {
  AgentJob,
  AgentPrincipal,
  AgentPublishedMessage,
  JsonObject,
} from "@chief/relay-contracts";
import {
  agentPublishedMessageSchema,
  isJsonString,
  messagePageSchema,
  workspaceOnboardingResultSchema,
} from "@chief/relay-contracts";

import { channelIdForKey } from "./hosted-agent-tools/toolkits/channels";
import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";

type MessagePublisher = (
  job: AgentJob,
  message: AgentPublishedMessage,
  commandId: string,
  actorPubkey?: string,
) => Promise<void>;

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
  await enqueueKickoff(env, job, agent, kickoffThreadRoots(messages));
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
  const common = { name, website, selectedApps };
  const kickoff = [
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
          "Privately complete these prerequisites: MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly \"On it — I'll build the first brand profile and continue in #marketing.\", and idempotencyKey workspace-kickoff-brand-ack; MUST call channels_create with operationKey marketing-channel, name marketing, and visibility public; MUST call channels_members_list with channelId mission-control and find the user with role owner; MUST call channels_members_add with the returned channel id and that exact owner in members; then MUST call channels_messages_post with the returned channel id, content exactly \"I'm getting oriented now. I'll share the first evidence-backed brand profile here once it's ready.\", and idempotencyKey workspace-kickoff-brand-arrival. Then perform the attached skill as real work: open the supplied company website with browser_open, inspect first-party pages with browser_snapshot, and save a complete evidence-backed Markdown profile with brand_profile_save using the exact source URLs you inspected. Finish with browser_close. Tool results are the only proof. Your final response is published verbatim in Marketing, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate, summarize the saved profile and its evidence naturally. Clearly label assumptions and ask at most one focused question only when the answer would materially change the work. Do not invent research or claim you inspected a source you could not access.",
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
        skillId: "find-buying-signals",
        title: "Find the first qualified prospects and buying signals",
        instruction:
          "Privately complete these prerequisites: MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly \"On it — I'll research the first buying signals and continue in #prospecting.\", and idempotencyKey workspace-kickoff-prospector-ack; MUST call channels_create with operationKey prospecting-channel, name prospecting, and visibility public; MUST call channels_members_list with channelId mission-control and find the user with role owner; MUST call channels_members_add with the returned channel id and that exact owner in members; then MUST call channels_messages_post with the returned channel id, content exactly \"I'm getting oriented now. I'll share the first evidence-backed buying signals here once they're ready.\", and idempotencyKey workspace-kickoff-prospector-arrival. Then perform the attached skill as real work: call prospects_list, research the supplied company and relevant public buying signals with the isolated browser, verify pages with browser_snapshot, and persist only genuinely qualified findings with prospects_save and direct source URLs. Finish with browser_close. Tool results are the only proof. Your final response is published verbatim in Prospecting, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate and summarize the evidence-backed findings you actually saved. Distinguish known facts from assumptions. Never invent a person, company, post, source, or URL.",
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
          'Privately complete these prerequisites: MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly "On it — I\'ll get oriented and continue in #engineering.", and idempotencyKey workspace-kickoff-engineer-ack; MUST call channels_create with operationKey engineering-channel, name engineering, and visibility public; MUST call channels_members_list with channelId mission-control and find the user with role owner; MUST call channels_members_add with the returned channel id and that exact owner in members; then MUST call channels_messages_post with the returned channel id, content exactly "I\'m getting oriented now. I\'ll share the engineering context and a concrete first pass here shortly.", and idempotencyKey workspace-kickoff-engineer-arrival. Tool results are the only proof. Your final response is published verbatim in Engineering, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate, summarize the engineering context actually supplied, call out what remains unknown, and propose one concrete read-only first pass. Treat selected apps as relevance only, never proof of a connection, and do not claim code changes, repository access, or deployment.',
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
        conversationId: "setup",
        skillId: "setup-integration",
        title: "Privately prepare the selected connections",
        instruction:
          "Privately complete these prerequisites: MUST call channels_messages_post with channelId mission-control, the supplied threadRootId, content exactly \"I've got it — I'll check the selected connections and continue privately in Setup.\", and idempotencyKey workspace-kickoff-setup-ack; MUST call channels_create with operationKey setup-channel, name Setup, and visibility private; MUST call channels_members_list with channelId mission-control and find the user with role owner; MUST call channels_members_add with the returned channel id and that exact owner in members; then MUST call channels_messages_post with the returned channel id, content exactly \"I'm checking what is already connected first. I'll only ask you to step in for sign-in, consent, or an unavoidable account choice.\", and idempotencyKey workspace-kickoff-setup-arrival. Treat selected apps as requested setup targets, never as proof they are connected. Inspect each connection using only granted integration and browser tools. Never expose credentials in chat or ask the user to paste secrets into a normal message. Your final response is published verbatim in the private Setup channel: report only verified state and the single next human action, if one is unavoidable.",
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
          conversationId,
          threadRootId,
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
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        }),
        {
          principal: agent,
          requestId: job.id,
          workspaceId: job.workspaceId,
        },
      ),
    );
    if (!response.ok) {
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
