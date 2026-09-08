import { recommendProjectTool } from "../../runtime/projects/recommend-project.js";
import { commitProjectCheckoutTool } from "./commit-project-checkout.js";
import { compareProjectBranchesTool } from "./compare-project-branches.js";
import { createProjectCheckoutTool } from "./create-project-checkout.js";
import { createProjectPullRequestTool } from "./create-project-pull-request.js";
import { discardProjectCheckoutTool } from "./discard-project-checkout.js";
import { getProjectCheckoutStatusTool } from "./get-project-checkout-status.js";
import { getProjectPullRequestStatusTool } from "./get-project-pull-request-status.js";
import { inspectProjectTool } from "./inspect-project.js";
import { listProjectsTool } from "./list-projects.js";
import { publishProjectCheckoutTool } from "./publish-project-checkout.js";
import { releaseProjectCheckoutTool } from "./release-project-checkout.js";
import { requestProjectAccessTool } from "./request-project-access.js";

export const projectsToolkit = [
  listProjectsTool,
  recommendProjectTool,
  inspectProjectTool,
  createProjectCheckoutTool,
  getProjectCheckoutStatusTool,
  commitProjectCheckoutTool,
  releaseProjectCheckoutTool,
  compareProjectBranchesTool,
  publishProjectCheckoutTool,
  discardProjectCheckoutTool,
  createProjectPullRequestTool,
  getProjectPullRequestStatusTool,
  requestProjectAccessTool,
] as const;
