import { cn } from "@chief/ui/lib/utils";

import type { Playbook } from "../../lib/playbooks";

export function PlaybookDocument({
  playbook,
  compact = false,
}: {
  playbook: Playbook;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto max-w-[820px] text-[13px] leading-6",
        compact ? "space-y-6 p-5" : "space-y-7 px-8 py-9 lg:px-10",
      )}
    >
      <p className="text-foreground max-w-3xl text-[15px] leading-7 font-medium tracking-[-0.012em]">
        {playbook.goal}
      </p>
      <section className="border-t border-black/[0.06] pt-6 dark:border-white/[0.07]">
        <h4 className="text-[15px] font-medium tracking-[-0.02em]">
          What it needs
        </h4>
        <ul className="text-muted-foreground mt-3.5 space-y-2.5">
          {playbook.inputs.map((input) => (
            <li key={input} className="flex gap-3.5">
              <span className="bg-muted-foreground/70 mt-[11px] size-1 shrink-0 rounded-full" />
              <span>{input}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="border-t border-black/[0.06] pt-6 dark:border-white/[0.07]">
        <h4 className="text-[15px] font-medium tracking-[-0.02em]">
          How it works
        </h4>
        <ol className="mt-4 space-y-4.5">
          {playbook.workflow.map((step, index) => (
            <li
              key={step}
              className="grid grid-cols-[28px_minmax(0,1fr)] gap-3.5"
            >
              <span className="text-muted-foreground pt-px text-[10px] font-medium tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-foreground/90">{step}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="border-t border-black/[0.06] pt-6 dark:border-white/[0.07]">
        <h4 className="text-[15px] font-medium tracking-[-0.02em]">
          What you get
        </h4>
        <ul className="text-muted-foreground mt-3.5 space-y-2.5">
          {playbook.deliverables.map((deliverable) => (
            <li key={deliverable} className="flex gap-3.5">
              <span className="bg-foreground mt-[11px] size-1 shrink-0 rounded-full" />
              <span>{deliverable}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="border-t border-black/[0.06] pt-6 dark:border-white/[0.07]">
        <h4 className="text-[15px] font-medium tracking-[-0.02em]">
          Access and limits
        </h4>
        <div className="text-muted-foreground mt-3.5 max-w-3xl space-y-3">
          {playbook.accessNotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      </section>
      <section className="border-t border-black/[0.06] pt-6 dark:border-white/[0.07]">
        <h4 className="text-[15px] font-medium tracking-[-0.02em]">
          Guardrails
        </h4>
        <ul className="text-muted-foreground mt-3.5 space-y-2.5">
          {playbook.guardrails.map((guardrail) => (
            <li key={guardrail} className="flex gap-3.5">
              <span className="border-muted-foreground/70 mt-[10px] size-1.5 shrink-0 rounded-full border" />
              <span>{guardrail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
