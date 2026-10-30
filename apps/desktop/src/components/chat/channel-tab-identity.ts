import type { Database } from "@chief/relay-contracts";

import type { ChannelTab } from "./channel-tabs";
import { pageBoard } from "../pages/page-board";

interface FileSummary {
  id: string;
  previewContent?: string;
}
/** Pure board page artifacts are aliases of their database, not second tabs. */
export function canonicalChannelTab(
  tab: ChannelTab,
  files: readonly FileSummary[],
  databases: readonly Database[],
): ChannelTab {
  if (tab.kind !== "file") return tab;
  const source = pageBoard(
    files.find((file) => file.id === tab.id)?.previewContent,
  );
  if (!source) return tab;
  const database = databases.find(
    (database) => database.id === source.database,
  );
  return {
    kind: "database",
    id: source.database,
    name: database?.name ?? tab.name,
  };
}
export function uniqueChannelTabs(
  tabs: readonly ChannelTab[],
  files: readonly FileSummary[],
  databases: readonly Database[],
  loaded: boolean,
  filesLoaded = true,
) {
  const result: ChannelTab[] = [];
  const seen = new Set<string>();
  for (const original of tabs) {
    if (original.kind === "file" && !filesLoaded) continue;
    const tab = canonicalChannelTab(original, files, databases);
    if (
      loaded &&
      tab.kind === "database" &&
      !databases.some((database) => database.id === tab.id)
    )
      continue;
    const key = `${tab.kind}:${tab.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tab);
  }
  return result;
}
