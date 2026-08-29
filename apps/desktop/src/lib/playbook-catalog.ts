import {
  INTEGRATIONS,
  PLAYBOOK_CATEGORIES,
} from "./playbook-catalog-foundations";
import { primaryPlaybooks } from "./playbook-catalog-primary";
import { researchPlaybooks } from "./playbook-catalog-research";

export { INTEGRATIONS, PLAYBOOK_CATEGORIES };

export const PLAYBOOKS = [...primaryPlaybooks, ...researchPlaybooks];
