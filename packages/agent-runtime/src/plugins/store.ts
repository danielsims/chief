import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PluginInstallRecord, PluginWorkspaceState } from "./types.js";
import { workspaceRoot } from "../workspace-secrets.js";
import { loadAgentPlugin } from "./loader.js";

const DEFAULT_CATALOGS = [
  {
    id: "integrations-sh",
    name: "integrations.sh",
    catalogUrl: "https://integrations.sh/api.json",
    homepage: "https://integrations.sh/?kind=mcp",
    enabled: true,
    format: "integrations-sh" as const,
  },
  {
    id: "xai-official",
    name: "xAI Official",
    catalogUrl:
      "https://raw.githubusercontent.com/xai-org/plugin-marketplace/main/.grok-plugin/marketplace.json",
    homepage: "https://github.com/xai-org/plugin-marketplace",
    enabled: true,
    format: "agent-catalog" as const,
  },
] as const;

export function pluginsRoot(workspaceId: string) {
  return join(workspaceRoot(workspaceId), "plugins");
}

function statePath(workspaceId: string) {
  return join(pluginsRoot(workspaceId), "state.json");
}

export function pluginSkillsIndexPath(workspaceId: string) {
  return join(pluginsRoot(workspaceId), "skills.md");
}

async function writePluginSkillsIndex(
  workspaceId: string,
  state: PluginWorkspaceState,
) {
  const sections: string[] = [];
  for (const installation of Object.values(state.installations)) {
    if (!installation.enabled || !installation.trusted) continue;
    try {
      const loaded = await loadAgentPlugin(installation.packageRoot);
      if (loaded.skills.length === 0) continue;
      sections.push(
        [
          `- ${loaded.manifest.name}${loaded.manifest.description ? `: ${loaded.manifest.description}` : ""}`,
          ...loaded.skills.map(
            (skill) =>
              `  - ${skill.name}: ${skill.description} (instructions: ${skill.path})`,
          ),
        ].join("\n"),
      );
    } catch (error) {
      console.error(
        `[plugins] Could not index ${installation.id} skills:`,
        error,
      );
    }
  }
  const body = ["# Trusted portable plugin skills", "", ...sections].join("\n");
  await writeFile(pluginSkillsIndexPath(workspaceId), `${body.trim()}\n`, {
    mode: 0o600,
  });
}

export async function readPluginState(
  workspaceId: string,
): Promise<PluginWorkspaceState> {
  try {
    const raw = JSON.parse(await readFile(statePath(workspaceId), "utf8")) as
      | (Partial<PluginWorkspaceState> & {
          marketplaceSources?: PluginWorkspaceState["catalogSources"];
        })
      | undefined;
    const savedSources = Array.isArray(raw?.catalogSources)
      ? raw.catalogSources
      : Array.isArray(raw?.marketplaceSources)
        ? raw.marketplaceSources.map((source) => ({
            ...source,
            format:
              source.format === "integrations-sh"
                ? ("integrations-sh" as const)
                : ("agent-catalog" as const),
          }))
        : undefined;
    return {
      version: 2,
      catalogSources: savedSources ?? [...DEFAULT_CATALOGS],
      installations:
        raw?.installations && typeof raw.installations === "object"
          ? raw.installations
          : {},
    };
  } catch {
    return {
      version: 2,
      catalogSources: [...DEFAULT_CATALOGS],
      installations: {},
    };
  }
}

export async function writePluginState(
  workspaceId: string,
  state: PluginWorkspaceState,
) {
  const root = pluginsRoot(workspaceId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = statePath(workspaceId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, target);
  await writePluginSkillsIndex(workspaceId, state);
}

export async function savePluginInstallation(
  workspaceId: string,
  record: PluginInstallRecord,
) {
  const state = await readPluginState(workspaceId);
  state.installations[record.id] = record;
  await writePluginState(workspaceId, state);
}

export async function trustPluginInstallation(
  workspaceId: string,
  pluginId: string,
) {
  const state = await readPluginState(workspaceId);
  const installation = state.installations[pluginId];
  if (!installation) throw new Error(`Plugin ${pluginId} is not installed.`);
  if (!installation.trusted) {
    state.installations[pluginId] = { ...installation, trusted: true };
    await writePluginState(workspaceId, state);
  }
}

export async function removePluginInstallation(
  workspaceId: string,
  pluginId: string,
) {
  const state = await readPluginState(workspaceId);
  const record = state.installations[pluginId];
  if (!record) return;
  delete state.installations[pluginId];
  await writePluginState(workspaceId, state);
  const packagesRoot = join(pluginsRoot(workspaceId), "packages");
  if (record.packageRoot.startsWith(`${packagesRoot}/`)) {
    await rm(record.packageRoot, { recursive: true, force: true });
  }
}

export async function copyPluginPackage(
  workspaceId: string,
  pluginId: string,
  sourceRoot: string,
) {
  const destination = join(pluginsRoot(workspaceId), "packages", pluginId);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(join(pluginsRoot(workspaceId), "packages"), {
    recursive: true,
    mode: 0o700,
  });
  await rm(temporary, { recursive: true, force: true });
  await cp(sourceRoot, temporary, {
    recursive: true,
    force: false,
    filter: (path) => !path.split("/").includes(".git"),
  });
  await rm(destination, { recursive: true, force: true });
  await rename(temporary, destination);
  return destination;
}
