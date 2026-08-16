import type { Dispatch, SetStateAction } from "react";
import { Check } from "lucide-react";

import type {
  ActionResolution,
  AgentQuestion,
  InputRequest,
} from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { AgentAvatar } from "../agent-avatar";

export interface FreeTextAnswerState {
  selections: Record<string, string>;
  values: Record<string, string>;
}

function presentedQuestionOptions(question: AgentQuestion) {
  const lastOption = question.options.at(-1);
  const options = question.options.map((option) =>
    option === lastOption &&
    option.label.trim().toLocaleLowerCase() === "other" &&
    option.allowsFreeText === undefined
      ? { ...option, allowsFreeText: true }
      : option,
  );
  const standard = options.filter((option) => !option.allowsFreeText);
  const freeText = options.filter((option) => option.allowsFreeText);
  if (freeText.length === 0 && question.allowFreeform) {
    freeText.push({ label: "Other", allowsFreeText: true });
  }
  return [...standard, ...freeText];
}

function freeTextAnswer(question: AgentQuestion, answer: string | undefined) {
  const standardLabels = new Set(
    presentedQuestionOptions(question)
      .filter((option) => !option.allowsFreeText)
      .map((option) => option.label),
  );
  return (
    answer
      ?.split("\n")
      .find((part) => part.trim() && !standardLabels.has(part)) ?? ""
  );
}

export function initialFreeTextAnswerState(
  request: InputRequest,
  resolution: ActionResolution | undefined,
): FreeTextAnswerState {
  const selections: Record<string, string> = {};
  const values: Record<string, string> = {};
  for (const question of request.questions ?? []) {
    const answer = freeTextAnswer(
      question,
      resolution?.answers[question.question],
    );
    const option = presentedQuestionOptions(question).find(
      (candidate) => candidate.allowsFreeText,
    );
    if (answer && option) {
      selections[question.question] = option.label;
      values[question.question] = answer;
    }
  }
  return { selections, values };
}

export function freeTextAnswersAreReady(
  questions: readonly AgentQuestion[],
  state: FreeTextAnswerState,
) {
  return questions.every(
    (question) =>
      !state.selections[question.question] ||
      Boolean(state.values[question.question]?.trim()),
  );
}

export function InputRequestQuestions({
  questions,
  answers,
  setAnswers,
  freeTextState,
  setFreeTextState,
  compactDecision,
  compactDecisionAgentName,
  compactDecisionHideQuestionLabels,
  compactDecisionResolution,
  compactDecisionSurface,
}: {
  questions: AgentQuestion[];
  answers: Record<string, string>;
  setAnswers: Dispatch<SetStateAction<Record<string, string>>>;
  freeTextState: FreeTextAnswerState;
  setFreeTextState: Dispatch<SetStateAction<FreeTextAnswerState>>;
  compactDecision: boolean;
  compactDecisionAgentName?: string;
  compactDecisionHideQuestionLabels: boolean;
  compactDecisionResolution?: ActionResolution;
  compactDecisionSurface: "overview" | "thread";
}) {
  return (
    <div
      className={cn(
        "mt-4 space-y-4 border-t pt-4",
        compactDecision && "mt-0 space-y-5 border-0 pt-0",
        compactDecision &&
          compactDecisionSurface === "overview" &&
          "min-h-0 flex-1 overflow-y-auto pr-1",
      )}
    >
      {questions.map((question) => {
        const options = presentedQuestionOptions(question);
        const freeTextOption = options.find((option) => option.allowsFreeText);
        const resolvedFreeText = freeTextAnswer(
          question,
          compactDecisionResolution?.answers[question.question],
        );
        const standardLabels = new Set(
          options
            .filter((option) => !option.allowsFreeText)
            .map((option) => option.label),
        );
        const selected = new Set(
          (
            (compactDecisionResolution?.answers ?? answers)[
              question.question
            ] ?? ""
          )
            .split("\n")
            .filter((answer) => standardLabels.has(answer)),
        );
        if (
          freeTextOption &&
          (freeTextState.selections[question.question] || resolvedFreeText)
        ) {
          selected.add(freeTextOption.label);
        }
        return (
          <fieldset key={question.question} className="space-y-2.5">
            {question.header && !compactDecision ? (
              <legend className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
                {question.header}
              </legend>
            ) : null}
            {!compactDecision ? (
              <p className="text-sm font-medium">{question.question}</p>
            ) : !compactDecisionHideQuestionLabels ? (
              <legend className="text-foreground text-[13px] leading-5 font-medium">
                {question.question}
              </legend>
            ) : null}
            {options.length > 0 ? (
              <div
                className={cn(
                  "grid gap-2",
                  !compactDecision && "sm:grid-cols-2",
                )}
              >
                {options.map((option) => {
                  const active = selected.has(option.label);
                  const freeText = option.allowsFreeText === true;
                  return (
                    <div key={option.label} className="grid gap-2">
                      <button
                        type="button"
                        aria-pressed={active}
                        disabled={Boolean(compactDecisionResolution)}
                        onClick={() => {
                          const next = new Set(selected);
                          if (!question.multiSelect) next.clear();
                          if (active && (freeText || question.multiSelect)) {
                            next.delete(option.label);
                          } else {
                            next.add(option.label);
                          }
                          setFreeTextState((current) => {
                            const selections = { ...current.selections };
                            if (freeText) {
                              if (active) delete selections[question.question];
                              else selections[question.question] = option.label;
                            } else if (!question.multiSelect) {
                              delete selections[question.question];
                            }
                            return { ...current, selections };
                          });
                          const answer = [...next].flatMap((label) => {
                            if (label !== freeTextOption?.label) return [label];
                            const custom =
                              freeTextState.values[question.question]?.trim();
                            return custom ? [custom] : [];
                          });
                          setAnswers((current) => ({
                            ...current,
                            [question.question]: answer.join("\n"),
                          }));
                        }}
                        className={cn(
                          "border px-3 py-2 text-left text-xs transition-colors",
                          compactDecision &&
                            "bg-foreground/[0.025] text-foreground border-foreground/12 flex w-full items-center rounded-lg px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] disabled:cursor-default",
                          compactDecision &&
                            compactDecisionSurface === "thread" &&
                            "py-2.5",
                          active
                            ? "text-foreground border-emerald-400/45 bg-emerald-500/10 hover:border-emerald-400/60 hover:bg-emerald-500/15"
                            : compactDecision
                              ? "hover:bg-foreground/[0.055] hover:border-foreground/20"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        {compactDecisionAgentName ? (
                          <AgentAvatar
                            label={compactDecisionAgentName}
                            className="mr-3 size-5 rounded-md"
                            markClassName="size-2.5"
                          />
                        ) : null}
                        <strong
                          className={cn(
                            "block flex-1 leading-5 font-medium",
                            compactDecisionSurface === "overview"
                              ? "text-[13.5px]"
                              : "text-[12.5px]",
                          )}
                        >
                          {option.label}
                        </strong>
                        {compactDecision ? (
                          <Check
                            size={13}
                            className={cn(
                              "ml-3 shrink-0 transition-opacity",
                              active ? "opacity-100" : "opacity-0",
                            )}
                          />
                        ) : null}
                        {option.description && !compactDecision ? (
                          <span className="mt-0.5 block opacity-70">
                            {option.description}
                          </span>
                        ) : null}
                      </button>
                      {freeText && active ? (
                        <textarea
                          aria-label={`Other answer for ${question.question}`}
                          disabled={Boolean(compactDecisionResolution)}
                          value={
                            compactDecisionResolution
                              ? resolvedFreeText
                              : (freeTextState.values[question.question] ?? "")
                          }
                          onChange={(event) => {
                            const custom = event.target.value;
                            setFreeTextState((current) => ({
                              ...current,
                              values: {
                                ...current.values,
                                [question.question]: custom,
                              },
                            }));
                            const standard = [...selected].filter(
                              (label) => label !== freeTextOption?.label,
                            );
                            setAnswers((current) => ({
                              ...current,
                              [question.question]: [
                                ...standard,
                                ...(custom.trim() ? [custom.trim()] : []),
                              ].join("\n"),
                            }));
                          }}
                          placeholder="Type your answer…"
                          rows={2}
                          className="border-foreground/15 placeholder:text-muted-foreground w-full resize-none rounded-lg border bg-transparent px-3.5 py-2.5 text-[13px] leading-5 outline-none focus:border-emerald-400/45 disabled:cursor-default disabled:opacity-80"
                        />
                      ) : null}
                    </div>
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
  );
}
