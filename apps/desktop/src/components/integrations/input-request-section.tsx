import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import { useNavigate } from "react-router";

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
  embedded = false,
}: {
  request: InputRequest;
  onSubmit: (
    request: InputRequest,
    values: Record<string, string>,
    answers: Record<string, string>,
  ) => void | Promise<void>;
  embedded?: boolean;
}) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const savesWorkspaceContext = request.fields.some(
    (field) => "contextKey" in field.save,
  );

  const ready =
    request.fields.every((field) => Boolean(values[field.key] ?? "")) &&
    (request.questions ?? []).every((question) =>
      Boolean((answers[question.question] ?? "").trim()),
    );

  const submit = async () => {
    if (!ready || submitting) return;
    const trimmed: Record<string, string> = {};
    for (const field of request.fields) {
      const current = values[field.key] ?? "";
      trimmed[field.key] = field.type === "secret" ? current : current.trim();
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(request, trimmed, answers);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
    }
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
      {!embedded ? (
        <>
          <p className="mt-3 font-serif text-xl">{request.title}</p>
          {request.reason ? (
            <p className="text-muted-foreground mt-1.5 max-w-xl text-sm leading-6">
              {request.reason}
            </p>
          ) : null}
        </>
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
                    onClick={() => {
                      if (step.url?.startsWith("/")) {
                        void navigate(step.url);
                      } else if (step.url) {
                        void openUrl(step.url);
                      }
                    }}
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

      {request.questions?.length ? (
        <div className="mt-4 space-y-4 border-t pt-4">
          {request.questions.map((question) => {
            const selected = new Set(
              (answers[question.question] ?? "").split("\n").filter(Boolean),
            );
            return (
              <fieldset key={question.question} className="space-y-2">
                {question.header ? (
                  <legend className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                    {question.header}
                  </legend>
                ) : null}
                <p className="text-sm font-medium">{question.question}</p>
                {question.options.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {question.options.map((option) => {
                      const active = selected.has(option.label);
                      return (
                        <button
                          key={option.label}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            if (!question.multiSelect) {
                              setAnswers((current) => ({
                                ...current,
                                [question.question]: option.label,
                              }));
                              return;
                            }
                            const next = new Set(selected);
                            if (active) next.delete(option.label);
                            else next.add(option.label);
                            setAnswers((current) => ({
                              ...current,
                              [question.question]: [...next].join("\n"),
                            }));
                          }}
                          className={cn(
                            "border px-3 py-2 text-left text-xs transition-colors",
                            active
                              ? "text-foreground border-blue-500/60 bg-blue-500/10"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <strong className="block font-medium">
                            {option.label}
                          </strong>
                          {option.description ? (
                            <span className="mt-0.5 block opacity-70">
                              {option.description}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    value={answers[question.question] ?? ""}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.question]: event.target.value,
                      }))
                    }
                    rows={3}
                    className="placeholder:text-muted-foreground w-full resize-none border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                  />
                )}
              </fieldset>
            );
          })}
        </div>
      ) : null}

      {request.fields.length > 0 ? (
        <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
          {request.fields.map((field) => (
            <label
              key={field.key}
              className={cn(
                "space-y-1.5",
                field.type === "multiline" && "sm:col-span-2",
              )}
            >
              <span className="text-muted-foreground text-xs">
                {field.label}
              </span>
              {field.type === "multiline" ? (
                <textarea
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((v) => ({
                      ...v,
                      [field.key]: event.target.value,
                    }))
                  }
                  rows={3}
                  className="placeholder:text-muted-foreground w-full resize-none border bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none"
                />
              ) : (
                <Input
                  type={field.type === "secret" ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((v) => ({
                      ...v,
                      [field.key]: event.target.value,
                    }))
                  }
                  autoComplete="off"
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p
          className={cn(
            "text-muted-foreground text-xs",
            submitError && "text-destructive",
          )}
        >
          {submitError ??
            (savesWorkspaceContext
              ? "Saved to this workspace."
              : "Stored on this Mac only.")}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={!ready || submitting}
          onClick={() => void submit()}
        >
          {submitting ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </div>
  );
}
