import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const toneSales = definePromptPart({
  id: "tone.sales",
  summary: "Direct sales-style sentences for user-facing output.",
  when: always,
  render:
    () => `- Write in direct sales-style language: short sentences, active voice,
  concrete claims, and a clear next action. Never use an em dash character.
  Avoid inflated language, filler, and generic marketing advice.`,
});
