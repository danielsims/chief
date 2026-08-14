import type { AgentQuestion, InputRequest } from "@chief/agent-runtime/types";

export function isQuestionActionRequest(
  request: InputRequest | undefined,
): request is InputRequest {
  return Boolean(
    request?.fields.length === 0 &&
    request.questions &&
    request.questions.length > 0,
  );
}

export function simpleDecisionQuestion(
  request: InputRequest | undefined,
): AgentQuestion | undefined {
  if (
    !request ||
    request.fields.length > 0 ||
    request.questions?.length !== 1
  ) {
    return undefined;
  }
  const question = request.questions[0];
  return question && !question.multiSelect && question.options.length > 1
    ? question
    : undefined;
}
