import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

import type {
  ChiefUIMessage,
  GenerativeQuestionData,
} from "@chief/agent-runtime/types";

interface QuestionAnswers {
  /** The reply that answered this question, if anyone has replied yet. */
  answerFor: (question: GenerativeQuestionData) => string | null;
  answer: (question: GenerativeQuestionData, option: string) => void;
}

const QuestionAnswersContext = createContext<QuestionAnswers | null>(null);

/** A question is answered in its own thread, so a reply there after it is
 * the answer, whether the user picked an option or typed their own. */
export function questionThreadRootId(question: GenerativeQuestionData) {
  return question.threadRootId ?? question.messageId;
}

function replyText(message: ChiefUIMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
}

export function QuestionAnswersProvider({
  children,
  messages,
  send,
}: {
  children: ReactNode;
  messages: readonly ChiefUIMessage[];
  send: (text: string, threadRootId: string, audience: string[]) => void;
}) {
  const value = useMemo<QuestionAnswers>(
    () => ({
      answerFor: (question) => {
        const asked = messages.find(
          (message) => message.id === question.messageId,
        );
        const askedAt = asked?.metadata?.createdAt ?? 0;
        const rootId = questionThreadRootId(question);
        const reply = messages.find(
          (message) =>
            message.role === "user" &&
            message.metadata?.threadRootId === rootId &&
            message.metadata.createdAt > askedAt,
        );
        return reply ? replyText(reply) : null;
      },
      answer: (question, option) =>
        send(option, questionThreadRootId(question), [question.agentId]),
    }),
    [messages, send],
  );
  return (
    <QuestionAnswersContext.Provider value={value}>
      {children}
    </QuestionAnswersContext.Provider>
  );
}

export function useQuestionAnswers() {
  return useContext(QuestionAnswersContext);
}
