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

import type { AutomationCatalogue } from "./use-automation-catalogue";
import { AgentAvatar } from "../components/agent-avatar";
import { ChiefMark } from "../components/chief-mark";
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
      <DialogContent className="w-[calc(100%-32px)] max-w-[460px] gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="space-y-1 px-6 pt-6 pb-4 text-left">
          <DialogTitle className="text-[17px] font-medium tracking-tight">
            Turn on {title}?
          </DialogTitle>
          <DialogDescription className="text-xs">{timing}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-6 pb-5">
          {tools.length ? (
            <section>
              <p className="text-muted-foreground mb-2 text-[11px] font-medium">
                It will use
              </p>
              <ul className="divide-y divide-black/[0.055] rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] dark:divide-white/[0.06]">
                {tools.map((tool) => (
                  <li
                    key={tool.key}
                    className="flex items-center gap-2.5 px-3 py-2.5"
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
              </ul>
            </section>
          ) : null}
          {people.length ? (
            <section>
              <p className="text-muted-foreground mb-2 text-[11px] font-medium">
                {steps.length ? "Agents taking steps" : "Team"}
              </p>
              <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
                {people.map((id) => (
                  <li key={id} className="flex items-center gap-2">
                    <AgentAvatar
                      agentId={id}
                      label={agentName(id)}
                      className="size-5 rounded-[6px]"
                    />
                    {agentName(id)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-muted-foreground text-[12px] leading-5">
            Only these steps can run. Any change to them comes back to you.
          </p>
        </div>
        <DialogFooter className="border-t border-black/[0.055] px-6 py-3 dark:border-white/[0.06]">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Not yet
          </Button>
          <Button disabled={busy} onClick={onApprove}>
            {busy ? "Turning on…" : "Approve and turn on"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
