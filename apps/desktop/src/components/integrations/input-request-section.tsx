import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import { useNavigate } from "react-router";

import type {
  ActionResolution,
  InputRequest,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

import { UserAvatar } from "../user-avatar";
import {
  freeTextAnswersAreReady,
  initialFreeTextAnswerState,
  InputRequestQuestions,
} from "./input-request-questions";

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
  compactDecision = false,
  compactDecisionAgentName,
  compactDecisionHideQuestionLabels = false,
  compactDecisionResolution,
  compactDecisionCurrentUser,
  compactDecisionSecondaryAction,
  compactDecisionSurface = "thread",
  onOpenUrl,
}: {
  request: InputRequest;
  onSubmit: (
    request: InputRequest,
    values: Record<string, string>,
    answers: Record<string, string>,
  ) => void | Promise<void>;
  embedded?: boolean;
  compactDecision?: boolean;
  compactDecisionAgentName?: string;
  compactDecisionHideQuestionLabels?: boolean;
  compactDecisionResolution?: ActionResolution;
  compactDecisionCurrentUser?: { id: string; image?: string } | null;
  compactDecisionSecondaryAction?: {
    label: string;
    onClick: () => void;
  };
  compactDecisionSurface?: "overview" | "thread";
  onOpenUrl?: (url: string) => void;
}) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>(
    compactDecisionResolution?.answers ?? {},
  );
  const [freeTextState, setFreeTextState] = useState(() =>
    initialFreeTextAnswerState(request, compactDecisionResolution),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const savesWorkspaceContext = request.fields.some(
    (field) => "contextKey" in field.save,
  );

  const ready =
    request.fields.every((field) => Boolean(values[field.key] ?? "")) &&
    (request.questions ?? []).every((question) =>
      Boolean((answers[question.question] ?? "").trim()),
    ) &&
    freeTextAnswersAreReady(request.questions ?? [], freeTextState);

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
        compactDecision ? "w-full" : "bg-card border p-5",
        compactDecision &&
          compactDecisionSurface === "overview" &&
          "flex min-h-0 flex-1 flex-col",
      )}
    >
      {!compactDecision ? (
        <p className="text-xs text-blue-400">
          <CircleAlert size={13} className="mr-1.5 inline-block align-[-2px]" />
          {savesWorkspaceContext
            ? "Your agent needs an answer to continue"
            : "Setup needs your input to continue"}
        </p>
      ) : null}
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

      {!compactDecision && request.steps?.length ? (
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
        <InputRequestQuestions
          questions={request.questions}
          answers={answers}
          setAnswers={setAnswers}
          freeTextState={freeTextState}
          setFreeTextState={setFreeTextState}
          compactDecision={compactDecision}
          compactDecisionAgentName={compactDecisionAgentName}
          compactDecisionHideQuestionLabels={compactDecisionHideQuestionLabels}
          compactDecisionResolution={compactDecisionResolution}
          compactDecisionSurface={compactDecisionSurface}
        />
      ) : null}

      {request.fields.length > 0 ? (
        <div className={cn("mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2")}>
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
      {compactDecisionResolution ? (
        <div className="text-muted-foreground mt-3 flex items-center gap-2 text-[11px] leading-4">
          <UserAvatar
            image={
              compactDecisionResolution.resolvedBy.id ===
              compactDecisionCurrentUser?.id
                ? compactDecisionCurrentUser.image
                : undefined
            }
            name={compactDecisionResolution.resolvedBy.name}
            className="size-5 rounded-md"
          />
          <span>
            <span className="text-foreground/80">
              {compactDecisionResolution.resolvedBy.name}
            </span>{" "}
            selected{" "}
            <span className="text-foreground/80">
              {Object.values(compactDecisionResolution.answers)
                .flatMap((answer) => answer.split("\n"))
                .filter(Boolean)
                .join(", ")}
            </span>
          </span>
        </div>
      ) : (
        <div
          className={cn(
            "mt-3 flex items-center justify-between gap-3",
            compactDecision && "justify-end",
            compactDecision &&
              compactDecisionSurface === "overview" &&
              "absolute right-7 bottom-7 z-10 mt-0",
          )}
        >
          {!compactDecision ? (
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
          ) : null}
          {compactDecision && compactDecisionSecondaryAction ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={compactDecisionSecondaryAction.onClick}
            >
              {compactDecisionSecondaryAction.label}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!ready || submitting}
            onClick={() => void submit()}
          >
            {submitting
              ? "Saving…"
              : compactDecision
                ? "Continue"
                : "Save and continue"}
          </Button>
        </div>
      )}
    </div>
  );
}
