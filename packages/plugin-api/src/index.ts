import { pluginApiOperations } from "./reference";

export { pluginApiOperations, pluginApiPrinciples } from "./reference";
export type {
  AgentPluginCatalogEntry,
  AgentPluginStatus,
  AgentPluginSummary,
  PluginApiOperation,
  PluginApiToolPermission,
  PluginAuthorizationAction,
} from "./types";

const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const operationPathPatterns = pluginApiOperations.map((operation) => ({
  operation,
  pattern: new RegExp(
    `^${operation.path
      .split(/(\{[^}]+\})/g)
      .map((part) =>
        part.startsWith("{") && part.endsWith("}")
          ? "[^/]+"
          : escapePattern(part),
      )
      .join("")}$`,
  ),
}));

export function pluginApiOperationForRequest(method: string, pathname: string) {
  const verb = method.toUpperCase();
  return operationPathPatterns.find(
    ({ operation, pattern }) =>
      operation.method === verb && pattern.test(pathname),
  )?.operation;
}
