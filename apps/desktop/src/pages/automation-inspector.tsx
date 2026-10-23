import type { ReactNode } from "react";
import { useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  OctagonX,
  Plus,
  Split,
  Trash2,
} from "lucide-react";
import { Link } from "react-router";

import type {
  AutomationNodeState,
  AutomationStep,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  automationOperators,
  automationRuleSchema,
} from "@chief/relay-contracts";
import { SelectItem } from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import type { SelectableAgent } from "../components/agents/agent-multiselect";
import type { AutomationDraft } from "./automation-draft";
import type { AutomationCatalogue } from "./use-automation-catalogue";
import { AgentAvatar } from "../components/agent-avatar";
import {
  AgentMultiselect,
  TeamAvatar,
} from "../components/agents/agent-multiselect";
import { ChiefMark } from "../components/chief-mark";
import { ProviderLogo } from "../components/provider-logo";
import {
  ReferenceMenu,
  ReferenceText,
  ToolArguments,
} from "./automation-arguments";
import { availableOutputs, operatorLabels } from "./automation-draft";
import {
  Choice,
  controlClass,
  Field,
  Panel,
  PanelRow,
  PanelSection,
  Segmented,
  textAreaClass,
} from "./automation-panel";
import { AccessBadge } from "./automation-step-picker";

function AgentChoice({
  label,
  agents,
  value,
  onChange,
}: {
  label: string;
  agents: readonly SelectableAgent[];
  value: string;
  onChange: (agentId: string) => void;
}) {
  return (
    <Choice label={label} value={value} onChange={onChange}>
      {agents.map((agent) => (
        <SelectItem key={agent.id} value={agent.id} className="text-[12px]">
          <span className="flex items-center gap-2">
            <TeamAvatar agent={agent} />
            {agent.name}
          </span>
        </SelectItem>
      ))}
    </Choice>
  );
}

export function SettingsPanel({
  draft,
  agents,
  channels,
  onChange,
  onClose,
}: {
  draft: AutomationDraft;
  agents: SelectableAgent[];
  channels: { id: string; name: string }[];
  onChange: (patch: Partial<AutomationDraft>) => void;
  onClose: () => void;
}) {
  const [more, setMore] = useState(false);
  return (
    <Panel title="Settings" onClose={onClose}>
      <PanelSection title="Brief">
        <textarea
          maxLength={8000}
          className={cn(textAreaClass, "min-h-24")}
          value={draft.instructions}
          placeholder="What this automation is for and what good looks like."
          onChange={(event) => onChange({ instructions: event.target.value })}
        />
        <p className="text-muted-foreground text-[11px] leading-4">
          {draft.steps.length
            ? "Every agent step sees this as context."
            : "With no steps, the team works from this brief."}
        </p>
      </PanelSection>
      <PanelSection title="Team">
        <PanelRow label="Lead">
          <AgentChoice
            label="Lead"
            agents={agents}
            value={draft.agentId}
            onChange={(agentId) =>
              onChange({
                agentId,
                collaborators: draft.collaborators.filter(
                  (id) => id !== agentId,
                ),
              })
            }
          />
        </PanelRow>
        {draft.steps.length ? null : (
          <Field label="Teammates">
            <AgentMultiselect
              agents={agents.filter((agent) => agent.id !== draft.agentId)}
              value={draft.collaborators}
              onChange={(collaborators) => onChange({ collaborators })}
              inputClassName={cn(controlClass, "pl-8")}
            />
          </Field>
        )}
        <PanelRow label="Channel">
          <Choice
            label="Channel"
            value={draft.channelId}
            onChange={(channelId) => onChange({ channelId })}
          >
            {channels.map((channel) => (
              <SelectItem
                key={channel.id}
                value={channel.id}
                className="text-[12px]"
              >
                #{channel.name}
              </SelectItem>
            ))}
            <SelectItem value="new" className="text-[12px]">
              <span className="flex items-center gap-2">
                <Plus aria-hidden="true" className="size-3.5" />
                New channel
              </span>
            </SelectItem>
          </Choice>
        </PanelRow>
      </PanelSection>
      <PanelSection
        title="Limits"
        action={
          <button
            type="button"
            aria-expanded={more}
            aria-label={more ? "Hide limits" : "Show limits"}
            onClick={() => setMore((value) => !value)}
            className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded-[5px]"
          >
            <ChevronRight
              size={13}
              className={cn("transition-transform", more && "rotate-90")}
            />
          </button>
        }
      >
        {more ? (
          <>
            <Field label="Success looks like">
              <input
                maxLength={2000}
                value={draft.expectedOutcome}
                placeholder="Optional"
                onChange={(event) =>
                  onChange({ expectedOutcome: event.target.value })
                }
                className={controlClass}
              />
            </Field>
            <Field label="Boundaries">
              <input
                maxLength={4000}
                value={draft.constraints}
                placeholder="Anything the team should avoid"
                onChange={(event) =>
                  onChange({ constraints: event.target.value })
                }
                className={controlClass}
              />
            </Field>
            <PanelRow label="Time limit">
              <span className="relative">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={draft.maxDurationMinutes}
                  onChange={(event) =>
                    onChange({
                      maxDurationMinutes: Number(event.target.value),
                    })
                  }
                  className={cn(controlClass, "pr-9 tabular-nums")}
                />
                <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px]">
                  min
                </span>
              </span>
            </PanelRow>
          </>
        ) : null}
      </PanelSection>
    </Panel>
  );
}

function stepHeader(
  step: AutomationStep,
  agents: readonly SelectableAgent[],
  catalogue: AutomationCatalogue,
): { icon: ReactNode; eyebrow: string } {
  if (step.type === "agent")
    return {
      icon: (
        <AgentAvatar
          agentId={step.agentId}
          label={step.agentId}
          className="size-6 rounded-[7px]"
        />
      ),
      eyebrow:
        agents.find((agent) => agent.id === step.agentId)?.name ?? "Agent",
    };
  if (step.type === "condition")
    return {
      icon: <Split size={14} className="text-muted-foreground" />,
      eyebrow: "Condition",
    };
  if (step.type === "stop")
    return {
      icon: <OctagonX size={14} className="text-muted-foreground" />,
      eyebrow: "Stop",
    };
  if (step.tool.source === "plugin") {
    const { connectionId } = step.tool;
    const plugin = catalogue.plugins.find((item) => item.id === connectionId);
    return {
      icon: plugin?.domain ? (
        <ProviderLogo
          domain={plugin.domain}
          label={plugin.name}
          className="size-6 rounded-[7px]"
        />
      ) : null,
      eyebrow: plugin?.name ?? connectionId,
    };
  }
  return {
    icon: (
      <span className="bg-foreground text-background flex size-6 items-center justify-center rounded-[7px]">
        <ChiefMark className="size-3.5" />
      </span>
    ),
    eyebrow: "Chief",
  };
}

export function StepPanel({
  step,
  draft,
  agents,
  catalogue,
  issue,
  leadPlugins,
  node,
  onChange,
  onRemove,
  onClose,
}: {
  step: AutomationStep;
  draft: AutomationDraft;
  agents: SelectableAgent[];
  catalogue: AutomationCatalogue;
  issue?: string;
  /** Plugins the lead may use, once known. */
  leadPlugins: readonly string[] | null;
  /** This step in the latest run or test, if it got that far. */
  node?: AutomationNodeState;
  onChange: (step: AutomationStep) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const outputs = availableOutputs(draft.steps, step.id);
  const webhook = draft.mode === "webhook";
  const header = stepHeader(step, agents, catalogue);
  const pluginRef =
    step.type === "tool" && step.tool.source === "plugin"
      ? step.tool
      : undefined;
  const plugin = pluginRef
    ? catalogue.plugins.find((item) => item.id === pluginRef.connectionId)
    : undefined;
  const tool =
    step.type !== "tool"
      ? undefined
      : pluginRef
        ? plugin?.tools.find((item) => item.name === pluginRef.name)
        : catalogue.chief.find((item) => item.name === step.tool.name);
  const lead = agents.find((agent) => agent.id === draft.agentId);
  const missingAccess =
    pluginRef && leadPlugins !== null
      ? !leadPlugins.includes(pluginRef.connectionId)
      : false;
  const readOnly = pluginRef?.readOnly ?? tool?.readOnly ?? false;

  return (
    <Panel
      icon={header.icon}
      eyebrow={header.eyebrow}
      title={step.title}
      onTitleChange={(title) => onChange({ ...step, title })}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/[0.06] flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[11px] font-medium"
        >
          <Trash2 size={12} />
          Delete step
        </button>
      }
    >
      {issue ? (
        <p className="bg-destructive/[0.06] text-destructive border-b border-black/[0.055] px-3 py-2 text-[11px] leading-4 dark:border-white/[0.06]">
          {issue}
        </p>
      ) : null}
      {step.type === "agent" ? (
        <>
          <PanelSection>
            <PanelRow label="Agent">
              <AgentChoice
                label="Agent"
                agents={agents}
                value={step.agentId}
                onChange={(agentId) =>
                  onChange({ ...step, agentId: agentIdSchema.parse(agentId) })
                }
              />
            </PanelRow>
          </PanelSection>
          <PanelSection>
            <ReferenceText
              label="Instructions"
              multiline
              className="min-h-40"
              outputs={outputs}
              includeTrigger={webhook}
              value={step.prompt}
              placeholder="Summarise the meetings in a few bullets and flag anything that needs a reply."
              onChange={(prompt) => onChange({ ...step, prompt })}
            />
          </PanelSection>
        </>
      ) : null}
      {step.type === "tool" ? (
        <>
          <PanelSection>
            <div className="flex items-center gap-2">
              <AccessBadge readOnly={readOnly} />
              <span className="text-muted-foreground truncate text-[11px]">
                {readOnly ? "Only reads data" : "Can create, change or send"}
              </span>
            </div>
            {tool?.description ? (
              <p className="text-muted-foreground line-clamp-2 text-[11px] leading-4">
                {tool.description}
              </p>
            ) : null}
            {!tool && !catalogue.loading ? (
              <p className="text-destructive text-[11px] leading-4">
                This tool isn't available any more. Reconnect its plugin or
                delete the step.
              </p>
            ) : null}
            {missingAccess ? (
              <div className="rounded-[8px] bg-amber-500/[0.08] px-2.5 py-2 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
                {lead?.name ?? "The lead"} can't use{" "}
                {plugin?.name ?? "this plugin"} yet, so this step won't save.
                <Link
                  to={`/agents?agent=${encodeURIComponent(draft.agentId)}`}
                  className="mt-1 flex items-center gap-0.5 font-medium underline-offset-2 hover:underline"
                >
                  Give access in Agents
                  <ArrowUpRight size={11} />
                </Link>
              </div>
            ) : null}
          </PanelSection>
          <PanelSection title="Inputs">
            <ToolArguments
              schema={tool?.inputSchema ?? {}}
              value={step.arguments}
              onChange={(args) => onChange({ ...step, arguments: args })}
              outputs={outputs}
              includeTrigger={webhook}
            />
          </PanelSection>
        </>
      ) : null}
      {step.type === "condition" ? (
        <PanelSection title="If">
          <Field
            label="This value"
            action={
              <ReferenceMenu
                outputs={outputs}
                includeTrigger={webhook}
                onInsert={(value) =>
                  onChange({ ...step, when: { ...step.when, value } })
                }
              />
            }
          >
            <input
              value={step.when.value}
              placeholder="{{steps.id.output.count}}"
              spellCheck={false}
              onChange={(event) =>
                onChange({
                  ...step,
                  when: { ...step.when, value: event.target.value },
                })
              }
              className={cn(controlClass, "font-mono text-[11px]")}
            />
          </Field>
          <Choice
            label="Comparison"
            value={step.when.operator}
            onChange={(operator) =>
              onChange({
                ...step,
                when: {
                  ...step.when,
                  operator: automationRuleSchema.shape.operator.parse(operator),
                },
              })
            }
          >
            {automationOperators.map((operator) => (
              <SelectItem
                key={operator}
                value={operator}
                className="text-[12px]"
              >
                {operatorLabels[operator]}
              </SelectItem>
            ))}
          </Choice>
          {step.when.operator !== "is_empty" &&
          step.when.operator !== "is_not_empty" ? (
            <ReferenceText
              label="Compared with"
              outputs={outputs}
              includeTrigger={webhook}
              value={step.when.compare ?? ""}
              onChange={(compare) =>
                onChange({ ...step, when: { ...step.when, compare } })
              }
            />
          ) : null}
        </PanelSection>
      ) : null}
      {step.type === "stop" ? (
        <PanelSection title="The run ends as">
          <Segmented
            label="Outcome"
            value={step.outcome}
            onChange={(outcome) => onChange({ ...step, outcome })}
            options={[
              { value: "skipped", label: "Nothing to do" },
              { value: "completed", label: "Done" },
            ]}
          />
        </PanelSection>
      ) : null}
      {node && node.state !== "pending" ? <LastRun node={node} /> : null}
    </Panel>
  );
}

/** What this step did last time, or what a test would have sent. */
function LastRun({ node }: { node: AutomationNodeState }) {
  const title = node.simulated
    ? "Would send"
    : node.state === "failed"
      ? "Last run failed"
      : node.state === "running"
        ? "Running"
        : node.state === "skipped"
          ? "Skipped last run"
          : "Last run";
  return (
    <PanelSection title={title}>
      {node.simulated ? (
        <p className="text-muted-foreground text-[11px] leading-4">
          Tests don't change anything. This is what it would have sent.
        </p>
      ) : null}
      {node.error ? (
        <p className="text-destructive text-[11px] leading-4">{node.error}</p>
      ) : null}
      {node.state === "failed" && node.input !== undefined ? (
        <pre className="bg-foreground/[0.045] max-h-40 overflow-auto rounded-[6px] px-2 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap">
          {JSON.stringify(node.input, null, 2)}
        </pre>
      ) : null}
      {node.output !== undefined ? (
        <pre className="bg-foreground/[0.045] max-h-56 overflow-auto rounded-[6px] px-2 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap">
          {JSON.stringify(node.output, null, 2)}
          {node.truncated ? "\n…" : ""}
        </pre>
      ) : null}
    </PanelSection>
  );
}
