import { useState } from "react";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { InputRequest } from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import { Input } from "@marketer/ui/components/input";
import { cn } from "@marketer/ui/lib/utils";

/** Renders **bold** spans from agent-authored step text: the exact things
 * the user clicks or types read in the foreground color, everything else
 * stays muted. */
function inline(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="font-medium text-foreground">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * A standalone section (not nested inside the chat) for an agent's input
 * request: plain numbered steps that open in the user's own browser (their
 * password manager and sessions work there), then the paste fields. Values
 * are stored locally by the runtime; they never enter the agent transcript.
 */
export function InputRequestSection({
  request,
  onSubmit,
}: {
  request: InputRequest;
  onSubmit: (request: InputRequest, values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const ready = request.fields.every((field) =>
    (values[field.key] ?? "").trim(),
  );

  const submit = () => {
    if (!ready) return;
    const trimmed: Record<string, string> = {};
    for (const field of request.fields) {
      trimmed[field.key] = (values[field.key] ?? "").trim();
    }
    onSubmit(request, trimmed);
  };

  return (
    // Setup is paused on this; the label carries the urgency, the card stays
    // neutral.
    <div className="border bg-card p-5">
      <p className="text-xs text-blue-400">
        <CircleAlert size={13} className="mr-1.5 inline-block align-[-2px]" />
        Setup is paused until you finish this
      </p>
      <p className="mt-3 font-serif text-xl">{request.title}</p>
      {request.reason ? (
        <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
          {request.reason}
        </p>
      ) : null}

      {request.steps?.length ? (
        <ol className="mt-4 space-y-2.5 border-t pt-4">
          {request.steps.map((step, index) => (
            <li
              key={index}
              className="flex items-baseline gap-3 text-sm leading-6"
            >
              <span className="shrink-0 text-xs text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 text-muted-foreground">
                {inline(step.text)}
                {step.url ? (
                  <button
                    type="button"
                    onClick={() => void openUrl(step.url!)}
                    className="ml-2 inline-flex cursor-pointer items-center gap-0.5 text-foreground underline underline-offset-2"
                  >
                    Open
                    <ArrowUpRight size={12} />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {request.fields.map((field) => (
          <label
            key={field.key}
            className={cn(
              "space-y-1.5",
              field.type === "multiline" && "sm:col-span-2",
            )}
          >
            <span className="text-xs text-muted-foreground">{field.label}</span>
            {field.type === "multiline" ? (
              <textarea
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((v) => ({ ...v, [field.key]: event.target.value }))
                }
                rows={3}
                className="w-full resize-none border bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none placeholder:text-muted-foreground"
              />
            ) : (
              <Input
                type={field.type === "secret" ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((v) => ({ ...v, [field.key]: event.target.value }))
                }
                autoComplete="off"
              />
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Stored on this Mac only.</p>
        <Button type="button" size="sm" disabled={!ready} onClick={submit}>
          Save and continue
        </Button>
      </div>
    </div>
  );
}
