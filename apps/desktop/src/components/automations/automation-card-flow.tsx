import type { ComponentPropsWithRef, ReactNode } from "react";
import { useState } from "react";
import { CircleStop, GitBranch, Zap } from "lucide-react";

import type {
  AutomationNodeState,
  AutomationStep,
} from "@chief/relay-contracts";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { AutomationDraft } from "../../pages/automation-draft";
import type { AutomationCatalogue } from "../../pages/use-automation-catalogue";
import type { SelectableAgent } from "../agents/agent-multiselect";
import { useRelaySession } from "../../lib/relay-session-context";
import { usePluginConnections } from "../../lib/use-plugin-connections";
import {
  operatorLabels,
  removeStep,
  updateStep,
} from "../../pages/automation-draft";
import { StepPanel } from "../../pages/automation-inspector";
import {
  TriggerPanel,
  triggerSummary,
} from "../../pages/automation-trigger-fields";
import { useAutomationCatalogue } from "../../pages/use-automation-catalogue";
import { AgentAvatar } from "../agent-avatar";
import { ChiefMark } from "../chief-mark";
import { ProviderLogo } from "../provider-logo";

/**
 * An automation's flow, condensed for a conversation: the trigger and each
 * step top to bottom on one rail, branches indented under their condition.
 * Desktop's canvas and the phone's flow draw the same thing at full size.
 * When editable, each row opens the builder's own editor in a popover.
 */
export function AutomationCardFlow({
  draft,
  agents,
  issues,
  nodes,
  editable,
  onChange,
}: {
  draft: AutomationDraft;
  agents: readonly SelectableAgent[];
  issues: ReadonlyMap<string, string>;
  /** Each step in the latest run, when there is one. */
  nodes: Record<string, AutomationNodeState>;
  editable: boolean;
  onChange: (patch: Partial<AutomationDraft>) => void;
}) {
  const plugins = usePluginConnections();
  // Read once with the card, so a step opens with its tool already known.
  const catalogue = useAutomationCatalogue(editable);
  const context: FlowContext = {
    catalogue,
    draft,
    agents,
    issues,
    nodes,
    editable,
    onChange,
    pluginName: (id) => plugins.find((plugin) => plugin.id === id),
  };
  return (
    <ol className="relative -mx-1.5 mt-3 space-y-0.5" aria-label="Steps">
      <Rail />
      <TriggerRow context={context} />
      {draft.steps.length === 0 ? (
        <Row
          mark={<AgentMark agentId={draft.agentId} agents={agents} />}
          title={draft.instructions || "Works from its brief"}
          meta={`${agentLabel(draft.agentId, agents)} · Brief`}
        />
      ) : (
        <Steps steps={draft.steps} context={context} />
      )}
    </ol>
  );
}

interface FlowContext {
  catalogue: AutomationCatalogue;
  draft: AutomationDraft;
  agents: readonly SelectableAgent[];
  issues: ReadonlyMap<string, string>;
  nodes: Record<string, AutomationNodeState>;
  editable: boolean;
  onChange: (patch: Partial<AutomationDraft>) => void;
  pluginName: (id: string) => { name: string; domain?: string } | undefined;
}

function Rail() {
  return (
    <span
      aria-hidden
      className="bg-foreground/[0.09] absolute top-3 bottom-3 left-[19.5px] w-px"
    />
  );
}

function Steps({
  steps,
  context,
}: {
  steps: readonly AutomationStep[];
  context: FlowContext;
}) {
  return steps.map((step) => (
    <StepRow key={step.id} step={step} context={context} />
  ));
}

function TriggerRow({ context }: { context: FlowContext }) {
  const [open, setOpen] = useState(false);
  const { client } = useRelaySession();
  const row = (
    <Row
      mark={
        <span className="bg-foreground/[0.06] flex size-5 items-center justify-center rounded-full">
          <Zap size={11} className="text-muted-foreground" />
        </span>
      }
      title={triggerSummary(context.draft)}
      meta="Trigger"
      interactive={context.editable}
    />
  );
  if (!context.editable) return row;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{row}</PopoverTrigger>
      <EditorPopover>
        <TriggerPanel
          client={client}
          draft={context.draft}
          onChange={context.onChange}
          onClose={() => setOpen(false)}
        />
      </EditorPopover>
    </Popover>
  );
}

function StepRow({
  step,
  context,
}: {
  step: AutomationStep;
  context: FlowContext;
}) {
  const [open, setOpen] = useState(false);
  const issue = context.issues.get(step.id);
  const node = context.nodes[step.id];
  const view = stepSummary(step, context);
  const row = (
    <Row
      mark={view.mark}
      title={step.title}
      meta={issue ? undefined : view.meta}
      issue={issue}
      state={node?.state}
      interactive={context.editable}
    />
  );
  return (
    <>
      {context.editable ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{row}</PopoverTrigger>
          <EditorPopover>
            <StepEditor
              step={step}
              context={context}
              onClose={() => setOpen(false)}
            />
          </EditorPopover>
        </Popover>
      ) : (
        row
      )}
      {step.type === "condition" ? (
        <li className="pl-6">
          <Branch label="Yes" steps={step.then} context={context} />
          <Branch label="No" steps={step.else} context={context} />
        </li>
      ) : null}
    </>
  );
}

function Branch({
  label,
  steps,
  context,
}: {
  label: string;
  steps: readonly AutomationStep[];
  context: FlowContext;
}) {
  return (
    <ol className="relative space-y-0.5 py-0.5" aria-label={label}>
      <li className="text-muted-foreground flex h-6 items-center gap-2 pl-1 text-[11px]">
        <span className="border-foreground/[0.1] bg-background rounded-full border px-1.5 leading-4">
          {label}
        </span>
        {steps.length === 0 ? "Carries on" : null}
      </li>
      {steps.length > 0 ? (
        <>
          <Rail />
          <Steps steps={steps} context={context} />
        </>
      ) : null}
    </ol>
  );
}

/** The builder's editor, opened from a step. */
function StepEditor({
  step,
  context,
  onClose,
}: {
  step: AutomationStep;
  context: FlowContext;
  onClose: () => void;
}) {
  const { catalogue, draft } = context;
  return (
    <StepPanel
      step={step}
      draft={draft}
      agents={[...context.agents]}
      catalogue={catalogue}
      issue={context.issues.get(step.id)}
      leadPlugins={null}
      node={context.nodes[step.id]}
      onChange={(next) =>
        context.onChange({
          steps: updateStep(draft.steps, step.id, () => next),
        })
      }
      onRemove={() => {
        context.onChange({ steps: removeStep(draft.steps, step.id) });
        onClose();
      }}
      onClose={onClose}
    />
  );
}

function EditorPopover({ children }: { children: ReactNode }) {
  // The panel brings its own surface, so the popover adds none.
  return (
    <PopoverContent
      side="right"
      align="start"
      collisionPadding={12}
      // Opening a step is to read it; typing starts when a field is clicked.
      onOpenAutoFocus={(event) => event.preventDefault()}
      className="max-h-[min(560px,var(--radix-popover-content-available-height))] w-auto overflow-visible rounded-xl border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
    >
      {children}
    </PopoverContent>
  );
}

const runDot: Record<AutomationNodeState["state"], string> = {
  pending: "",
  running: "bg-sky-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  skipped: "bg-foreground/25",
};

/** One line of the flow. A button when it opens an editor. */
function Row({
  mark,
  title,
  meta,
  issue,
  state,
  interactive,
  ...props
}: {
  mark: ReactNode;
  title: string;
  meta?: ReactNode;
  issue?: string;
  state?: AutomationNodeState["state"];
  interactive?: boolean;
} & Omit<ComponentPropsWithRef<"button">, "title">) {
  const content = (
    <>
      {/* Opaque so the rail stops at each mark; it takes the row's hover
          colour so it never shows as a square. */}
      <span
        className={cn(
          "bg-background relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
          interactive && "group-hover:bg-[var(--row-hover)]",
        )}
      >
        {mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[18px] font-medium">
          {title}
        </span>
        {issue ? (
          <span className="text-destructive block truncate text-[11px] leading-4">
            {issue}
          </span>
        ) : meta ? (
          <span className="text-muted-foreground flex min-w-0 items-center gap-1 truncate text-[11px] leading-4">
            {meta}
          </span>
        ) : null}
      </span>
      {state && runDot[state] ? (
        <span
          role="img"
          aria-label={`Latest run: ${state}`}
          className={cn("size-1.5 shrink-0 rounded-full", runDot[state])}
        />
      ) : null}
    </>
  );
  const className = cn(
    "flex w-full min-w-0 items-center gap-2 rounded-[8px] px-1.5 py-1 text-left",
    state === "skipped" && "opacity-50",
  );
  return (
    <li className="relative list-none">
      {interactive ? (
        <button
          type="button"
          {...props}
          className={cn(
            className,
            "group focus-visible:outline-ring transition-colors [--row-hover:color-mix(in_srgb,var(--foreground)_4%,var(--background))] hover:bg-[var(--row-hover)] focus-visible:outline-2",
          )}
        >
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

function agentLabel(agentId: string, agents: readonly SelectableAgent[]) {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function AgentMark({
  agentId,
  agents,
}: {
  agentId: string;
  agents: readonly SelectableAgent[];
}) {
  return (
    <AgentAvatar
      agentId={agentId}
      label={agentLabel(agentId, agents)}
      className="size-5 rounded-full"
    />
  );
}

function stepSummary(
  step: AutomationStep,
  context: FlowContext,
): { mark: ReactNode; meta: ReactNode } {
  if (step.type === "agent")
    return {
      mark: <AgentMark agentId={step.agentId} agents={context.agents} />,
      meta: agentLabel(step.agentId, context.agents),
    };
  if (step.type === "condition")
    return {
      mark: <GitBranch size={13} className="text-muted-foreground" />,
      meta: `If ${readable(step.when.value)} ${operatorLabels[step.when.operator]}${
        step.when.compare &&
        step.when.operator !== "is_empty" &&
        step.when.operator !== "is_not_empty"
          ? ` ${readable(step.when.compare)}`
          : ""
      }`,
    };
  if (step.type === "stop")
    return {
      mark: <CircleStop size={13} className="text-muted-foreground" />,
      meta:
        step.outcome === "skipped" ? "Nothing to do this time" : "Work done",
    };
  if (step.tool.source === "plugin") {
    const plugin = context.pluginName(step.tool.connectionId);
    const name = plugin?.name ?? step.tool.connectionId;
    return {
      mark: plugin?.domain ? (
        <ProviderLogo
          domain={plugin.domain}
          label={name}
          className="size-4 rounded-[4px]"
        />
      ) : (
        <span className="bg-foreground/[0.06] size-4 rounded-[4px]" />
      ),
      meta: `${step.tool.readOnly ? "Read from" : "Act in"} ${name}`,
    };
  }
  return {
    mark: <ChiefMark className="size-3.5" />,
    meta: `Chief · ${step.tool.name}`,
  };
}

/** `{{steps.meetings.output.count}}` reads as `meetings.count`. */
function readable(text: string) {
  return text.replace(
    /\{\{\s*(?:steps\.([^.}\s]+)\.output|trigger\.input)\.?([^}\s]*)\s*\}\}/gu,
    (_, id: string | undefined, path: string) =>
      [id ?? "webhook", path].filter(Boolean).join("."),
  );
}
