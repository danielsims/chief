import { useState } from "react";
import { Check } from "lucide-react";

import type { GenerativeQuestionData } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { useQuestionAnswers } from "./question-answers-context";

export function QuestionCard({
  question,
}: {
  question: GenerativeQuestionData;
}) {
  const answers = useQuestionAnswers();
  const [picked, setPicked] = useState<string | null>(null);
  const answered = picked ?? answers?.answerFor(question) ?? null;
  return (
    <div className="flex max-w-md min-w-0 flex-col gap-1.5">
      {question.options.map((option) => {
        const chosen = answered === option;
        return (
          <button
            key={option}
            type="button"
            disabled={answered !== null || !answers}
            onClick={() => {
              setPicked(option);
              answers?.answer(question, option);
            }}
            className={cn(
              "bg-card/60 flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm shadow-sm transition-colors",
              answered === null
                ? "hover:bg-muted/60 cursor-pointer"
                : chosen
                  ? "border-foreground/30"
                  : "opacity-50",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{option}</span>
            {chosen ? <Check size={14} className="text-emerald-500" /> : null}
          </button>
        );
      })}
    </div>
  );
}
