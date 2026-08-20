import type {
  AgentJob,
  AgentPrincipal,
  AgentPublishedMessage,
} from "@chief/relay-contracts";
import {
  agentPublishedMessageSchema,
  messagePageSchema,
  workspaceOnboardingResultSchema,
} from "@chief/relay-contracts";

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
  rawResult: Record<string, unknown>,
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
    throw new HttpError(
      502,
      "onboarding_snapshot_failed",
      "Chief's workspace setup could not be finalized.",
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
    typeof job.payload.name === "string" && job.payload.name.trim()
      ? job.payload.name
      : "this workspace";
  const website =
    typeof job.payload.website === "string" ? job.payload.website : "";
  const selectedApps = Array.isArray(job.payload.selectedApps)
    ? job.payload.selectedApps.map(String)
    : [];
  const common = { name, website, selectedApps };
  const kickoff = [
    {
      agentId: "brand",
      mention: "Marketer",
      kind: "workspace.kickoff.marketing",
      payload: {
        ...common,
        conversationId: "marketing",
        skillId: "build-brand-profile",
        title: "Research the brand and establish a working profile",
        instruction:
          "Privately complete these prerequisites: MUST call relay_message_post in mission-control with the supplied threadRootId and a short, natural acknowledgement; MUST call relay_channels_create with conversationId marketing, name marketing, and isPrivate false; MUST call relay_workspace_members, find the user with role owner; then MUST call relay_channels_members_add to add that exact owner to marketing. Then perform the attached skill as real work: navigate to the supplied company website in your isolated browser, inspect first-party pages with browser_snapshot, and save a complete evidence-backed Markdown profile with brand_profile_save using the exact source URLs you inspected. Finish with browser_release. Tool results are the only proof. Your final response is published verbatim in Marketing, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate, summarize the saved profile and its evidence naturally. Clearly label assumptions and ask at most one focused question only when the answer would materially change the work. Do not invent research or claim you inspected a source you could not access.",
      },
    },
    {
      agentId: "prospector",
      mention: "Prospector",
      kind: "workspace.kickoff.prospecting",
      payload: {
        ...common,
        conversationId: "prospecting",
        skillId: "find-buying-signals",
        title: "Find the first qualified prospects and buying signals",
        instruction:
          "Privately complete these prerequisites: MUST call relay_message_post in mission-control with the supplied threadRootId and a short, natural acknowledgement; MUST call relay_channels_create with conversationId prospecting, name prospecting, and isPrivate false; MUST call relay_workspace_members, find the user with role owner; then MUST call relay_channels_members_add to add that exact owner to prospecting. Then perform the attached skill as real work: call prospects_list, research the supplied company and relevant public buying signals with the isolated browser, verify pages with browser_snapshot, and persist only genuinely qualified findings with prospects_save and direct source URLs. Finish with browser_release. Tool results are the only proof. Your final response is published verbatim in Prospecting, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate and summarize the evidence-backed findings you actually saved. Distinguish known facts from assumptions. Never invent a person, company, post, source, or URL.",
      },
    },
    {
      agentId: "engineer",
      mention: "Engineer",
      kind: "workspace.kickoff.engineering",
      payload: {
        ...common,
        conversationId: "engineering",
        title: "Prepare the engineering workspace",
        instruction:
          "Privately complete these prerequisites: MUST call relay_message_post in mission-control with the supplied threadRootId and a short, natural acknowledgement; MUST call relay_channels_create with conversationId engineering, name engineering, and isPrivate false; MUST call relay_workspace_members, find the user with role owner; then MUST call relay_channels_members_add to add that exact owner to engineering. Tool results are the only proof. Your final response is published verbatim in Engineering, so never mention required actions, tools, compliance, or what you would publish. Write the useful channel message itself: greet the user like a teammate, summarize the engineering context actually supplied, call out what remains unknown, and propose one concrete read-only first pass. Treat selected apps as relevance only, never proof of a connection, and do not claim code changes, repository access, or deployment.",
      },
    },
  ];
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
  }
  return roots;
}
