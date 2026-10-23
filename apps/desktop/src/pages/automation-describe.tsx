import { useState } from "react";
import { ArrowUp } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

/** Say what should happen and Chief builds or changes the steps. */
export function AutomationComposer({
  busy,
  disabled,
  className,
  onSubmit,
}: {
  busy: boolean;
  disabled: boolean;
  className?: string;
  /** Resolves false when the build failed, so the request comes back to edit. */
  onSubmit: (description: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    setValue("");
    void onSubmit(text).then((built) => {
      if (!built) setValue((current) => current || text);
    });
  };
  return (
    <div className={cn("w-[560px] max-w-[calc(100%-32px)]", className)}>
      <div
        className={cn(
          "bg-card/80 flex items-end gap-2 rounded-xl border p-2 pl-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] backdrop-blur-lg",
          busy && "opacity-80",
        )}
      >
        <textarea
          rows={1}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Describe what this automation should do"
          className="placeholder:text-muted-foreground/70 field-sizing-content max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-[13px] leading-5 outline-none"
        />
        <Button
          size="icon-xs"
          aria-label="Build the steps"
          disabled={!value.trim() || busy || disabled}
          onClick={submit}
        >
          <ArrowUp size={14} />
        </Button>
      </div>
    </div>
  );
}
