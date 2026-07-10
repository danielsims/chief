/**
 * Task prompt for deploying the workspace's agent team (the eve app in
 * apps/workspace) to the user's chosen host. Runs through the same setup
 * agent + panel as integration connects: full access, browser consent for
 * logins, MARKETER_SETUP_RESULT protocol at the end.
 */
export type DeployTarget = "vercel" | "cloudflare" | "railway";

export const DEPLOY_PROVIDER = "workspace-deploy";

export const DEPLOY_TARGETS: Array<{
  value: DeployTarget;
  label: string;
  detail: string;
}> = [
  {
    value: "vercel",
    label: "Vercel",
    detail: "Cron schedules and AI Gateway work out of the box.",
  },
  {
    value: "cloudflare",
    label: "Cloudflare",
    detail: "Workers deploy via wrangler; bring an AI Gateway key.",
  },
  {
    value: "railway",
    label: "Railway",
    detail: "Long-running Node service; schedules run in-process.",
  },
];

// Dogfood path: the eve app lives in the product repo. A packaged build will
// scaffold this template into ~/.marketer/workspace-app instead.
const APP_PATH =
  (import.meta.env.VITE_WORKSPACE_APP_PATH as string | undefined) ??
  "$HOME/Documents/Development/marketer/apps/workspace";

const COMMON = `You are deploying this workspace's agent team. The deployable app is an eve
(https://eve.dev) project at ${APP_PATH} — run every command from that
directory unless a step says otherwise.

Ground rules:
- eve requires Node 24 or newer. Check node --version first; if it is older,
  look for $HOME/.nvm/versions/node/v24*/bin or $HOME/.nvm/versions/node/v25*/bin
  and prepend the newest to PATH for every subsequent command; if nvm has no
  24+, install one (brew install node@24) and use its bin path.
- Narrate each step in one short sentence before running it. Never use em dashes.
- When a command opens the user's browser for login, say so in one line and wait.
- Read error bodies and adapt; do not give up on the first failure.

Prepare the app inputs:
1. Copy the brand brief: mkdir -p workspace-input && cp "$MARKETER_WORKSPACE_DIR/context.md" workspace-input/context.md (skip without failing if the file is missing).
2. Export cloud-placed automations: inside Executor, call
   tools.marketer.local.workspace.localTools.recurringWorkList (or the recurringWorkList tool under the marketer-local integration) and write the entries whose placement is "cloud" to workspace-input/automations.json as a JSON array of {id, agentId, cron, timezone, instructions, toolPatterns, placement}. If the tool has no placement field or returns nothing, write [].
3. pnpm install --silent (only if node_modules is missing), then pnpm generate. Confirm it reports the generated files.`;

const VERCEL_STEPS = `Deploy to Vercel:
4. vercel whoami. If not logged in, run vercel login (browser) and wait.
5. If .vercel/project.json does not exist: vercel link --project marketer-workspace --yes. If it demands a scope, re-run with --scope set to the team it lists; if several teams are listed, ask the user which one with a question.
6. Deploy, in this order of preference, moving to the next only if the previous genuinely cannot work non-interactively:
   a. pnpm exec eve deploy
   b. VERCEL_USE_EXPERIMENTAL_FRAMEWORKS=1 vercel deploy --prod
7. Capture the production URL from the deploy output.
8. Verify: curl -s -X POST <url>/eve/v1/session -H "Content-Type: application/json" -d '{"message":"In one sentence, who are you?"}' must return JSON containing a sessionId. Then GET <url>/eve/v1/session/<sessionId>/stream briefly and confirm an in-character reply mentioning the company from the brand brief.
9. Optional env (set only when values exist; never invent them): if the user has a hosted Executor, vercel env add EXECUTOR_MCP_URL and EXECUTOR_MCP_TOKEN for production, then redeploy. If not, say in one line that connected-integration tools stay off until an Executor endpoint is configured.`;

const CLOUDFLARE_STEPS = `Deploy to Cloudflare:
4. Check wrangler (npm i -g wrangler if missing). wrangler whoami; if not logged in, wrangler login (browser) and wait.
5. Build for Workers: NITRO_PRESET=cloudflare-module pnpm exec eve build. If eve rejects the preset, read the error and use the preset it suggests for Cloudflare.
6. Deploy the built output with wrangler deploy (create a minimal wrangler.jsonc pointing at the built entry if one does not exist; name it marketer-workspace).
7. Set secrets: wrangler secret put AI_GATEWAY_API_KEY is REQUIRED off-Vercel — if the user has no key, emit one input request asking them to paste an AI Gateway key from https://vercel.com/ai-gateway (field save envKey AI_GATEWAY_API_KEY), then set it. Add EXECUTOR_MCP_URL/EXECUTOR_MCP_TOKEN the same way when available.
8. Verify exactly as the Vercel step does, against the workers.dev URL.`;

const RAILWAY_STEPS = `Deploy to Railway:
4. Check railway CLI (npm i -g @railway/cli if missing). railway whoami; if not logged in, railway login (browser) and wait.
5. railway init --name marketer-workspace if the directory is not linked yet, then railway up.
6. Set AI_GATEWAY_API_KEY (required off-Vercel; ask via one input request if the user has none) and any EXECUTOR_MCP_* values with railway variables set.
7. Get the public URL (railway domain, generating one if needed) and verify exactly as the Vercel step does.`;

const RESULT = `Finish by ending your final message with exactly one line:
MARKETER_SETUP_RESULT {"provider":"${DEPLOY_PROVIDER}","status":"connected","url":"<production url>","target":"<target>"}
Only report status connected after the curl verification succeeded. If blocked
by something only the user can do, state the single action needed and stop.`;

export function deployWorkspaceTask(target: DeployTarget): string {
  const steps =
    target === "vercel"
      ? VERCEL_STEPS
      : target === "cloudflare"
        ? CLOUDFLARE_STEPS
        : RAILWAY_STEPS;
  return [COMMON, steps, RESULT.replace("<target>", target)].join("\n\n");
}
