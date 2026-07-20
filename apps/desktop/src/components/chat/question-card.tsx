import { useState } from "react";

import type { AgentQuestion } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

import type { PendingQuestion } from "../../lib/runtime";

const OTHER = "__other__";

interface QuestionAnswerState {
  selected: Set<string>;
  other: string;
}

function answerText(
  question: AgentQuestion,
  state: QuestionAnswerState,
): string {
  const labels = question.options
    .map((option) => option.label)
    .filter((label) => state.selected.has(label));
  if (state.selected.has(OTHER) && state.other.trim()) {
    labels.push(state.other.trim());
  }
  return labels.join(", ");
}

function QuestionBlock({
  question,
  state,
  onChange,
}: {
  question: AgentQuestion;
  state: QuestionAnswerState;
  onChange: (state: QuestionAnswerState) => void;
}) {
  const toggle = (label: string) => {
    const selected = new Set(state.selected);
    if (selected.has(label)) {
      selected.delete(label);
    } else {
      if (!question.multiSelect) selected.clear();
      selected.add(label);
    }
    onChange({ ...state, selected });
  };

  return (
    <div className="space-y-2.5">
      <div>
        {question.header ? (
          <p className="text-muted-foreground text-xs">{question.header}</p>
        ) : null}
        <p className="mt-0.5 text-sm font-medium">{question.question}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {question.options.map((option) => {
          const active = state.selected.has(option.label);
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => toggle(option.label)}
              className={cn(
                "hover:bg-accent border px-3 py-2 text-left transition-colors",
                active && "border-foreground/40 bg-accent",
              )}
            >
              <span className="block text-sm">{option.label}</span>
              {option.description ? (
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  {option.description}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {question.allowFreeform !== false ? (
        <Input
          value={state.other}
          placeholder={question.options.length ? "Other…" : "Your answer"}
          onFocus={() => {
            if (!state.selected.has(OTHER)) {
              const selected = new Set(state.selected);
              if (!question.multiSelect) selected.clear();
              selected.add(OTHER);
              onChange({ ...state, selected });
            }
          }}
          onChange={(e) => {
            const selected = new Set(state.selected);
            if (e.target.value) {
              if (!question.multiSelect) selected.clear();
              selected.add(OTHER);
            } else {
              selected.delete(OTHER);
            }
            onChange({ selected, other: e.target.value });
          }}
          className={cn(
            "h-9 text-sm",
            state.selected.has(OTHER) && "border-foreground/40",
          )}
        />
      ) : null}
    </div>
  );
}

/** The agent asked structured questions; answers return to the model. */
export function QuestionCard({
  pending,
  onSubmit,
  onDismiss,
}: {
  pending: PendingQuestion;
  onSubmit: (answers: Record<string, string>) => void;
  onDismiss: () => void;
}) {
  const [states, setStates] = useState<QuestionAnswerState[]>(() =>
    pending.questions.map(() => ({ selected: new Set<string>(), other: "" })),
  );
  const answers = pending.questions.map((question, index) =>
    answerText(question, states[index]!),
  );
  const complete = answers.every((answer) => answer.length > 0);

  return (
    <div className="bg-card space-y-5 border p-5">
      {pending.questions.map((question, index) => (
        <QuestionBlock
          key={`${pending.requestId}-${index}`}
          question={question}
          state={states[index]!}
          onChange={(next) =>
            setStates((current) =>
              current.map((state, i) => (i === index ? next : state)),
            )
          }
        />
      ))}
      <div className="flex items-center justify-between border-t pt-3">
        {pending.questions.every(
          (question) => question.dismissible !== false,
        ) ? (
          <button
            type="button"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            Skip these questions
          </button>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          disabled={!complete}
          onClick={() =>
            onSubmit(
              Object.fromEntries(
                pending.questions.map((question, index) => [
                  question.question,
                  answers[index]!,
                ]),
              ),
            )
          }
        >
          Send answers
        </Button>
      </div>
    </div>
  );
}
