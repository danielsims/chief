import type { AutomationStep } from "@chief/relay-contracts";
import { walkAutomation } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { cn } from "@chief/ui/lib/utils";

import type { AutomationCatalogue } from "./use-automation-catalogue";
import { AgentAvatar } from "../components/agent-avatar";
import { ChiefMark } from "../components/chief-mark";
import { insetCardClass } from "../components/inset-card";
import { ProviderLogo } from "../components/provider-logo";
import { AccessBadge } from "./automation-step-picker";
import { agentName } from "./schedule-calendar-core";
import { chiefToolLabel } from "./use-automation-catalogue";

interface Capability {
  key: string;
  icon: React.ReactNode;
  source: string;
  label: string;
  readOnly: boolean;
}

function capabilities(
  steps: readonly AutomationStep[],
  catalogue: AutomationCatalogue,
) {
  const seen = new Map<string, Capability>();
  for (const { step } of walkAutomation(steps)) {
    if (step.type !== "tool") continue;
    const tool = step.tool;
    if (tool.source === "plugin") {
      const plugin = catalogue.plugins.find(
        (item) => item.id === tool.connectionId,
      );
      const key = `plugin:${tool.connectionId}:${tool.name}`;
      seen.set(key, {
        key,
        icon: plugin?.domain ? (
          <ProviderLogo
            domain={plugin.domain}
            label={plugin.name}
            className="size-4 rounded"
          />
        ) : null,
        source: plugin?.name ?? tool.connectionId,
        label:
          plugin?.tools.find((item) => item.name === tool.name)?.title ??
          tool.name,
        readOnly: tool.readOnly,
      });
    } else {
      const chief = catalogue.chief.find((item) => item.name === tool.name);
      const key = `chief:${tool.name}`;
      seen.set(key, {
        key,
        icon: <ChiefMark className="size-3.5" />,
        source: "Chief",
        label: chief ? chiefToolLabel(chief) : tool.name,
        readOnly: chief?.readOnly ?? false,
      });
    }
  }
  return [...seen.values()].sort(
    (left, right) => Number(left.readOnly) - Number(right.readOnly),
  );
}

/**
 * Approval is the security boundary: it locks exactly these tools to this
 * version of the automation. So the person sees all of them, writes first.
 */
export function AutomationReviewDialog({
  open,
  title,
  timing,
  steps,
  team,
  catalogue,
  busy,
  onApprove,
  onClose,
}: {
  open: boolean;
  title: string;
  timing: string;
  steps: readonly AutomationStep[];
  team: string[];
  catalogue: AutomationCatalogue;
  busy: boolean;
  onApprove: () => void;
  onClose: () => void;
}) {
  const tools = capabilities(steps, catalogue);
  const agents = [
    ...new Set(
      [...walkAutomation(steps)].flatMap(({ step }) =>
        step.type === "agent" ? [step.agentId] : [],
      ),
    ),
  ];
  const people = steps.length ? agents : team;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="w-[calc(100%-32px)] max-w-[440px] gap-0 rounded-[18px] border-0 bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] p-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),0_16px_64px_-12px_rgb(0_0_0/0.45)] [&>button:last-child]:top-1.5 [&>button:last-child]:right-1.5">
        <DialogHeader className="flex h-8 justify-center px-3 text-left">
          <DialogTitle className="text-muted-foreground text-[12px] font-normal">
            Turn on automation
          </DialogTitle>
        </DialogHeader>
        <div className={cn(insetCardClass, "overflow-hidden px-0 py-0")}>
          <div className="px-4 pt-3.5 pb-3">
            <p className="text-[15px] leading-5 font-medium">{title}</p>
            <DialogDescription className="mt-0.5 text-xs">
              {timing}
            </DialogDescription>
          </div>
          <ul className="max-h-[50vh] divide-y divide-black/[0.055] overflow-y-auto border-t border-black/[0.055] dark:divide-white/[0.06] dark:border-white/[0.06]">
            {tools.map((tool) => (
              <li
                key={tool.key}
                className="flex items-center gap-2.5 px-4 py-2.5"
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {tool.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">
                    {tool.label}
                  </span>
                  <span className="text-muted-foreground block truncate text-[11px]">
                    {tool.source}
                  </span>
                </span>
                <AccessBadge readOnly={tool.readOnly} />
              </li>
            ))}
            {people.map((id) => (
              <li key={id} className="flex items-center gap-2.5 px-4 py-2.5">
                <AgentAvatar
                  agentId={id}
                  label={agentName(id)}
                  className="size-5 rounded-[6px]"
                />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {agentName(id)}
                </span>
                <span className="text-muted-foreground text-[11px]">Agent</span>
              </li>
            ))}
          </ul>
          <DialogFooter className="border-t border-black/[0.055] px-3 py-2.5 dark:border-white/[0.06]">
            <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
              Not yet
            </Button>
            <Button size="sm" disabled={busy} onClick={onApprove}>
              {busy ? "Turning on…" : "Turn on"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
