/**
 * Prompt part router. Imports every shared part and exposes them in a single
 * ordered list. Add a rule by creating one file in this directory and import
 * it here. Order here is the order they appear in the assembled system prompt.
 */
import type { PromptPart } from "../types.js";
import { automations } from "./automations.js";
import { boundaries } from "./boundaries.js";
import { channelsAndFiles } from "./channels-and-files.js";
import { howYouWork } from "./how-you-work.js";
import { reactions } from "./reactions.js";
import { repositoryWork } from "./repository-work.js";
import { tools } from "./tools.js";
import { unattendedRuns } from "./unattended-runs.js";
import { voice } from "./voice.js";

export const promptParts: readonly PromptPart[] = [
  voice,
  howYouWork,
  boundaries,
  tools,
  reactions,
  repositoryWork,
  channelsAndFiles,
  automations,
  unattendedRuns,
];
