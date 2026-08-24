import type { ComponentProps, ReactNode, RefObject } from "react";

import type { OnboardingDraft } from "../lib/onboarding-draft";
import type { StepKey } from "./onboarding-options";
import { steps } from "./onboarding-options";
import {
  AgentBubble,
  AnswerPreview,
  EditableAnswer,
  questionText,
  UserIndicator,
} from "./onboarding-presentation";

interface OnboardingConversationProps {
  control: ReactNode;
  currentIndex: number;
  currentQuestionRef: RefObject<HTMLDivElement | null>;
  draft: OnboardingDraft;
  editingStep: StepKey | null;
  error: string | null;
  notice: string | null;
  onCancelEditing: () => void;
  onEdit: (step: StepKey) => void;
  onSignOut: () => void;
  step: StepKey;
  user: ComponentProps<typeof UserIndicator>["user"];
}

export function OnboardingConversation({
  control,
  currentIndex,
  currentQuestionRef,
  draft,
  editingStep,
  error,
  notice,
  onCancelEditing,
  onEdit,
  onSignOut,
  step,
  user,
}: OnboardingConversationProps) {
  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <UserIndicator user={user} onSignOut={onSignOut} />
      <header data-tauri-drag-region className="h-[72px] shrink-0" />
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-6">
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto pr-1 pb-6">
          {steps
            .slice(0, currentIndex)
            .filter((pastStep) => pastStep !== editingStep)
            .map((pastStep) => (
              <div key={pastStep} className="space-y-3">
                <AgentBubble text={questionText(pastStep, draft)} />
                <EditableAnswer onEdit={() => onEdit(pastStep)}>
                  <AnswerPreview step={pastStep} draft={draft} />
                </EditableAnswer>
              </div>
            ))}
          <div ref={currentQuestionRef} className="space-y-4">
            {step === "finish" ? null : (
              <AgentBubble
                key={step}
                text={questionText(step, draft)}
                current
              />
            )}
            <div className="w-full max-w-[720px]">
              {editingStep ? (
                <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs">
                  <span>Editing your previous answer</span>
                  <button
                    type="button"
                    onClick={onCancelEditing}
                    className="hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              {control}
            </div>
            <div className="min-h-5">
              {notice ? (
                <p className="text-muted-foreground text-xs">{notice}</p>
              ) : null}
              {error ? (
                <p className="text-destructive text-xs break-words">{error}</p>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
