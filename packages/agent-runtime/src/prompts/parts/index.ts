/**
 * Prompt part router. Imports every atomic part and exposes them in a single
 * ordered list. Add a rule by creating one file in this directory and import
 * it here, exactly the way the agents folder registers a new agent. Order here
 * is the order they appear in the assembled system prompt.
 */
import type { PromptPart } from "../types.js";
import { actPrimary } from "./act-primary.js";
import { actionMinimize } from "./action-minimize.js";
import { actionsStructured } from "./actions-structured.js";
import { archiveOverDelete } from "./archive-over-delete.js";
import { askOptions } from "./ask-options.js";
import { askSmallest } from "./ask-smallest.js";
import { assumeReversible } from "./assume-reversible.js";
import { authorityHuman } from "./authority-human.js";
import { browserSession } from "./browser-session.js";
import { channelsDurable } from "./channels-durable.js";
import { delegateSpecialist } from "./delegate-specialist.js";
import { evidenceProbe } from "./evidence-probe.js";
import { filesEditable } from "./files-editable.js";
import { groundTruth } from "./ground-truth.js";
import { handoffFlag } from "./handoff-flag.js";
import { handoffLastResort } from "./handoff-last-resort.js";
import { inputMinimal } from "./input-minimal.js";
import { integrationPrepare } from "./integration-prepare.js";
import { linksNavigation } from "./links-navigation.js";
import { membershipHumans } from "./membership-humans.js";
import { messagesSparing } from "./messages-sparing.js";
import { missionCell } from "./mission-cell.js";
import { missionControl } from "./mission-control.js";
import { modeChannels } from "./mode-channels.js";
import { oauthClaim } from "./oauth-claim.js";
import { pluginsDiscover } from "./plugins-discover.js";
import { primitivesChannels } from "./primitives-channels.js";
import { projectsCheckout } from "./projects-checkout.js";
import { reactionsAgent } from "./reactions-agent.js";
import { scheduledInput } from "./scheduled-input.js";
import { scheduledTriggers } from "./scheduled-triggers.js";
import { toneSales } from "./tone-sales.js";
import { toneTeammate } from "./tone-teammate.js";
import { toolsQuiet } from "./tools-quiet.js";

export const promptParts: readonly PromptPart[] = [
  toneTeammate,
  toneSales,
  messagesSparing,
  primitivesChannels,
  reactionsAgent,
  linksNavigation,
  missionControl,
  missionCell,
  modeChannels,
  archiveOverDelete,
  toolsQuiet,
  groundTruth,
  actPrimary,
  handoffLastResort,
  authorityHuman,
  actionMinimize,
  pluginsDiscover,
  projectsCheckout,
  evidenceProbe,
  delegateSpecialist,
  assumeReversible,
  integrationPrepare,
  actionsStructured,
  inputMinimal,
  oauthClaim,
  channelsDurable,
  membershipHumans,
  scheduledTriggers,
  browserSession,
  askSmallest,
  scheduledInput,
  askOptions,
  filesEditable,
  handoffFlag,
];
