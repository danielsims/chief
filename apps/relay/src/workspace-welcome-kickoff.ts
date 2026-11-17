import type {
  OnboardingAgentId,
  WorkspaceId,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  appendMessageCommandSchema,
  onboardingAgents,
} from "@chief/relay-contracts";

import type { TrustedRequestContext } from "./internal-context";
import { deterministicUuid } from "./external-agent-channel-security";
import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";

interface FirstTask {
  /** Chief's request in Welcome, after the teammate's @mention. */
  ask: string;
  /** What the teammate does, answering in that message's thread. */
  work: string;
  skillId?: string;
}

interface KickoffInput {
  name: string;
  website: string;
  companyName?: string;
}

/**
 * A teammate's default first task: a one-line hello, then the apps that would
 * help most in its role, shown as cards the person can connect from. It never
 * installs or authorises anything itself.
 */
function suggestApps(role: string, apps: readonly string[]): FirstTask {
  return {
    ask: "could you say hello and suggest the apps that would help you most?",
    work: `Introduce yourself in one line as this workspace's ${role.toLowerCase()} teammate. Then call plugins_recommend exactly once with services ${JSON.stringify(apps)} and a short content line that says, for each, what it would let you do for them. Don't install or authorise anything, and don't list the apps in text. Finish by asking which they'd like to connect first.`,
  };
}

/**
 * Teammates whose first task is more than suggesting apps. Any other
 * teammate suggests the apps from its onboarding card.
 */
const firstTasks: Partial<
  Record<OnboardingAgentId, (input: KickoffInput) => FirstTask | null>
> = {
  brand: ({ website }) =>
    website
      ? {
          ask: "could you build a first brand profile from what we already have?",
          skillId: "build-brand-profile",
          work: `Read ${website} and its most relevant pages with web_read, then save an evidence-backed Markdown profile with brand_profile_save, citing the exact URLs you read. Summarise the profile naturally, label assumptions, and ask at most one question that would change it. Never claim a source you couldn't read.`,
        }
      : null,
};

/** The teammates that get a first task, in the order Chief asks them. */
export function welcomeKickoffTasks(snapshot: WorkspaceSnapshot) {
  const chief = snapshot.agents.find((agent) => agent.id === "chief");
  const input: KickoffInput = {
    name: snapshot.name,
    website: snapshot.website.trim(),
    companyName: snapshot.companyName ?? undefined,
  };
  return (chief?.subagents ?? []).flatMap((teammate) => {
    const card = onboardingAgents.find((agent) => agent.id === teammate.id);
    if (!card) return [];
    const task =
      firstTasks[card.id]?.(input) ??
      suggestApps(
        card.role,
        card.apps.map((app) => app.name),
      );
    // Chief addresses each teammate by the name it was given.
    return [
      {
        agentId: teammate.id,
        name: teammate.name,
        ...task,
        ask: `@${teammate.name}, ${task.ask}`,
      },
    ];
  });
}

/** Posts as an agent straight into a conversation; retries reuse one ID. */
export async function postAgentMessage(
  env: Env,
  context: TrustedRequestContext,
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
  context: TrustedRequestContext,
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
      occurredAt: new Date().toISOString(),
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
