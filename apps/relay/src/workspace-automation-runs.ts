import { z } from "zod";

import type {
  AutomationNodeState,
  AutomationRule,
  AutomationStep,
  JsonValue,
  Principal,
  ScheduleRun,
} from "@chief/relay-contracts";
import {
  automationReferences,
  isJsonObject,
  isJsonString,
  jsonObjectSchema,
  jsonValueSchema,
  relayErrorSchema,
  replaceAutomationReferences,
  walkAutomation,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { automationChiefTool } from "./automation-tools";
import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { McpConnectionService } from "./mcp/connection-service";
import { hasAgentPermission } from "./workspace-agent-config";
import { missingRequired, toolInputSchema } from "./workspace-automation-agent";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import {
  finishScheduleRun,
  readScheduleRun,
  scheduleRunIsActive,
  writeScheduleRun,
} from "./workspace-schedule-runs";

/**
 * Runs an automation's steps in order. Conditions and tool steps finish
 * within one pass; an agent step hands off to the agent and the pass ends
 * until the agent reports back. Nothing here evaluates code: conditions are
 * fixed comparisons and references are plain lookups.
 */
const maximumOutputCharacters = 16_000;
const maximumPassSteps = 40;
const toolInterruptedAfterMs = 3 * 60_000;

const automationPrincipal = (workspaceId: string): Principal => ({
  kind: "service",
  service: "automation",
  workspaceId: workspaceIdSchema.parse(workspaceId),
});

type Nodes = Record<string, AutomationNodeState>;

/** A step's input, kept for run history. Large inputs are cut, not dropped. */
function boundedInput(value: JsonValue): Pick<AutomationNodeState, "input"> {
  const serialised = JSON.stringify(value);
  return {
    input:
      serialised.length <= maximumOutputCharacters
        ? value
        : serialised.slice(0, maximumOutputCharacters),
  };
}

function bounded(
  value: JsonValue,
): Pick<AutomationNodeState, "output" | "truncated"> {
  const serialised = JSON.stringify(value);
  return serialised.length <= maximumOutputCharacters
    ? { output: value }
    : { output: serialised.slice(0, maximumOutputCharacters), truncated: true };
}

function lookup(
  value: JsonValue | undefined,
  path: readonly string[],
): JsonValue {
  let current: JsonValue | undefined = value;
  for (const segment of path) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (isJsonObject(current)) current = current[segment];
    else return null;
  }
  return current ?? null;
}

function referenceValue(text: string, nodes: Nodes, input: JsonValue) {
  const [reference] = automationReferences(text);
  if (!reference) return undefined;
  return reference.stepId === undefined
    ? lookup(input, reference.path)
    : lookup(nodes[reference.stepId]?.output, reference.path);
}

const textSchema = z.string();

function asText(value: JsonValue): string {
  const text = textSchema.safeParse(value);
  return text.success ? text.data : JSON.stringify(value);
}

/** A whole-string reference keeps its JSON type; embedded ones become text. */
function resolveValue(
  value: JsonValue,
  nodes: Nodes,
  input: JsonValue,
): JsonValue {
  if (isJsonString(value)) {
    const references = automationReferences(value);
    if (references.length === 1 && references[0]?.raw === value.trim())
      return referenceValue(value.trim(), nodes, input) ?? null;
    return replaceAutomationReferences(value, (reference) =>
      asText(referenceValue(reference.raw, nodes, input) ?? null),
    );
  }
  if (Array.isArray(value))
    return value.map((item) => resolveValue(item, nodes, input));
  if (isJsonObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveValue(item, nodes, input),
      ]),
    );
  return value;
}

/** Step output reaches an agent as fenced data, never as instructions. */
function resolvePrompt(
  prompt: string,
  steps: readonly AutomationStep[],
  nodes: Nodes,
  input: JsonValue,
) {
  return replaceAutomationReferences(prompt, (reference) => {
    const source =
      reference.stepId === undefined
        ? "the trigger"
        : ([...walkAutomation(steps)].find(
            ({ step }) => step.id === reference.stepId,
          )?.step.title ?? reference.stepId);
    // No tag of any spelling survives inside the fence.
    const value = asText(referenceValue(reference.raw, nodes, input) ?? null)
      .slice(0, 8_000)
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    return `<step-output from="${source.replaceAll(/["<>]/gu, "'")}">${value}</step-output>`;
  });
}

/**
 * An agent step that doesn't reference earlier results still gets them, so it
 * works from what the run already fetched instead of fetching it again.
 */
function withEarlierResults(
  prompt: string,
  steps: readonly AutomationStep[],
  nodes: Nodes,
  input: JsonValue,
) {
  if (automationReferences(prompt).length) return prompt;
  const earlier = [
    ...(isEmpty(input) ? [] : ["{{trigger.input}}"]),
    ...[...walkAutomation(steps)]
      .filter(
        ({ step }) =>
          (step.type === "tool" || step.type === "agent") &&
          nodes[step.id]?.state === "completed" &&
          nodes[step.id]?.output !== undefined,
      )
      .map(({ step }) => `{{steps.${step.id}.output}}`),
  ];
  return earlier.length
    ? `${prompt}\n\nUse these earlier results instead of fetching them again:\n${earlier.join("\n")}`
    : prompt;
}

function isEmpty(value: JsonValue) {
  if (value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isJsonObject(value)) return Object.keys(value).length === 0;
  return isJsonString(value) && value.trim() === "";
}

export function evaluateRule(
  rule: AutomationRule,
  nodes: Nodes,
  input: JsonValue,
) {
  const value = resolveValue(rule.value, nodes, input);
  const compare = asText(resolveValue(rule.compare ?? "", nodes, input)).trim();
  const text = asText(value).trim().toLowerCase();
  const target = compare.toLowerCase();
  switch (rule.operator) {
    case "is_empty":
      return isEmpty(value);
    case "is_not_empty":
      return !isEmpty(value);
    case "equals":
      return text === target;
    case "not_equals":
      return text !== target;
    case "contains":
      return Array.isArray(value)
        ? value.some((item) => asText(item).trim().toLowerCase() === target)
        : text.includes(target);
    case "not_contains":
      return Array.isArray(value)
        ? !value.some((item) => asText(item).trim().toLowerCase() === target)
        : !text.includes(target);
    case "greater_than":
    case "less_than": {
      const left = Number(isJsonString(value) ? value.trim() : value);
      const right = Number(compare);
      if (!Number.isFinite(left) || !Number.isFinite(right) || compare === "")
        return false;
      return rule.operator === "greater_than" ? left > right : left < right;
    }
  }
}

type Cursor =
  | { kind: "run"; step: AutomationStep }
  | { kind: "wait" }
  | { kind: "done" }
  | { kind: "failed"; step: AutomationStep; error: string }
  | { kind: "stop"; step: Extract<AutomationStep, { type: "stop" }> };

function nextStep(steps: readonly AutomationStep[], nodes: Nodes): Cursor {
  for (const step of steps) {
    const node = nodes[step.id];
    if (node?.state === "failed")
      return {
        kind: "failed",
        step,
        error: node.error ?? `${step.title} failed.`,
      };
    if (node?.state === "running")
      // A tool call that outlived its deadline was interrupted; the pass
      // decides whether it is safe to try again.
      return step.type === "tool" &&
        Date.now() - (node.startedAt ?? 0) > toolInterruptedAfterMs
        ? { kind: "run", step }
        : { kind: "wait" };
    if (node?.state === "skipped") continue;
    if (node?.state === "completed") {
      if (step.type === "stop") return { kind: "stop", step };
      if (step.type === "condition") {
        const branch =
          lookup(node.output, ["branch"]) === "then" ? step.then : step.else;
        const inner = nextStep(branch, nodes);
        if (inner.kind !== "done") return inner;
      }
      continue;
    }
    return { kind: "run", step };
  }
  return { kind: "done" };
}

function skipAll(steps: readonly AutomationStep[], nodes: Nodes) {
  for (const { step } of walkAutomation(steps))
    nodes[step.id] = { state: "skipped" };
}

function lastText(run: ScheduleRun) {
  const nodes = run.automation?.nodes ?? {};
  const outputs = [...walkAutomation(run.schedule.automation?.steps ?? [])]
    .map(({ step }) => ({ step, node: nodes[step.id] }))
    .filter(
      ({ node }) => node?.state === "completed" && node.output !== undefined,
    )
    .filter(({ step }) => step.type === "agent" || step.type === "tool");
  const last = outputs.at(-1);
  if (last?.node?.output === undefined) return "";
  return asText(lookup(last.node.output, ["text"]) ?? last.node.output).slice(
    0,
    4_000,
  );
}

async function runChiefTool(
  env: Env,
  run: ScheduleRun,
  principal: Principal,
  step: Extract<AutomationStep, { type: "tool" }>,
  args: JsonValue,
  jobId: string,
) {
  const response = await env.AGENTS.get(
    env.AGENTS.idFromName(`${principal.workspaceId}:${run.schedule.agentId}`),
  ).fetch(
    withTrustedContext(
      new Request("https://agent.internal/automation-tool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: run.schedule.agentId,
          jobId,
          conversationId: run.schedule.conversationId,
          threadRootId: run.threadRootId,
          name: step.tool.name,
          arguments: args,
        }),
      }),
      {
        principal: automationPrincipal(principal.workspaceId ?? ""),
        workspaceId: workspaceIdSchema.parse(principal.workspaceId),
        conversationId: run.schedule.conversationId,
        requestId: jobId,
      },
    ),
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = relayErrorSchema.safeParse(body);
    throw new HttpError(
      response.status,
      "automation_tool_failed",
      failure.success ? failure.data.error.message : `${step.title} failed.`,
    );
  }
  return toolOutputSchema.parse(body).output;
}

const toolOutputSchema = z.object({ output: jsonValueSchema });

/** A plugin's error as it wrote it, not as raw MCP content. */
function pluginErrorText(content: JsonValue) {
  const text = Array.isArray(content)
    ? content
        .flatMap((item) =>
          isJsonObject(item) && isJsonString(item.text) ? [item.text] : [],
        )
        .join(" ")
    : "";
  return (text || asText(content)).slice(0, 1_000);
}

export interface AutomationHandoff {
  dispatch: (runStepId: string) => Promise<void>;
  complete: (summary: string) => void;
}

/**
 * One pass over an automation run. Called by the schedule engine after it has
 * refreshed agent hand-offs, so agent step results are already on `run.steps`.
 */
export async function advanceAutomationRun(
  storage: DurableObjectStorage,
  env: Env,
  id: string,
  handoff: AutomationHandoff,
) {
  for (let pass = 0; pass < maximumPassSteps; pass += 1) {
    const current = readScheduleRun(storage, id);
    if (!current || !scheduleRunIsActive(current.run)) return;
    const { run, principal } = current;
    const automation = run.schedule.automation;
    if (!automation) return;
    const nodes: Nodes = { ...run.automation?.nodes };
    const input: JsonValue = run.input;

    // Agent hand-offs that finished since the last pass.
    for (const runStep of run.steps) {
      const entry = Object.entries(nodes).find(
        ([, node]) => node.runStepId === runStep.id,
      );
      if (entry?.[1].state !== "running") continue;
      if (runStep.state === "completed")
        nodes[entry[0]] = {
          ...entry[1],
          state: "completed",
          completedAt: runStep.completedAt ?? Date.now(),
          ...bounded({ text: runStep.evidence ?? "" }),
        };
      else if (runStep.state === "failed")
        nodes[entry[0]] = {
          ...entry[1],
          state: "failed",
          completedAt: Date.now(),
          error: (
            runStep.error ?? `${runStep.agentId} could not finish this step.`
          ).slice(0, 1_000),
        };
    }

    const save = (patch: Partial<ScheduleRun> = {}) =>
      writeScheduleRun(
        storage,
        { ...run, ...patch, automation: { nodes }, updatedAt: Date.now() },
        principal,
      );

    const cursor = nextStep(automation.steps, nodes);
    if (cursor.kind === "wait")
      return save({ nextCheckAt: Date.now() + 15_000 });
    if (cursor.kind === "failed") {
      save();
      finishScheduleRun(
        storage,
        id,
        "failed",
        `${cursor.step.title}: ${cursor.error}`,
      );
      return;
    }
    if (cursor.kind === "done" || cursor.kind === "stop") {
      const skipped =
        cursor.kind === "stop" && cursor.step.outcome === "skipped";
      save();
      const summary = skipped
        ? `Stopped at "${cursor.step.title}". Nothing needed doing this time.`
        : lastText(run) ||
          "The automation finished. Its results are in the run thread.";
      finishScheduleRun(storage, id, "completed", summary);
      handoff.complete(summary);
      return;
    }

    const { step } = cursor;
    const started = Date.now();
    if (step.type === "stop") {
      nodes[step.id] = {
        state: "completed",
        startedAt: started,
        completedAt: started,
      };
      save();
      continue;
    }
    if (step.type === "condition") {
      const matched = evaluateRule(step.when, nodes, input);
      nodes[step.id] = {
        state: "completed",
        startedAt: started,
        completedAt: started,
        output: { branch: matched ? "then" : "else" },
      };
      skipAll(matched ? step.else : step.then, nodes);
      save();
      continue;
    }
    if (step.type === "agent") {
      const runStepId = crypto.randomUUID();
      const prompt = resolvePrompt(
        withEarlierResults(step.prompt, automation.steps, nodes, input),
        automation.steps,
        nodes,
        input,
      );
      nodes[step.id] = {
        state: "running",
        startedAt: started,
        runStepId,
        ...boundedInput({ prompt }),
      };
      save({
        steps: [
          ...run.steps,
          {
            id: runStepId,
            commandId: crypto.randomUUID(),
            agentId: step.agentId,
            phase: "automation",
            state: "pending",
            assignment: `${step.title}\n\n${prompt}`.slice(0, 4_000),
          },
        ],
      });
      await handoff.dispatch(runStepId);
      const after = readScheduleRun(storage, id);
      if (after && scheduleRunIsActive(after.run))
        writeScheduleRun(
          storage,
          { ...after.run, nextCheckAt: Date.now() + 15_000 },
          after.principal,
        );
      return;
    }

    // A tool step. Writes that may have run before an interruption are never
    // repeated: Chief cannot tell whether the outside service applied them.
    const previous = run.automation?.nodes[step.id];
    const chief =
      step.tool.source === "chief"
        ? automationChiefTool(step.tool.name)
        : undefined;
    const replayable =
      step.tool.source === "chief"
        ? chief?.effect !== "non_replayable"
        : step.tool.readOnly;
    // A test checks access for every step but only previews writes: their
    // arguments become the output and the tool is never called.
    const preview =
      run.test === true &&
      !(step.tool.source === "chief" ? chief?.readOnly : step.tool.readOnly);
    if (previous?.state === "running" && !replayable && !preview) {
      nodes[step.id] = {
        ...previous,
        state: "failed",
        completedAt: Date.now(),
        error:
          "Chief was interrupted while this step ran and can't tell whether it finished. Check the result before retrying.",
      };
      save();
      continue;
    }
    // Tool arguments are an object, and resolving references keeps it one.
    const resolved = jsonObjectSchema.safeParse(
      resolveValue(step.arguments, nodes, input),
    );
    nodes[step.id] = {
      state: "running",
      startedAt: started,
      ...(resolved.success ? boundedInput(resolved.data) : undefined),
    };
    save();
    try {
      if (!resolved.success)
        throw new HttpError(
          400,
          "automation_arguments_invalid",
          `${step.title} has inputs that aren't valid.`,
        );
      const args = resolved.data;
      // An empty required input fails here, in words, not at the service.
      const missing = missingRequired(
        toolInputSchema(
          new McpConnectionService(storage, env, principal.workspaceId ?? ""),
          step.tool,
        ).schema,
        args,
      );
      if (missing.length)
        throw new HttpError(
          400,
          "automation_step_incomplete",
          `${missing.map((name) => `"${name}"`).join(", ")} ${missing.length === 1 ? "is" : "are"} empty. Fill ${missing.length === 1 ? "it" : "them"} in, or insert a value from an earlier step.`,
        );
      let output: JsonValue;
      if (step.tool.source === "chief") {
        if (!chief)
          throw new HttpError(
            409,
            "automation_tool_unknown",
            `${step.tool.name} can no longer run in automations.`,
          );
        const config = new WorkspaceChannelStore(
          storage,
          env,
        ).agentConfiguration(run.schedule.agentId);
        if (
          chief.permission &&
          !hasAgentPermission(config.toolPermissions, chief.permission)
        )
          throw new HttpError(
            403,
            "automation_tool_permission",
            `${run.schedule.agentId} is not allowed to ${chief.title.toLowerCase()}. Grant it in Agents, then retry.`,
          );
        output = preview
          ? args
          : await runChiefTool(
              env,
              run,
              principal,
              step,
              args,
              await stepJobId(run.id, step.id),
            );
      } else {
        if (
          !new WorkspaceChannelStore(storage, env)
            .agentConfiguration(run.schedule.agentId)
            .integrations.includes(step.tool.connectionId)
        )
          throw new HttpError(
            403,
            "automation_plugin_unassigned",
            `${run.schedule.agentId} no longer has access to this plugin. Assign it in Agents, then retry.`,
          );
        if (preview) output = args;
        else {
          const result = await new McpConnectionService(
            storage,
            env,
            principal.workspaceId ?? "",
          ).callTool(automationPrincipal(principal.workspaceId ?? ""), {
            connectionId: step.tool.connectionId,
            name: step.tool.name,
            arguments: args,
            requireReadOnly: step.tool.readOnly,
          });
          if (result.isError)
            throw new HttpError(
              502,
              "automation_plugin_error",
              pluginErrorText(result.content),
            );
          output = result.content;
        }
      }
      nodes[step.id] = {
        ...nodes[step.id],
        state: "completed",
        startedAt: started,
        completedAt: Date.now(),
        ...(preview ? { simulated: true } : undefined),
        ...bounded(output),
      };
    } catch (error) {
      nodes[step.id] = {
        ...nodes[step.id],
        state: "failed",
        startedAt: started,
        completedAt: Date.now(),
        error: (error instanceof HttpError
          ? error.message
          : `${step.title} failed.`
        ).slice(0, 1_000),
      };
    }
    const latest = readScheduleRun(storage, id);
    if (!latest || !scheduleRunIsActive(latest.run)) return;
    writeScheduleRun(
      storage,
      {
        ...latest.run,
        automation: {
          nodes: {
            ...latest.run.automation?.nodes,
            [step.id]: nodes[step.id] ?? { state: "failed" },
          },
        },
        updatedAt: Date.now(),
      },
      latest.principal,
    );
  }
  // Too many steps finished in one pass; continue on the next check.
  const current = readScheduleRun(storage, id);
  if (current && scheduleRunIsActive(current.run))
    writeScheduleRun(
      storage,
      { ...current.run, nextCheckAt: Date.now() },
      current.principal,
    );
}

/** A stable UUID per run step, so a retried tool call reuses its idempotency keys. */
async function stepJobId(runId: string, stepId: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`automation:${runId}:${stepId}`),
    ),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
