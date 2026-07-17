import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, CircleAlert } from "lucide-react";

import type { InputRequest } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

/** Renders **bold** spans from agent-authored step text: the exact things
 * the user clicks or types read in the foreground color, everything else
 * stays muted. */
function inline(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="text-foreground font-medium">
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
  const savesWorkspaceContext = request.fields.some(
    (field) => "contextKey" in field.save,
  );

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
    <div className="bg-card border p-5">
      <p className="text-xs text-blue-400">
        <CircleAlert size={13} className="mr-1.5 inline-block align-[-2px]" />
        {savesWorkspaceContext
          ? "Your agent needs an answer to continue"
          : "Setup needs your input to continue"}
      </p>
      <p className="mt-3 font-serif text-xl">{request.title}</p>
      {request.reason ? (
        <p className="text-muted-foreground mt-1.5 max-w-xl text-sm leading-6">
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
              <span className="text-muted-foreground shrink-0 text-xs">
                {index + 1}
              </span>
              <span className="text-muted-foreground min-w-0">
                {inline(step.text)}
                {step.url ? (
                  <button
                    type="button"
                    onClick={() => void openUrl(step.url!)}
                    className="text-foreground ml-2 inline-flex cursor-pointer items-center gap-0.5 underline underline-offset-2"
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
            <span className="text-muted-foreground text-xs">{field.label}</span>
            {field.type === "multiline" ? (
              <textarea
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((v) => ({ ...v, [field.key]: event.target.value }))
                }
                rows={3}
                className="placeholder:text-muted-foreground w-full resize-none border bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none"
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
        <p className="text-muted-foreground text-xs">
          {savesWorkspaceContext
            ? "Saved to this workspace."
            : "Stored on this Mac only."}
        </p>
        <Button type="button" size="sm" disabled={!ready} onClick={submit}>
          Save and continue
        </Button>
      </div>
    </div>
  );
}
