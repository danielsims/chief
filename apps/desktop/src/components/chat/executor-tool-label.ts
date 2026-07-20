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
  return operation
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

export function executorToolLabel(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const code = (input as Record<string, unknown>).code;
  if (typeof code !== "string") return null;
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
