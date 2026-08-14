import assert from "node:assert/strict";
import test from "node:test";

import type { InputRequest } from "@chief/agent-runtime/types";

import {
  isQuestionActionRequest,
  simpleDecisionQuestion,
} from "../src/lib/input-request-presentation";

const decision: InputRequest = {
  id: "first-move",
  title: "Choose the first move",
  fields: [],
  questions: [
    {
      question: "Which first move do you want to greenlight?",
      options: [
        { label: "Engage the top prospect" },
        { label: "Connect GitHub" },
        { label: "Set the public brand voice" },
      ],
    },
  ],
};

void test("recognizes one option question as a compact overview decision", () => {
  assert.equal(
    simpleDecisionQuestion(decision)?.question,
    decision.questions?.[0]?.question,
  );
});

void test("keeps setup forms and multi-select questions in the full UI", () => {
  assert.equal(
    simpleDecisionQuestion({
      ...decision,
      fields: [
        {
          key: "token",
          label: "Token",
          type: "secret",
          save: { envKey: "TOKEN" },
        },
      ],
    }),
    undefined,
  );
  assert.equal(
    simpleDecisionQuestion({
      ...decision,
      questions: decision.questions?.map((question) => ({
        ...question,
        multiSelect: true,
      })),
    }),
    undefined,
  );
});

void test("uses the compact action UI for any question-only request", () => {
  assert.equal(isQuestionActionRequest(decision), true);
  assert.equal(
    isQuestionActionRequest({
      ...decision,
      questions: [
        ...(decision.questions ?? []),
        {
          question: "How large is the team?",
          options: [{ label: "1–5" }, { label: "6–20" }],
        },
      ],
    }),
    true,
  );
  assert.equal(
    isQuestionActionRequest({
      ...decision,
      fields: [
        {
          key: "token",
          label: "Token",
          type: "secret",
          save: { envKey: "TOKEN" },
        },
      ],
    }),
    false,
  );
});
