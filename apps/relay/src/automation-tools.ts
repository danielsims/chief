import { permissionForLocalTool } from "@chief/agent-runtime/agent-tool-permissions";
import { localAgentToolDefinitions } from "@chief/agent-runtime/local-tools";

import { hostedAgentTools } from "./hosted-agent-tools/registry";
import { hostedAgentToolName } from "./hosted-agent-tools/tool";

/**
 * Chief's own tools that an automation step can call directly, with no model
 * in between. It is the hosted agent toolkit minus tools that need a computer
 * or browser, tools that only make sense inside an agent's turn, and tools
 * the run engine itself uses.
 */
const excluded = new Set([
  // The engine reports and staffs runs itself.
  "automations.reportRunStep",
  "automations.addRunCollaborator",
  // Concepts being retired or reworked; not worth building automations on.
  "brandProfile.status",
  "brandProfile.save",
  // Only meaningful to an agent choosing where to work.
  "channels.join",
  "recurringWork.list",
  // These start work that finishes later, so a step could not wait for it.
  "specialists.delegate",
  "questions.ask",
  // An automation must not create, test or rework automations.
  "recurringWork.propose",
  "automations.tools",
  "automations.inspect",
  "automations.test",
  // Plugin tools are steps in their own right.
  "plugins.list",
  "plugins.recommend",
  "projects.recommend",
]);

export function automationChiefTools() {
  return hostedAgentTools
    .filter(
      (tool) =>
        !tool.requiresBrowser &&
        !tool.requiresComputer &&
        !excluded.has(tool.definition.operation.operationId),
    )
    .map((tool) => {
      const definition = localAgentToolDefinitions([tool.definition])[0];
      return {
        tool,
        name: tool.definition.operation.operationId,
        toolName: hostedAgentToolName(tool),
        title: tool.definition.operation.summary,
        description: definition?.description ?? "",
        inputSchema: definition?.parameters ?? {},
        readOnly: tool.effect === "read_only",
        effect: tool.effect,
        permission: permissionForLocalTool(
          tool.definition.method,
          tool.definition.path,
        ),
      };
    });
}

export function automationChiefTool(name: string) {
  return automationChiefTools().find((tool) => tool.name === name);
}
