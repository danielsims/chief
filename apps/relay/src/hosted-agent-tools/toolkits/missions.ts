import { toJsonObject } from "@chief/relay-contracts";

import { withTrustedContext } from "../../internal-context";
import { requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";
import { workspaceOperation } from "./channels";

export const hostedMissionTools = [
  defineHostedAgentTool(
    "missions.reportRunStep",
    ({ env, job, principal }, input) =>
      workspaceOperation(env, job, principal, "schedules-runs-report", {
        body: input,
      }),
    { effect: "idempotent" },
  ),
  defineHostedAgentTool(
    "missions.list",
    async ({ env, job, principal }) =>
      workspaceOperation(env, job, principal, "missions-list"),
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "missions.create",
    async ({ env, job, principal }, input) =>
      workspaceOperation(env, job, principal, "missions-create", {
        body: input,
      }),
    { effect: "idempotent" },
  ),
  ...(["missions.recordExperiment", "missions.updateStatus"] as const).map(
    (operation) =>
      defineHostedAgentTool(
        operation,
        async ({ env, job, principal }, input) => {
          const { missionId: _missionId, ...body } = input;
          const response = await env.WORKSPACES.get(
            env.WORKSPACES.idFromName(job.workspaceId),
          ).fetch(
            withTrustedContext(
              new Request("https://workspace.internal", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-chief-internal-operation":
                    operation === "missions.recordExperiment"
                      ? "missions-experiment"
                      : "missions-status",
                  "x-chief-mission-id": requiredString(input, "missionId"),
                },
                body: JSON.stringify(body),
              }),
              {
                principal,
                workspaceId: job.workspaceId,
                requestId: crypto.randomUUID(),
              },
            ),
          );
          if (!response.ok) throw new Error(await response.text());
          return toJsonObject(await response.json());
        },
        { effect: "idempotent" },
      ),
  ),
];
