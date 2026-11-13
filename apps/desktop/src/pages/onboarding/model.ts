import { z } from "zod";

import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { suggestedAgentIds } from "@chief/relay-contracts";

export const setupDraftSchema = z.object({
  version: z.literal(1),
  commandId: z.uuid(),
  step: z.enum([
    "profile",
    "workspace",
    "company",
    "intro",
    "chief",
    "connect",
    "connecting",
    "eve",
    "apps",
    "plugins",
    "team",
    "invite",
    "approve",
    "success",
  ]),
  name: z.string().max(120),
  slug: z.string().max(80),
  slugEdited: z.boolean(),
  purpose: z.enum(["personal", "company"]),
  companyName: z.string().max(120),
  website: z.string().max(2048),
  location: z.enum(["device", "cloud"]),
  localProvider: z.enum(["codex", "claude", "opencode"]),
  /** The agent app's model; "auto" lets the app choose. */
  localModel: z.string().max(200).default("auto"),
  service: z.enum(["vercelAiGateway", "opencode"]),
  host: z.enum(["relay-cell", "vercel-eve"]),
  selectedAgentIds: z.array(z.string()).max(10),
  selectedApps: z.array(z.string()).max(40),
  emails: z.array(z.email()).max(50),
  workspaceId: z.string().nullable(),
});
export type SetupDraft = z.infer<typeof setupDraftSchema>;
export type SetupStep = SetupDraft["step"];
/** Marks the setup this window is in, so remounting it never starts over. */
export function activeSetupKey(base: string) {
  return `${base}:active`;
}
/** Starting a new setup or leaving one ends the current setup session. */
export function forgetActiveWorkspaceSetup() {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const entry = sessionStorage.key(i);
    if (
      entry?.startsWith("chief.workspace-setup.v1:") &&
      entry.endsWith(":active")
    )
      sessionStorage.removeItem(entry);
  }
}
export function workspaceSetupDraftKey(base: string, workspaceId: string) {
  return `${base}:workspace:${workspaceId}`;
}
export const newSetupDraft = (): SetupDraft => ({
  version: 1,
  commandId: crypto.randomUUID(),
  step: "profile",
  name: "",
  slug: "",
  slugEdited: false,
  purpose: "personal",
  companyName: "",
  website: "",
  location: "device",
  localProvider: "codex",
  localModel: "auto",
  service: "vercelAiGateway",
  host: "relay-cell",
  selectedAgentIds: suggestedAgentIds("personal"),
  selectedApps: [],
  emails: [],
  workspaceId: null,
});
export function readSetupDraft(key: string) {
  try {
    const value = setupDraftSchema.safeParse(
      JSON.parse(localStorage.getItem(key) ?? "null"),
    );
    return value.success ? value.data : newSetupDraft();
  } catch {
    return newSetupDraft();
  }
}
/** What a member pastes into their own agent. Every step matches the
 * relay's /connect instructions and chief-machine's commands. */
export function setupPrompt(link: string, username?: string | null) {
  const handle = username
    ? `${username}:<your-name>`
    : "<username>:<your-name>";
  return `Connect to my Chief workspace as my agent.

Chief is a shared workspace for people and their AI agents. You join with the chief-machine CLI, either on this device or on the host where you run, such as Grokbot, Muse or another cloud agent.

Invitation link: ${link}

1. Open the invitation link and follow its instructions where you run. Keep the whole link, including the part after #. That part is the invitation and is not sent to the page. If chief-machine is missing, install it with the official script the page lists.
2. Request access with a short, recognizable name:
   chief-machine agent connect --link '${link}' --name <your-name> --provider <chatgpt|claude|grok|muse|other>
3. Tell me your request is waiting and show me the verification code it prints, so I can match it in Chief. Then run chief-machine agent wait <binding-id> and share what it says. Don't say you've joined until it confirms I accepted you.
4. If you run on my computer, its welcome note is all you need: when someone mentions or messages you in Chief, you'll be brought into the conversation. If you run on your own host, you stay connected as @${handle} and use only the channels I give you access to. Either way, introduce yourself by name and join in as a teammate.

If you cannot open the link, run commands or install the CLI, tell me exactly what is blocking you. Never ask me for passwords, API keys or access tokens. This link only lets you request access, and it expires within 15 minutes.`;
}
export const localProviderName = {
  codex: "ChatGPT",
  claude: "Claude",
  opencode: "OpenCode",
} as const;

export function resumeSetupDraft(
  saved: SetupDraft,
  workspace: WorkspaceSnapshot | null,
): SetupDraft {
  if (saved.workspaceId || workspace?.setupComplete !== false) return saved;
  const chief = workspace.agents.find((a) => a.id === "chief");
  const eve = workspace.runtime === null;
  return {
    ...saved,
    workspaceId: workspace.id,
    name: workspace.name,
    slug: workspace.slug ?? "",
    purpose: workspace.purpose ?? "personal",
    companyName: workspace.companyName ?? "",
    website: workspace.website,
    location: workspace.runtime === "desktop" ? "device" : "cloud",
    host: eve ? "vercel-eve" : "relay-cell",
    localProvider:
      chief?.provider === "claude"
        ? "claude"
        : chief?.provider === "opencode"
          ? "opencode"
          : "codex",
    selectedApps: workspace.selectedApps,
    selectedAgentIds: chief?.subagents.map((a) => a.id) ?? [],
    step:
      eve &&
      (chief?.runtime.kind !== "external-channel" ||
        chief.runtime.connectionStatus !== "connected")
        ? "eve"
        : "apps",
  };
}
