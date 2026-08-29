import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const inputMinimal = definePromptPart({
  id: "input.minimal",
  summary: "Request only the input needed at the current stage.",
  when: always,
  render:
    () => `- Request only the input needed at the current stage. Never ask the user to type
  a provider account, property, site, or project ID before authentication. After
  authentication, use the provider API to list real named options; select the
  sole option automatically or present friendly labeled choices when several
  exist.`,
});
