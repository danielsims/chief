import { executeHostedAgentProjectTool } from "../../hosted-agent-project-tools";
import { defineHostedAgentTool } from "../tool";

export const hostedProjectTools = [
  defineHostedAgentTool(
    "projects.recommend",
    async ({ env, job }, input) =>
      await executeHostedAgentProjectTool(
        env,
        job,
        "projects.recommend",
        input,
      ),
    { effect: "idempotent" },
  ),
];
