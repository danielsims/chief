import { defineHostedAgentTool } from "../tool";
import { workspaceOperation } from "./channels";

export const hostedAutomationTools = [
  defineHostedAgentTool(
    "automations.addRunCollaborator",
    ({ env, job, principal }, input) =>
      workspaceOperation(
        env,
        job,
        principal,
        "schedules-runs-add-collaborator",
        { body: input },
      ),
    { effect: "idempotent" },
  ),
  defineHostedAgentTool(
    "automations.reportRunStep",
    ({ env, job, principal }, input) =>
      workspaceOperation(env, job, principal, "schedules-runs-report", {
        body: input,
      }),
    { effect: "idempotent" },
  ),
  defineHostedAgentTool(
    "automations.tools",
    ({ env, job, principal }, input) =>
      workspaceOperation(env, job, principal, "automations-tools", {
        body: input,
      }),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "automations.inspect",
    ({ env, job, principal }, input) =>
      workspaceOperation(env, job, principal, "automations-inspect", {
        body: input,
      }),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "automations.test",
    ({ env, job, principal }, input) =>
      workspaceOperation(env, job, principal, "automations-test", {
        body: input,
      }),
    { effect: "idempotent" },
  ),
];
