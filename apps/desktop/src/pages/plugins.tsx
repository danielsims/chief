import type { AgentPluginSummary } from "@chief/agent-runtime/types";

import type { PluginRuntimeState } from "../lib/runtime-plugins";
import { PageTitle } from "../components/page-title";
import { PluginList } from "../components/plugins/plugin-list";
import { usePlugins } from "../lib/runtime-plugins";

function PluginsPageContent({ plugins }: { plugins: PluginRuntimeState }) {
  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5">
        <PageTitle>Plugins</PageTitle>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Connect the tools your team already uses.
        </p>
      </header>
      <main className="mt-5 min-h-0 flex-1 overflow-y-auto px-6">
        <PluginList plugins={plugins} />
      </main>
    </div>
  );
}

export function PluginsPage() {
  return <PluginsPageContent plugins={usePlugins()} />;
}

function previewPlugin(
  id: string,
  name: string,
  domain: string,
  category: string,
  status: AgentPluginSummary["status"],
  description: string,
  featured = false,
): AgentPluginSummary {
  return {
    id,
    name,
    description,
    category,
    homepage: `https://${domain}`,
    source: { type: "discovery", registry: "integrations.sh", domain },
    status,
    enabled: status !== "available",
    trusted: status !== "available",
    featured,
  };
}

const previewPlugins = [
  previewPlugin(
    "github",
    "GitHub",
    "github.com",
    "Engineering",
    "connected",
    "Search repositories, review changes, and collaborate on software.",
    true,
  ),
  previewPlugin(
    "notion",
    "Notion",
    "notion.so",
    "Productivity",
    "authorization_required",
    "Search and update your team knowledge, projects, and documents.",
    true,
  ),
  previewPlugin(
    "posthog",
    "PostHog",
    "posthog.com",
    "Analytics",
    "waiting",
    "Access analytics, feature flags, experiments, errors, and insights.",
  ),
  previewPlugin(
    "slack",
    "Slack",
    "slack.com",
    "Communication",
    "available",
    "Search channels, read conversations, and coordinate with your team.",
    true,
  ),
  previewPlugin(
    "vercel",
    "Vercel",
    "vercel.com",
    "Engineering",
    "reconnect",
    "Inspect projects, deployments, domains, and runtime activity.",
  ),
  previewPlugin(
    "hubspot",
    "HubSpot",
    "hubspot.com",
    "Sales",
    "failed",
    "Work with contacts, companies, deals, and customer activity.",
  ),
  previewPlugin(
    "linear",
    "Linear",
    "linear.app",
    "Engineering",
    "installed",
    "Plan work, manage issues, and keep projects moving.",
  ),
  previewPlugin(
    "google-drive",
    "Google Drive",
    "drive.google.com",
    "Productivity",
    "available",
    "Find, read, and organize files shared across your workspace.",
    true,
  ),
];
const previewRefreshedAt = 1_786_598_400_000;

export function PluginsPagePreview() {
  const plugins = {
    plugins: previewPlugins,
    sources: [],
    refreshedAt: previewRefreshedAt,
    stale: false,
    warning: undefined,
    loading: false,
    busyPluginId: null,
    refresh: () => undefined,
    install: () => Promise.resolve(),
    authorize: () => Promise.resolve(undefined),
    uninstall: () => Promise.resolve(),
  } satisfies PluginRuntimeState;
  return (
    <main className="bg-background text-foreground min-h-screen px-8 pt-3">
      <PluginsPageContent plugins={plugins} />
    </main>
  );
}
