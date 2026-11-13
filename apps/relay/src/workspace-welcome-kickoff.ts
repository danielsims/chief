import type { WorkspaceId, WorkspaceSnapshot } from "@chief/relay-contracts";
import {
  agentIdSchema,
  appendMessageCommandSchema,
} from "@chief/relay-contracts";

import type { readTrustedContext } from "./internal-context";
import { deterministicUuid } from "./external-agent-channel-security";
import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";

type TrustedContext = ReturnType<typeof readTrustedContext>;

interface FirstTask {
  /** Chief's message in Welcome that brings the teammate in. */
  ask: string;
  /** What the teammate does, answering in that message's thread. */
  work: string;
  skillId?: string;
}

interface KickoffInput {
  name: string;
  website: string;
  companyName?: string;
  selectedApps: readonly string[];
}

/**
 * Each teammate's first task, by workspace purpose. Personal teammates help
 * one person; company teammates work from the business's own evidence. A
 * teammate with no first task here waits until Chief needs them.
 */
const firstTasks: Record<
  "personal" | "company",
  Record<string, (input: KickoffInput) => FirstTask | null>
> = {
  personal: {
    researcher: () => ({
      ask: "@Researcher, could you say hello and suggest a few things worth looking into?",
      work: "Introduce yourself in one line. Offer three concrete things you could research for this person, like comparing options for a purchase, getting up to speed on a topic, or checking facts, and ask which they'd like first. Don't start researching yet.",
    }),
    planner: () => ({
      ask: "@Planner, could you help get a first plan going?",
      work: "Introduce yourself in one line. Offer to turn one current priority into a short, practical plan, give two quick examples of plans you could make, and ask what's on their plate this week.",
    }),
    writer: () => ({
      ask: "@Writer, could you say hello and offer a hand with writing?",
      work: "Introduce yourself in one line. Offer three everyday things you could draft or polish, like emails, messages or documents, and ask what they're writing at the moment.",
    }),
  },
  company: {
    brand: ({ website }) => ({
      ask: "@Marketer, could you build a first brand profile from what we already have?",
      skillId: "build-brand-profile",
      work: website
        ? `Read ${website} and its most relevant pages with web_read, then save an evidence-backed Markdown profile with brand_profile_save, citing the exact URLs you read. Summarise the profile naturally, label assumptions, and ask at most one question that would change it. Never claim a source you couldn't read.`
        : "There's no website yet. Ask for the website or a short description of the brand, and say what you'll build from it.",
    }),
    content: ({ website }) => ({
      ask: "@Content Writer, could you suggest a first piece of content?",
      work: website
        ? `Read ${website} with web_read and propose three specific first content ideas grounded in what you found, then ask which to draft. Don't publish anything.`
        : "Propose three kinds of first content you could draft and ask what the company wants to say first. Don't publish anything.",
    }),
    analyst: () => ({
      ask: "@Analyst, could you check what we can measure today?",
      work: "Use plugins_list to see which analytics sources are connected; don't install anything. Say what you can report on right now, or which one connection would unlock the most useful first report, and ask which metric matters most.",
    }),
    prospector: () => ({
      ask: "@Prospector, could you recommend where to find our first customers?",
      work: "Call plugins_list with a prospecting-related query, choose only relevant plugins it genuinely returns, and call plugins_recommend once with no more than three cards. Prefer Needle for public buying signals and Apollo.io for people and company data when present. Don't install or authorise anything. Briefly say what each card unlocks and ask which source to start with.",
    }),
    ads: () => ({
      ask: "@Ads Manager, could you see what we can review on paid acquisition?",
      work: "Use plugins_list to see whether an ad platform is connected; don't install anything or spend. Say what you'd review first, or which connection you'd need, and ask which campaigns matter most.",
    }),
    engineer: () => ({
      ask: "@Engineer, could you get oriented on the product work?",
      work: "Summarise the engineering context you actually have, call out what's unknown, and propose one concrete read-only first pass. Don't change code, access repositories you weren't given, or deploy anything.",
    }),
    setup: ({ selectedApps }) =>
      selectedApps.length
        ? {
            ask: `@Setup, could you check the apps we picked: ${[...selectedApps].sort().join(", ")}?`,
            work: "Treat the picked apps as requests, never as proof they're connected. Check each with the integration tools you have and report only verified state, plus the single next step a person must take, if any. Never ask for secrets in a normal message.",
          }
        : null,
  },
};

/** The teammates that get a first task, in the order Chief asks them. */
export function welcomeKickoffTasks(snapshot: WorkspaceSnapshot) {
  const chief = snapshot.agents.find((agent) => agent.id === "chief");
  const tasks = firstTasks[snapshot.purpose ?? "company"];
  const input: KickoffInput = {
    name: snapshot.name,
    website: snapshot.website.trim(),
    companyName: snapshot.companyName ?? undefined,
    selectedApps: snapshot.selectedApps,
  };
  return (chief?.subagents ?? []).flatMap((teammate) => {
    const task = tasks[teammate.id]?.(input);
    return task ? [{ agentId: teammate.id, name: teammate.name, ...task }] : [];
  });
}

/** Posts as an agent straight into a conversation; retries reuse one ID. */
export async function postAgentMessage(
  env: Env,
  context: TrustedContext,
  input: {
    workspaceId: WorkspaceId;
    conversationId: string;
    agentId: string;
    body: string;
    seed: string;
    occurredAt: string;
    threadRootId?: string;
    mentions?: string[];
  },
) {
  const messageId = await deterministicUuid(
    `${input.workspaceId}:${input.seed}`,
  );
  const command = appendMessageCommandSchema.parse({
    commandId: messageId,
    protocolVersion: 1,
    occurredAt: input.occurredAt,
    payload: {
      messageId,
      conversationId: input.conversationId,
      body: input.body,
      mentions: input.mentions ?? [],
      components: [],
      threadRootId: input.threadRootId,
    },
  });
  const response = await env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(
      `${input.workspaceId}:${input.conversationId}`,
    ),
  ).fetch(
    withTrustedContext(
      new Request("https://conversation.internal/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      }),
      {
        ...context,
        principal: {
          kind: "agent",
          agentId: agentIdSchema.parse(input.agentId),
          workspaceId: input.workspaceId,
          role: "member",
          pubkey: "0".repeat(64),
        },
        conversationId: input.conversationId,
        requestId: messageId,
      },
    ),
  );
  if (!response.ok) {
    await releaseInternalResponse(response);
    throw new HttpError(
      502,
      "welcome_failed",
      "Your welcome messages could not be saved. Please try again.",
    );
  }
  await releaseInternalResponse(response);
  return messageId;
}

/**
 * Chief brings each teammate into Welcome with one message, and the teammate
 * answers in its thread whenever its agent app can run. Every step reuses
 * fixed IDs, so finishing setup again never repeats the kickoff.
 */
export async function startWelcomeKickoff(
  env: Env,
  context: TrustedContext,
  snapshot: WorkspaceSnapshot,
  welcome: string,
  tasks: ReturnType<typeof welcomeKickoffTasks>,
) {
  for (const task of tasks) {
    const threadRootId = await postAgentMessage(env, context, {
      workspaceId: snapshot.id,
      conversationId: welcome,
      agentId: "chief",
      body: task.ask,
      seed: `kickoff:${task.agentId}`,
      occurredAt: snapshot.createdAt,
      mentions: [task.agentId],
    });
    const jobId = await deterministicUuid(
      `${snapshot.id}:kickoff-job:${task.agentId}`,
    );
    const response = await env.AGENTS.get(
      env.AGENTS.idFromName(`${snapshot.id}:${task.agentId}`),
    ).fetch(
      withTrustedContext(
        new Request("https://agent.internal/enqueue", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-workflow-id": jobId,
          },
          body: JSON.stringify({
            commandId: jobId,
            protocolVersion: 1,
            occurredAt: new Date().toISOString(),
            payload: {
              id: jobId,
              agentId: task.agentId,
              kind: `workspace.welcome.${task.agentId}`,
              payload: {
                workflowId: jobId,
                name: snapshot.name,
                website: snapshot.website,
                conversationId: welcome,
                threadRootId,
                ...(task.skillId ? { skillId: task.skillId } : undefined),
                instruction: `${task.work} You're answering Chief in a thread in the person's private Welcome channel in ${snapshot.name}. Your final response is posted there as your reply, so write the message itself, keep it short and friendly, and never describe tools or what you would post.`,
              },
              availableAt: new Date().toISOString(),
            },
          }),
        }),
        {
          principal: context.principal,
          requestId: jobId,
          workspaceId: snapshot.id,
        },
      ),
    );
    const queued = response.ok;
    await releaseInternalResponse(response);
    if (!queued)
      throw new HttpError(
        502,
        "kickoff_enqueue_failed",
        "Chief couldn't bring your teammates in. Please try again.",
      );
  }
}
