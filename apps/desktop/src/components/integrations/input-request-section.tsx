import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Check, CircleAlert } from "lucide-react";
import { useNavigate } from "react-router";

import type { InputRequest } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

/** Renders **bold** spans from agent-authored step text: the exact things
 * the user clicks or types read in the foreground color, everything else
 * stays muted. */
function inline(text: string, muted = false) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    index % 2 === 1 ? (
      <span
        key={index}
        className={cn(!muted && "text-foreground", "font-medium")}
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * A standalone section (not nested inside the chat) for an agent's input
 * request: plain numbered steps and paste fields. Callers may route web links
 * into Chief's embedded browser. Values are stored locally by the runtime;
 * they never enter the agent transcript.
 */
export function InputRequestSection({
  request,
  onSubmit,
  embedded = false,
  progressive = false,
  onOpenUrl,
}: {
  request: InputRequest;
  onSubmit: (
    request: InputRequest,
    values: Record<string, string>,
    answers: Record<string, string>,
  ) => void | Promise<void>;
  embedded?: boolean;
  progressive?: boolean;
  onOpenUrl?: (url: string) => void;
}) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const savesWorkspaceContext = request.fields.some(
    (field) => "contextKey" in field.save,
  );

  const activeStep =
    request.steps?.findIndex((_, index) => !completedSteps.has(index)) ?? -1;
  const activeRequestStep =
    activeStep >= 0 ? request.steps?.[activeStep] : undefined;
  const ready =
    (!progressive || !request.steps?.length || activeStep === -1) &&
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
    <div
      className={cn(
        progressive
          ? "bg-muted/20 rounded-xl px-4 py-3.5"
          : "bg-card border p-5",
      )}
    >
      <p
        className={cn(
          "text-xs",
          progressive ? "text-muted-foreground" : "text-blue-400",
        )}
      >
        {progressive ? null : (
          <CircleAlert size={13} className="mr-1.5 inline-block align-[-2px]" />
        )}
        {progressive
          ? "One quick thing"
          : savesWorkspaceContext
            ? "Your agent needs an answer to continue"
            : "Setup needs your input to continue"}
      </p>
      {!embedded ? (
        <>
          <p className="mt-3 text-xl font-normal">{request.title}</p>
          {request.reason ? (
            <p className="text-muted-foreground mt-1.5 max-w-xl text-sm leading-6">
              {request.reason}
            </p>
          ) : null}
        </>
      ) : null}

      {progressive && request.steps?.length ? (
        <div className="mt-3 border-t pt-3">
          {activeRequestStep ? (
            <div className="flex items-start gap-3">
              <span className="text-muted-foreground pt-0.5 text-[10px] tabular-nums">
                {activeStep + 1}/{request.steps.length}
              </span>
              <p className="min-w-0 flex-1 text-sm leading-5">
                {inline(activeRequestStep.text)}
                {activeRequestStep.url ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeRequestStep.url?.startsWith("/")) {
                        void navigate(activeRequestStep.url);
                      } else if (activeRequestStep.url) {
                        if (onOpenUrl) onOpenUrl(activeRequestStep.url);
                        else void openUrl(activeRequestStep.url);
                      }
                    }}
                    className="text-foreground ml-2 inline-flex items-center gap-0.5 underline underline-offset-2"
                  >
                    Open
                    <ArrowUpRight size={12} />
                  </button>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() =>
                  setCompletedSteps((current) =>
                    new Set(current).add(activeStep),
                  )
                }
                className="text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <Check className="text-emerald-500" size={14} />
              You’re ready to continue.
            </p>
          )}
        </div>
      ) : request.steps?.length ? (
        <ol className="mt-4 space-y-2.5 border-t pt-4">
          {request.steps.map((step, index) => {
            return (
              <li
                key={index}
                className="text-muted-foreground flex gap-3 text-sm leading-6"
              >
                <span className="text-muted-foreground shrink-0 text-xs">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  {inline(step.text)}
                  {step.url ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (step.url?.startsWith("/")) {
                          void navigate(step.url);
                        } else if (step.url) {
                          if (onOpenUrl) onOpenUrl(step.url);
                          else void openUrl(step.url);
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
            );
          })}
        </ol>
      ) : null}

      {request.questions?.length ? (
        <div
          className={cn(
            "mt-4 space-y-4 border-t pt-4",
            progressive && "max-h-48 overflow-y-auto pr-1",
          )}
        >
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
        <div
          className={cn(
            "mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2",
            progressive && "mt-3 pt-3",
          )}
        >
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
            (progressive
              ? "Your details stay private."
              : savesWorkspaceContext
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
