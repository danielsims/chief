import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { ActionRequestCard } from "../src/components/chat/action-request-card";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

void test("renders a heartbeat decision directly inside its owning thread", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ActionRequestCard
        action={{
          id: "action-heartbeat",
          agentId: "chief",
          title: "Choose the next move",
          reason: "Chief needs one decision before continuing the work.",
          status: "open",
          createdAt: 1,
          request: {
            id: "request-heartbeat",
            title: "Choose the next move",
            fields: [],
            questions: [
              {
                question: "Which move should Chief greenlight?",
                options: [
                  { label: "Engage the top prospect" },
                  { label: "Connect GitHub" },
                ],
              },
            ],
          },
        }}
        onSubmit={() => Promise.resolve()}
      />
    </MemoryRouter>,
  );

  assert.match(html, /Which move should Chief greenlight\?/u);
  assert.match(html, /Requires attention/u);
  assert.match(html, /Engage the top prospect/u);
  assert.match(html, /Connect GitHub/u);
  assert.match(html, /Chief/u);
});

void test("keeps a resolved decision with its selected answer and attribution", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ActionRequestCard
        currentUser={{ id: "daniel", image: "https://example.com/daniel.jpg" }}
        action={{
          id: "action-heartbeat",
          agentId: "chief",
          title: "Choose the next move",
          reason: "Chief needs one decision before continuing the work.",
          status: "resolved",
          createdAt: 1,
          resolution: {
            answers: {
              "Which move should Chief greenlight?": "Connect GitHub",
            },
            resolvedAt: 2,
            resolvedBy: { id: "daniel", name: "Daniel Simms" },
          },
          request: {
            id: "request-heartbeat",
            title: "Choose the next move",
            fields: [],
            questions: [
              {
                question: "Which move should Chief greenlight?",
                options: [
                  { label: "Engage the top prospect" },
                  { label: "Connect GitHub" },
                ],
              },
            ],
          },
        }}
        onSubmit={() => Promise.resolve()}
      />
    </MemoryRouter>,
  );

  assert.match(html, /Daniel Simms/u);
  assert.match(html, /selected/u);
  assert.match(html, /src="https:\/\/example.com\/daniel.jpg"/u);
  assert.match(html, /aria-pressed="true"[^>]*disabled/u);
  assert.doesNotMatch(html, /Requires attention/u);
  assert.doesNotMatch(html, />Continue</u);
});

void test("renders multi-question actions without the removed progressive UI", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ActionRequestCard
        action={{
          id: "action-profile",
          agentId: "chief",
          title: "A couple of preferences",
          reason: "Answer these choices.",
          sourceId: "dm-chief",
          status: "open",
          createdAt: 1,
          request: {
            id: "request-profile",
            title: "A couple of preferences",
            fields: [],
            steps: [
              {
                text: "This old instruction rail should not be shown.",
              },
            ],
            questions: [
              {
                header: "Favourite colour",
                question: "Which colour do you like best?",
                options: [{ label: "Blue" }, { label: "Green" }],
              },
              {
                header: "Team size",
                question: "How large is the team?",
                options: [{ label: "1–5" }, { label: "6–20" }],
              },
            ],
          },
        }}
        onSubmit={() => Promise.resolve()}
      />
    </MemoryRouter>,
  );

  assert.match(html, /Which colour do you like best\?/u);
  assert.match(html, /How large is the team\?/u);
  assert.doesNotMatch(html, /One quick thing/u);
  assert.doesNotMatch(html, /Favourite colour/u);
  assert.doesNotMatch(html, /This old instruction rail/u);
  assert.doesNotMatch(html, />Done</u);
  assert.doesNotMatch(html, /sm:grid-cols-2/u);
});

void test("keeps a resolved free-text option and its typed answer", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ActionRequestCard
        action={{
          id: "action-colour",
          agentId: "chief",
          title: "Choose a colour",
          reason: "Chief needs the user's preferred colour.",
          status: "resolved",
          createdAt: 1,
          resolution: {
            answers: { "Which colour do you like best?": "Purple" },
            resolvedAt: 2,
            resolvedBy: { id: "daniel", name: "Daniel Simms" },
          },
          request: {
            id: "request-colour",
            title: "Choose a colour",
            fields: [],
            questions: [
              {
                question: "Which colour do you like best?",
                options: [{ label: "Blue" }, { label: "Other" }],
              },
            ],
          },
        }}
        onSubmit={() => Promise.resolve()}
      />
    </MemoryRouter>,
  );

  assert.match(html, /aria-pressed="true"[^>]*disabled/u);
  assert.match(html, /aria-label="Other answer for Which colour/u);
  assert.match(html, />Purple<\/textarea>/u);
  assert.match(html, /Daniel Simms/u);
});
