import type { DragEndEvent } from "@dnd-kit/core";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useState } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Loader2, Minus, Plus, X } from "lucide-react";

import type {
  AutomationNodeState,
  AutomationStep,
} from "@chief/relay-contracts";
import { cn } from "@chief/ui/lib/utils";

import type { SelectableAgent } from "../components/agents/agent-multiselect";
import type { AutomationDraft, StepSlot } from "./automation-draft";
import type { PickedStep } from "./automation-step-picker";
import { AgentAvatar } from "../components/agent-avatar";
import { ChiefMark } from "../components/chief-mark";
import { insetBandClass, insetCardClass } from "../components/inset-card";
import { ProviderLogo } from "../components/provider-logo";
import { operatorLabels } from "./automation-draft";
import { AccessBadge, StepPicker } from "./automation-step-picker";
import { triggerSummary } from "./automation-trigger-fields";
import { chiefToolLabel } from "./use-automation-catalogue";

/** "trigger", "settings", or a step id. */
export type CanvasSelection = string;

/** Everything the + menu needs, passed through untouched. */
export type PickerOptions = Omit<
  Parameters<typeof StepPicker>[0],
  "onPick" | "allowStop"
>;

interface CanvasContext {
  picker: PickerOptions;
  agents: ReadonlyMap<string, SelectableAgent>;
  selected: CanvasSelection | null;
  issues: ReadonlyMap<string, string>;
  runNodes: Record<string, AutomationNodeState>;
  triggered: boolean;
  onSelect: (selection: CanvasSelection) => void;
  onInsert: (slot: StepSlot, picked: PickedStep) => void;
}

const line = "bg-foreground/[0.16]";

function Stem({ className }: { className?: string }) {
  return <span className={cn("block w-px shrink-0", line, className)} />;
}

/** A vertical run of line with a + in the middle. */
function Gap({
  context,
  onPick,
  allowStop,
}: {
  context: CanvasContext;
  onPick: (picked: PickedStep) => void;
  allowStop?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <Stem className="h-3.5" />
      <StepPicker {...context.picker} allowStop={allowStop} onPick={onPick} />
      <Stem className="h-3.5" />
    </div>
  );
}

function RunMark({ node }: { node?: AutomationNodeState }) {
  if (!node || node.state === "pending") return null;
  const style = {
    running: "bg-sky-500 text-white",
    completed: "bg-emerald-500 text-white",
    failed: "bg-destructive text-white",
    skipped: "bg-foreground/20 text-background",
  }[node.state];
  return (
    <span
      title={node.error ?? node.state}
      className={cn(
        "absolute -top-1.5 -right-1.5 z-10 flex size-4 items-center justify-center rounded-full ring-2 ring-[var(--canvas)]",
        style,
      )}
    >
      {node.state === "running" ? (
        <Loader2 size={10} className="block animate-spin" />
      ) : node.state === "completed" ? (
        <Check size={9} strokeWidth={3.2} />
      ) : node.state === "failed" ? (
        <X size={9} strokeWidth={3.2} />
      ) : (
        <Minus size={9} strokeWidth={3.2} />
      )}
    </span>
  );
}

/** Every node on the canvas is this wide, so nothing jumps as steps change. */
export const NODE_WIDTH = "w-[320px]";

/** `{{steps.meetings.output.count}}` reads as `meetings.count`. */
function readableReference(text: string) {
  return text.replace(
    /\{\{\s*(?:steps\.([^.}\s]+)\.output|trigger\.input)\.?([^}\s]*)\s*\}\}/gu,
    (_, id: string | undefined, path: string) =>
      [id ?? "webhook", path].filter(Boolean).join("."),
  );
}

function Token({ children }: { children: ReactNode }) {
  return (
    <span className="bg-foreground/[0.06] text-foreground/85 rounded-[5px] px-1.5 py-px font-mono text-[11px]">
      {children}
    </span>
  );
}

/** Text with each reference shown as a token. */
function WithTokens({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\{\{[^}]*\}\})/gu)
        .map((part, index) =>
          index % 2 ? (
            <Token key={`${index}:${part}`}>{readableReference(part)}</Token>
          ) : (
            part
          ),
        )}
    </>
  );
}

/** A name with its own logo or avatar beside it, never in a tile. */
function Source({ mark, name }: { mark?: ReactNode; name: string }) {
  return (
    <span className="text-foreground/75 flex min-w-0 items-center gap-1.5">
      {mark}
      <span className="truncate">{name}</span>
    </span>
  );
}

const dot = <span className="text-muted-foreground/50 shrink-0">•</span>;

interface NodeView {
  band: string;
  /** A logo or avatar before the title, when no meta line names it. */
  titleMark?: ReactNode;
  meta?: ReactNode;
  detail?: ReactNode;
  readOnly?: boolean;
}

function stepView(step: AutomationStep, context: CanvasContext): NodeView {
  const { catalogue } = context.picker;
  if (step.type === "agent") {
    const agent = context.agents.get(step.agentId);
    const name = agent?.name ?? step.agentId;
    const avatar = (
      <AgentAvatar
        agentId={step.agentId}
        label={name}
        className="size-4 rounded-full"
      />
    );
    return {
      band: "Agent",
      // Named after its agent: the avatar says who, without repeating it.
      ...(step.title === name
        ? { titleMark: avatar }
        : { meta: <Source name={name} mark={avatar} /> }),
      detail: step.prompt.trim() ? (
        <WithTokens text={step.prompt.trim()} />
      ) : (
        "Say what to do"
      ),
    };
  }
  if (step.type === "condition") {
    const { value, operator, compare } = step.when;
    return {
      band: "Condition",
      meta: value ? (
        <span className="flex flex-wrap items-center gap-1">
          <Token>{readableReference(value)}</Token>
          <span>{operatorLabels[operator]}</span>
          {compare && operator !== "is_empty" && operator !== "is_not_empty" ? (
            <Token>{readableReference(compare)}</Token>
          ) : null}
        </span>
      ) : (
        "Choose what to check"
      ),
    };
  }
  if (step.type === "stop")
    return {
      band: "Stop",
      meta:
        step.outcome === "skipped" ? "Nothing to do this time" : "Work done",
    };
  if (step.tool.source === "plugin") {
    const tool = step.tool;
    const plugin = catalogue.plugins.find(
      (item) => item.id === tool.connectionId,
    );
    const name = plugin?.name ?? tool.connectionId;
    const toolTitle =
      plugin?.tools.find((item) => item.name === tool.name)?.title ?? tool.name;
    return {
      band: tool.readOnly ? `Read from ${name}` : `Act in ${name}`,
      meta: (
        <>
          <Source
            name={name}
            mark={
              plugin?.domain ? (
                <ProviderLogo
                  domain={plugin.domain}
                  label={name}
                  className="size-4 rounded-[4px]"
                />
              ) : undefined
            }
          />
          {toolTitle !== step.title ? (
            <>
              {dot}
              <span className="truncate">{toolTitle}</span>
            </>
          ) : null}
        </>
      ),
      readOnly: tool.readOnly,
    };
  }
  const chief = catalogue.chief.find((item) => item.name === step.tool.name);
  const label = chief ? chiefToolLabel(chief) : step.tool.name;
  return {
    band: chief?.readOnly ? "Read from Chief" : "Act in Chief",
    meta: (
      <>
        <Source name="Chief" mark={<ChiefMark className="size-3.5" />} />
        {label !== step.title ? (
          <>
            {dot}
            <span className="truncate">{label}</span>
          </>
        ) : null}
      </>
    ),
    readOnly: chief?.readOnly,
  };
}

/** A soft band naming what kind of step this is, around the step itself. */
function Node({
  band,
  titleMark,
  title,
  meta,
  detail,
  badge,
  selected,
  invalid,
  node,
  onClick,
  drag,
}: NodeView & {
  title: string;
  badge?: ReactNode;
  selected: boolean;
  invalid?: string;
  node?: AutomationNodeState;
  onClick: () => void;
  drag?: Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;
}) {
  // The whole node, band included, is the click and drag target.
  return (
    <button
      type="button"
      title={invalid}
      onClick={onClick}
      {...drag?.attributes}
      {...drag?.listeners}
      className={cn(
        insetBandClass,
        "relative block text-left transition-[opacity,box-shadow] outline-none",
        NODE_WIDTH,
        node?.state === "skipped" && "opacity-50",
        // Selection and keyboard focus ring the whole node.
        selected
          ? "shadow-[0_0_0_2px_var(--color-sky-500)]"
          : "focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-sky-500)_55%,transparent)]",
      )}
    >
      <RunMark node={node} />
      <span className="text-muted-foreground flex h-7 items-center justify-between gap-2 px-2.5 text-[12px]">
        <span className="truncate">{band}</span>
        {invalid ? (
          <span className="text-destructive shrink-0">Needs attention</span>
        ) : (
          (badge ?? null)
        )}
      </span>
      <span className={cn(insetCardClass, "block w-full")}>
        <span className="flex min-w-0 items-center gap-1.5">
          {titleMark}
          <span className="truncate text-[14px] leading-5 font-medium tracking-[-0.01em]">
            {title}
          </span>
        </span>
        {meta ? (
          <span className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1.5 text-[12px] leading-[18px]">
            {meta}
          </span>
        ) : null}
        {detail ? (
          <span className="text-muted-foreground mt-1.5 line-clamp-2 block text-[12px] leading-[18px]">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function StepCard({
  step,
  context,
}: {
  step: AutomationStep;
  context: CanvasContext;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });
  const view = stepView(step, context);
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-80")}
    >
      <Node
        {...view}
        title={step.title}
        badge={
          view.readOnly === false ? <AccessBadge readOnly={false} /> : undefined
        }
        selected={context.selected === step.id}
        invalid={context.issues.get(step.id)}
        node={context.runNodes[step.id]}
        onClick={() => context.onSelect(step.id)}
        drag={{ attributes, listeners }}
      />
    </div>
  );
}

/** A step that nothing can follow: a stop, or a condition whose every branch stops. */
function ends(step: AutomationStep | undefined): boolean {
  if (!step) return false;
  if (step.type === "stop") return true;
  return (
    step.type === "condition" &&
    ends(step.then.at(-1)) &&
    ends(step.else.at(-1))
  );
}

function StepList({
  steps,
  owner,
  context,
}: {
  steps: AutomationStep[];
  owner: Omit<StepSlot, "index">;
  context: CanvasContext;
}) {
  const insert = (index: number) => (picked: PickedStep) =>
    context.onInsert({ ...owner, index }, picked);
  return (
    <SortableContext
      items={steps.map((step) => step.id)}
      strategy={verticalListSortingStrategy}
    >
      <div className="flex flex-col items-center">
        <Gap
          context={context}
          onPick={insert(0)}
          allowStop={steps.length === 0}
        />
        {steps.map((step, index) => (
          <div key={step.id} className="flex flex-col items-center">
            <StepCard step={step} context={context} />
            {step.type === "condition" ? (
              <Branches step={step} context={context} />
            ) : null}
            {ends(step) ? null : (
              <Gap
                context={context}
                onPick={insert(index + 1)}
                allowStop={index === steps.length - 1}
              />
            )}
          </div>
        ))}
      </div>
    </SortableContext>
  );
}

const branches = [
  { key: "then", label: "Yes" },
  { key: "else", label: "No" },
] as const;

/**
 * Two equal columns, so the split and merge rules always meet each column's
 * centre and the parent's stem lands exactly between them.
 */
function Branches({
  step,
  context,
}: {
  step: Extract<AutomationStep, { type: "condition" }>;
  context: CanvasContext;
}) {
  return (
    <div className="flex flex-col items-center">
      <Stem className="h-4" />
      <div className="inline-grid auto-cols-fr grid-flow-col">
        {branches.map(({ key, label }, index) => {
          const stopped = ends(step[key].at(-1));
          const edge = index === 0 ? "left-1/2 right-0" : "left-0 right-1/2";
          return (
            <div key={key} className="relative flex flex-col items-center px-5">
              <span className={cn("absolute top-0 h-px", edge, line)} />
              <Stem className="h-3" />
              <span className="bg-background text-muted-foreground rounded-full px-2 py-px text-[10px] leading-4 font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)]">
                {label}
              </span>
              <StepList
                steps={step[key]}
                owner={{ parentId: step.id, branch: key }}
                context={context}
              />
              {stopped ? (
                <span className="flex-1" />
              ) : (
                <>
                  <Stem className="min-h-0 flex-1" />
                  <span className={cn("absolute bottom-0 h-px", edge, line)} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TriggerCard({
  draft,
  context,
}: {
  draft: AutomationDraft;
  context: CanvasContext;
}) {
  return (
    <Node
      band={
        draft.mode === "webhook"
          ? "When a webhook arrives"
          : draft.mode === "once"
            ? "Runs once"
            : "On a schedule"
      }
      title={triggerSummary(draft)}
      meta={
        draft.mode === "cron" ? draft.timezone.replaceAll("_", " ") : undefined
      }
      node={context.triggered ? { state: "completed" } : undefined}
      selected={context.selected === "trigger"}
      onClick={() => context.onSelect("trigger")}
    />
  );
}

const zoomSteps = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25];

export function AutomationCanvas({
  draft,
  picker,
  agents,
  selected,
  issues,
  runNodes,
  triggered,
  onSelect,
  onInsert,
  onMove,
  composer,
}: {
  draft: AutomationDraft;
  picker: PickerOptions;
  agents: readonly SelectableAgent[];
  selected: CanvasSelection | null;
  issues: ReadonlyMap<string, string>;
  runNodes: Record<string, AutomationNodeState>;
  /** The latest run got past the trigger. */
  triggered: boolean;
  onSelect: (selection: CanvasSelection | null) => void;
  onInsert: (slot: StepSlot, picked: PickedStep) => void;
  onMove: (id: string, overId: string) => void;
  /** Floats at the bottom of the canvas. */
  composer?: ReactNode;
}) {
  const [zoom, setZoom] = useState(1);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const context: CanvasContext = {
    picker,
    agents: new Map(agents.map((agent) => [agent.id, agent])),
    selected,
    issues,
    runNodes,
    triggered,
    onSelect,
    onInsert,
  };
  const nudge = (direction: number) =>
    setZoom((current) => {
      const index = zoomSteps.findIndex((step) => step >= current - 0.001);
      return (
        zoomSteps[
          Math.min(zoomSteps.length - 1, Math.max(0, index + direction))
        ] ?? 1
      );
    });
  const onDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id)
      onMove(String(event.active.id), String(event.over.id));
  };
  const deselect = (event: MouseEvent) => {
    if (event.target === event.currentTarget) onSelect(null);
  };
  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 [--canvas:color-mix(in_srgb,var(--foreground)_2.5%,var(--background))]"
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        nudge(event.deltaY > 0 ? -1 : 1);
      }}
    >
      <div
        className="absolute inset-0 overflow-auto bg-[var(--canvas)] [background-image:radial-gradient(circle,color-mix(in_srgb,var(--foreground)_14%,transparent)_1px,transparent_1.2px)] [background-size:16px_16px]"
        onClick={deselect}
      >
        <div
          className="flex min-h-full min-w-max justify-center px-16 pt-12 pb-48"
          style={{ zoom }}
          onClick={deselect}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <div className="flex flex-col items-center">
              <TriggerCard draft={draft} context={context} />
              <StepList steps={draft.steps} owner={{}} context={context} />
              {draft.steps.length > 0 && !ends(draft.steps.at(-1)) ? (
                <span className="text-muted-foreground bg-background rounded-full px-2 py-px text-[10px] leading-4 font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)]">
                  End
                </span>
              ) : null}
            </div>
          </DndContext>
        </div>
      </div>
      <div className="bg-background absolute bottom-3 left-3 z-20 flex h-7 items-center rounded-[8px] p-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%,transparent)]">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => nudge(-1)}
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex size-6 items-center justify-center rounded-[6px]"
        >
          <Minus size={12} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="text-muted-foreground hover:text-foreground w-10 text-center text-[11px] tabular-nums"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => nudge(1)}
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex size-6 items-center justify-center rounded-[6px]"
        >
          <Plus size={12} />
        </button>
      </div>
      {composer ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center">
          <div className="pointer-events-auto">{composer}</div>
        </div>
      ) : null}
    </div>
  );
}
