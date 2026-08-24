import { isJsonObject, isJsonString } from "@chief/relay-contracts";

function humanizeExecutorOperation(operation: string) {
  if (operation === "search") return "Search connected tools";
  if (operation === "describe" || operation === "tool") {
    return "Inspect connected tool";
  }
  if (operation === "uiPresentChart") return "Present chart";
  if (operation === "analyticsRunReport" || /runReport$/i.test(operation)) {
    return "Fetch analytics report";
  }
  if (/runRealtimeReport$/i.test(operation)) return "Fetch realtime analytics";
  if (operation === "sourcesList") return "Check connected sources";
  if (operation === "filesList") return "Review workspace files";
  if (operation === "filesWrite") return "Save workspace document";
  if (operation === "brandProfileSave") return "Save brand profile";
  if (operation === "prospectsList") return "Review saved prospects";
  if (operation === "prospectsSave") return "Save qualified prospect";
  if (operation === "trendsList") return "Review saved trends";
  if (operation === "trendsSave") return "Save market signal";
  if (operation === "actionRaise") return "Create setup action";
  if (operation === "specialistsDelegate") return "Delegate specialist work";
  if (operation === "browserOpen") return "Open browser";
  if (operation === "browserSnapshot") return "Inspect browser page";
  if (operation === "browserClick") return "Click browser control";
  if (operation === "browserFill") return "Fill browser field";
  if (operation === "browserSelect") return "Select browser option";
  if (operation === "browserPress") return "Press browser key";
  if (/^googleAnalytics\./i.test(operation))
    return "Authorize Google Analytics";
  return operation
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

export function executorToolLabel(input: unknown) {
  if (!input || !isJsonObject(input)) return null;
  const code = findCodeString(input);
  if (code === null) return null;
  const calls: string[] = [];
  const add = (operation: string | undefined) => {
    if (operation && !calls.includes(operation)) calls.push(operation);
  };
  for (const match of code.matchAll(/tools\.(search|describe)\s*\(/g)) {
    add(match[1]);
  }
  for (const match of code.matchAll(/tools\.([A-Za-z0-9_.]+)\s*\(/g)) {
    add(match[1]?.split(".").at(-1));
  }
  for (const match of code.matchAll(/tools((?:\[["'][^"']+["']\])+?)\s*\(/g)) {
    const segments = Array.from(
      match[1]?.matchAll(/\[["']([^"']+)["']\]/g) ?? [],
      (segment) => segment[1],
    );
    add(segments.at(-1)?.split(".").at(-1));
  }
  const operation =
    calls.find((call) => call !== "search" && call !== "describe") ?? calls[0];
  return operation ? humanizeExecutorOperation(operation) : null;
}

/**
 * The executor `execute` tool carries its code in a `code` field, but the
 * opencode ACP transport can deliver it nested (input.code, arguments.code)
 * or as a JSON-encoded string. Walk the object once to find a string that
 * contains a `tools.` call and return it.
 */
function findCodeString(input: Record<string, unknown>): string | null {
  const candidate = input.code;
  if (isJsonString(candidate)) {
    if (candidate.includes("tools.") || candidate.includes('tools["')) {
      return candidate;
    }
    return null;
  }
  if (candidate && isJsonObject(candidate)) {
    const nested = findCodeString(candidate);
    if (nested !== null) return nested;
  }
  for (const value of Object.values(input)) {
    if (!isJsonString(value)) continue;
    if (value.includes("tools.") || value.includes('tools["')) return value;
  }
  return null;
}
