import { z } from "zod";

import type {
  JsonObject,
  JsonValue,
  Principal,
  ScheduleRun,
  WorkspaceSchedule,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  isJsonString,
  jsonObjectSchema,
  walkAutomation,
} from "@chief/relay-contracts";

import { automationChiefTool, automationChiefTools } from "./automation-tools";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { McpConnectionService } from "./mcp/connection-service";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { hasAgentPermission } from "./workspace-agent-config";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import {
  listScheduleRuns,
  queueScheduleRun,
  scheduleRunIsActive,
} from "./workspace-schedule-runs";
import {
  presentWorkspaceSchedule,
  readWorkspaceSchedule,
  wakeWorkspaceSchedules,
} from "./workspace-schedule-store";
import { latestWebhookEvents } from "./workspace-schedule-webhooks";

/**
 * What agents use to build an automation until it works: the tools a step can
 * use, a test run, and a read-back of results and blockers. Drafts are saved
 * through the ordinary schedule save, so approval rules stay in one place.
 */
const toolsRequestSchema = z.object({
  query: z.string().trim().max(200).default(""),
  agentId: agentIdSchema.optional(),
});
const automationRequestSchema = z.object({ id: z.string().min(1).max(120) });

const maximumTools = 20;
const maximumDescription = 300;
const maximumValueCharacters = 4_000;

/** Queues a test of the schedule as it is now. Reused by the Test button. */
export function queueAutomationTest(
  storage: DurableObjectStorage,
  schedule: WorkspaceSchedule,
  principal: Principal,
  id: string,
) {
  if (!schedule.automation?.steps.length)
    throw new HttpError(
      400,
      "schedule_test_unavailable",
      "Add a step before testing this automation.",
    );
  // A webhook automation is tested against the latest event it received.
  const event =
    schedule.triggerMode === "webhook"
      ? latestWebhookEvents(storage, schedule.id)[0]
      : undefined;
  return queueScheduleRun(storage, schedule, principal, {
    id,
    source: "manual",
    scheduledAt: Date.now(),
    test: true,
    ...(event ? { input: event.input } : undefined),
  });
}

/** An agent may test only automations it takes part in. */
export function requireAutomationTester(
  channels: WorkspaceChannelStore,
  schedule: WorkspaceSchedule,
  principal: Principal,
) {
  if (principal.kind !== "agent")
    return requireWorkspaceAdministrator(channels, principal);
  if (
    !channels.agentIsLive(principal.agentId) ||
    ![schedule.agentId, ...schedule.collaborators].includes(principal.agentId)
  )
    throw new HttpError(
      403,
      "automation_team_only",
      "Only the automation's own agents can test it.",
    );
}

export async function routeAutomationAgent(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
  operation: string,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requireWorkspace(context.workspaceId);
  channels.requirePrincipalMember(context.principal);
  channels.requireAgentCapability(
    context.principal,
    operation === "automations-test" ? "workspace.write" : "workspace.read",
  );
  const body = await parseJson(request);
  if (operation === "automations-tools") {
    const input = toolsRequestSchema.parse(body);
    const agentId =
      input.agentId ??
      (context.principal.kind === "agent" ? context.principal.agentId : null);
    if (!agentId)
      throw new HttpError(400, "agent_required", "Choose the lead agent.");
    return json(
      toolCatalogue(storage, env, context.workspaceId, agentId, input.query),
    );
  }
  const { id } = automationRequestSchema.parse(body);
  const stored = readWorkspaceSchedule(storage, id);
  if (!stored)
    throw new HttpError(
      404,
      "schedule_not_found",
      "This automation doesn't exist. Save it with recurringWork.propose first.",
    );
  channels.requireChannelVisible(
    stored.schedule.conversationId,
    context.principal,
  );
  if (operation === "automations-inspect")
    return json(
      inspectAutomation(
        storage,
        env,
        context.workspaceId,
        stored.schedule,
        Boolean(stored.approvedBy),
      ),
    );
  if (operation !== "automations-test")
    throw new HttpError(404, "operation_missing", "Unknown operation.");
  requireAutomationTester(channels, stored.schedule, context.principal);
  // One test at a time: asking again returns the test already under way.
  const active = listScheduleRuns(storage, id).find(
    (run) => run.test && scheduleRunIsActive(run),
  );
  const run =
    active ??
    queueAutomationTest(
      storage,
      stored.schedule,
      context.principal,
      crypto.randomUUID(),
    );
  await wakeWorkspaceSchedules(storage);
  return json({ runId: run.id, state: run.state });
}

function shortText(value: string, limit: number) {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Long values are cut so a read-back stays readable in a conversation. */
function bounded(value: JsonValue | undefined) {
  if (value === undefined) return undefined;
  const serialised = JSON.stringify(value);
  return serialised.length <= maximumValueCharacters
    ? value
    : `${serialised.slice(0, maximumValueCharacters)}… (cut)`;
}

function toolCatalogue(
  storage: DurableObjectStorage,
  env: Env,
  workspaceId: string,
  agentId: string,
  query: string,
) {
  const config = new WorkspaceChannelStore(storage, env).agentConfiguration(
    agentId,
  );
  const chief = automationChiefTools()
    .filter(
      (tool) =>
        !tool.permission ||
        hasAgentPermission(config.toolPermissions, tool.permission),
    )
    .map((tool) => ({
      tool: { source: "chief" as const, name: tool.name },
      title: tool.title,
      readOnly: tool.readOnly,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  const plugins = new McpConnectionService(storage, env, workspaceId)
    .list()
    .filter(
      (connection) =>
        connection.status === "connected" &&
        config.integrations.includes(connection.id),
    )
    .flatMap((connection) =>
      connection.tools.map((tool) => ({
        tool: {
          source: "plugin" as const,
          connectionId: connection.id,
          name: tool.name,
          readOnly: tool.readOnly,
        },
        title: `${connection.name}: ${tool.title ?? tool.name}`,
        readOnly: tool.readOnly,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    );
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const matches = [...plugins, ...chief].filter((entry) => {
    const haystack =
      `${entry.tool.name} ${entry.title} ${entry.description}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  return {
    agentId,
    tools: matches.slice(0, maximumTools).map((entry) => ({
      ...entry,
      description: shortText(entry.description, maximumDescription),
    })),
    ...(matches.length > maximumTools
      ? { more: `${matches.length - maximumTools} more; search more narrowly.` }
      : undefined),
  };
}

/** A tool step's input schema, and its plugin connection if it has one. */
export function toolInputSchema(
  plugins: McpConnectionService,
  tool: Extract<
    NonNullable<WorkspaceSchedule["automation"]>["steps"][number],
    { type: "tool" }
  >["tool"],
) {
  if (tool.source === "chief")
    return {
      schema: jsonObjectSchema.safeParse(
        automationChiefTool(tool.name)?.inputSchema,
      ).data,
    };
  const connection = plugins
    .list()
    .find((item) => item.id === tool.connectionId);
  return {
    connection,
    schema: connection?.tools.find((item) => item.name === tool.name)
      ?.inputSchema,
  };
}

/** Required inputs that are missing or empty. */
export function missingRequired(
  schema: JsonObject | undefined,
  args: JsonObject,
) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  return required
    .filter(isJsonString)
    .filter(
      (name) =>
        args[name] === undefined || args[name] === null || args[name] === "",
    );
}

function blockers(
  schedule: WorkspaceSchedule,
  approved: boolean,
  runs: readonly ScheduleRun[],
  hasEvent: boolean,
  plugins: McpConnectionService,
) {
  const found: string[] = [];
  const steps = schedule.automation?.steps ?? [];
  const reconnect = new Set<string>();
  for (const { step } of walkAutomation(steps)) {
    if (step.type !== "tool") continue;
    const { connection, schema } = toolInputSchema(plugins, step.tool);
    if (connection && connection.status !== "connected")
      reconnect.add(connection.name);
    const missing = missingRequired(schema, step.arguments);
    if (missing.length)
      found.push(`"${step.title}" needs ${missing.join(", ")}.`);
  }
  for (const name of reconnect)
    found.push(
      `${name} needs reconnecting. Ask the user to reconnect it in Plugins.`,
    );
  if (schedule.triggerMode === "webhook" && !hasEvent)
    found.push(
      "No webhook event has arrived yet. Ask the user to copy the URL from the automation's trigger into the sending app and send a test event.",
    );
  if (steps.length) {
    const test = runs.find((run) => run.test);
    if (test && scheduleRunIsActive(test)) found.push("A test is running.");
    else if (test && (test.state === "failed" || test.state === "blocked"))
      found.push(`The latest test failed: ${test.summary || "see its steps"}`);
    else if (
      test?.state !== "completed" ||
      test.schedule.updatedAt !== schedule.updatedAt
    )
      found.push("This version hasn't passed a test. Run automations.test.");
  }
  if (!approved || schedule.status === "needs_approval")
    found.push("The user needs to review it and turn it on in Automations.");
  else if (schedule.status === "paused") found.push("It is switched off.");
  else if (schedule.status === "error")
    found.push(`It stopped: ${schedule.lastSummary ?? "unknown error"}`);
  return found;
}

function inspectAutomation(
  storage: DurableObjectStorage,
  env: Env,
  workspaceId: string,
  schedule: WorkspaceSchedule,
  approved: boolean,
) {
  const runs = listScheduleRuns(storage, schedule.id).slice(0, 3);
  const event =
    schedule.triggerMode === "webhook"
      ? latestWebhookEvents(storage, schedule.id)[0]
      : undefined;
  const plugins = new McpConnectionService(storage, env, workspaceId);
  return {
    automation: presentWorkspaceSchedule(schedule),
    approved,
    blockers: blockers(schedule, approved, runs, Boolean(event), plugins),
    latestEvent: event
      ? { receivedAt: event.receivedAt, input: bounded(event.input) }
      : null,
    // The newest run in full; older ones as a summary.
    runs: runs.map((run, index) => ({
      id: run.id,
      test: Boolean(run.test),
      source: run.source,
      state: run.state,
      summary: run.summary,
      createdAt: run.createdAt,
      ...(index === 0
        ? {
            steps: Object.fromEntries(
              Object.entries(run.automation?.nodes ?? {}).map(([id, node]) => [
                id,
                {
                  state: node.state,
                  input: bounded(node.input),
                  output: bounded(node.output),
                  error: node.error,
                  simulated: node.simulated,
                },
              ]),
            ),
          }
        : undefined),
    })),
  };
}
