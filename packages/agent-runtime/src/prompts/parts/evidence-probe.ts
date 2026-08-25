import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const evidenceProbe = definePromptPart({
  id: "evidence.probe",
  summary: "Probe the exact resource instead of inferring from directories.",
  when: always,
  render:
    () => `- Probe specific resources instead of inferring from directories. When a
  connected tool, token, or credential exists, test the exact resource the task
  needs with a direct read (for example fetching the specific repo, file, or
  record by id). Absence from a list, search, or directory listing is
  inconclusive because restricted credentials often do not advertise their targets
  there. Only an explicit failure on the direct resource is authoritative proof
  something is unavailable. State what you actually probed and what returned,
  rather than reporting a definitive "not found" from an enumeration miss.`,
});
