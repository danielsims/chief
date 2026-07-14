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
        "mx-auto max-w-3xl text-sm leading-7",
        compact ? "space-y-6 p-5" : "space-y-8 p-8",
      )}
    >
      <p className="border-foreground/70 text-foreground border-l-2 pl-4 text-base leading-7">
        {playbook.goal}
      </p>
      <section>
        <h4 className="font-serif text-xl">What it needs</h4>
        <ul className="text-muted-foreground mt-3 space-y-2">
          {playbook.inputs.map((input) => (
            <li key={input} className="flex gap-3">
              <span className="bg-muted-foreground mt-3 size-1 shrink-0" />
              <span>{input}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="border-t pt-6">
        <h4 className="font-serif text-xl">How it works</h4>
        <ol className="mt-4 space-y-4">
          {playbook.workflow.map((step, index) => (
            <li
              key={step}
              className="grid grid-cols-[24px_minmax(0,1fr)] gap-3"
            >
              <span className="text-muted-foreground text-xs">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="border-t pt-6">
        <h4 className="font-serif text-xl">What you get</h4>
        <ul className="text-muted-foreground mt-3 space-y-2">
          {playbook.deliverables.map((deliverable) => (
            <li key={deliverable} className="flex gap-3">
              <span className="bg-foreground mt-3 size-1 shrink-0" />
              <span>{deliverable}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="border-t pt-6">
        <h4 className="font-serif text-xl">Access and limits</h4>
        <div className="text-muted-foreground mt-3 space-y-3">
          {playbook.accessNotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      </section>
      <section className="border-t pt-6">
        <h4 className="font-serif text-xl">Guardrails</h4>
        <ul className="text-muted-foreground mt-3 space-y-2">
          {playbook.guardrails.map((guardrail) => (
            <li key={guardrail} className="flex gap-3">
              <span className="border-muted-foreground mt-3 size-1 shrink-0 border" />
              <span>{guardrail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
