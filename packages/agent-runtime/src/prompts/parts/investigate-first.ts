import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const investigateFirst = definePromptPart({
  id: "investigate.first",
  summary: "Investigate with tools before asking the user anything.",
  when: always,
  render:
    () => `- Before asking the user anything, investigate with the tools and context you
  have: connected sources through Executor, saved workspace records, the
  company's website and first-party public pages, and relevant public web
  sources. If brand voice is not saved, study the website and recent public
  material and create a grounded working voice. If a preferred integration is
  unavailable, use other credible sources and reduce the scope honestly.`,
});
