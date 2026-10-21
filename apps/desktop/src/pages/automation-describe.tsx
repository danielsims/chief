import { useState } from "react";
import { ArrowUp } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

/** Floats over the canvas: say what should happen and Chief builds or changes the steps. */
export function AutomationComposer({
  busy,
  note,
  disabled,
  onSubmit,
}: {
  busy: boolean;
  /** What Chief said about the last build. */
  note: string | null;
  disabled: boolean;
  onSubmit: (description: string) => void;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSubmit(text);
    setValue("");
  };
  return (
    <div className="w-[520px] max-w-[calc(100%-32px)]">
      {busy ? (
        <p
          role="status"
          className="text-muted-foreground mb-2 flex items-center justify-center gap-1.5 text-[12px]"
        >
          <MatrixLoader size={12} ariaLabel="Chief is building" />
          Chief is building…
        </p>
      ) : note ? (
        <p
          role="status"
          className="text-muted-foreground mb-2 line-clamp-3 w-full px-1 text-center text-[12px]"
        >
          {note}
        </p>
      ) : null}
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
