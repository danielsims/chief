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
    "google-workspace",
    "Google Workspace",
    "workspace.google.com",
    "Communication",
    "available",
    "Connect Gmail and Google Drive through Google's remote MCP services.",
    true,
  ),
  previewPlugin(
    "semrush",
    "Semrush",
    "semrush.com",
    "Marketing",
    "available",
    "Research search demand, competitors, and content opportunities.",
  ),
  previewPlugin(
    "mailchimp",
    "Intuit Mailchimp",
    "mailchimp.com",
    "Marketing",
    "available",
    "Plan and run email campaigns, audiences, and marketing automations.",
  ),
  previewPlugin(
    "airops",
    "AirOps",
    "airops.com",
    "Marketing",
    "available",
    "Access workspaces, brand kits, and search visibility analytics.",
  ),
  previewPlugin(
    "zendesk",
    "Zendesk",
    "zendesk.com",
    "Support",
    "available",
    "Manage customer support conversations, tickets, and help center content.",
  ),
  previewPlugin(
    "ramp",
    "Ramp",
    "ramp.com",
    "Finance",
    "available",
    "Manage cards, expenses, bills, and company spend.",
    true,
  ),
  previewPlugin(
    "brex",
    "Brex",
    "brex.com",
    "Finance",
    "available",
    "Work with company cards, expenses, travel, and spend controls.",
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
    install: () => Promise.resolve(undefined),
    authorize: () => Promise.resolve(undefined),
    uninstall: () => Promise.resolve(),
    requestAgentAction: () => ({
      messageId: "00000000-0000-4000-8000-000000000000",
      verb: "connect",
    }),
  } satisfies PluginRuntimeState;
  return (
    <main className="bg-background text-foreground min-h-screen px-8 pt-3">
      <PluginsPageContent plugins={plugins} />
    </main>
  );
}
