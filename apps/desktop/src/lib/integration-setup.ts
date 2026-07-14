// Agentic integration setup: prompt construction for the runtime's setup
// agent, and parsing of the machine-readable lines it emits (verified
// results, structured input requests).

import type { ContentBlock, InputRequest } from "@chief/agent-runtime/types";

import type { ChatItem } from "./runtime";

export const SETUP_AGENT_ID = "setup";

export const SETUP_RESULT_MARKER = "CHIEF_SETUP_RESULT";

export const INPUT_REQUEST_MARKER = "CHIEF_INPUT_REQUEST";

/** The runtime confirms stored input with a user-turn starting with this. */
export const INPUT_PROVIDED_PREFIX = "Provided:";

export interface SetupResult {
  provider: string;
  status: string;
  displayName?: string;
  externalId?: string;
  propertyId?: string;
  propertyName?: string;
  accountName?: string;
  /** Up to 14 daily points of a headline metric, for the live data preview. */
  series?: { date: string; value: number }[];
  metricLabel?: string;
  [key: string]: unknown;
}

export interface SetupIntegration {
  domain: string;
  name: string;
}

export interface AnalyticsSnapshotInput {
  provider: string;
  period: string;
  activeUsers?: number;
  sessions?: number;
  pageViews?: number;
  conversions?: number;
  revenue?: number;
  metricLabel?: string;
  series?: { date: string; value: number }[];
  rangeMetrics?: {
    key: string;
    period: string;
    activeUsers?: number;
    sessions?: number;
    pageViews?: number;
    conversions?: number;
    revenue?: number;
  }[];
}

export function setupChatId(domain: string) {
  return `setup-${domain}`;
}

/** Extracts the machine-readable result line from an assistant message, if present. */
export function parseSetupResult(text: string): SetupResult | null {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(SETUP_RESULT_MARKER));
  if (!line) return null;
  try {
    const parsed = JSON.parse(
      line.slice(SETUP_RESULT_MARKER.length).trim(),
    ) as SetupResult;
    return typeof parsed.provider === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Strips machine-readable marker lines so they never render in chat UI. */
export function stripSetupResult(text: string): string {
  return text
    .split("\n")
    .filter((l) => {
      const trimmed = l.trim();
      return (
        !trimmed.startsWith(SETUP_RESULT_MARKER) &&
        !trimmed.startsWith(INPUT_REQUEST_MARKER)
      );
    })
    .join("\n")
    .trimEnd();
}

/** Removes marker lines from text blocks and drops blocks left empty. */
export function withoutMarkerLines(blocks: ContentBlock[]): ContentBlock[] {
  return blocks
    .map((block) =>
      block.type === "text"
        ? { ...block, text: stripSetupResult(block.text) }
        : block,
    )
    .filter((block) => block.type !== "text" || block.text.trim().length > 0);
}

export function parseInputRequest(text: string): InputRequest | null {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(INPUT_REQUEST_MARKER));
  if (!line) return null;
  try {
    const parsed = JSON.parse(
      line.slice(INPUT_REQUEST_MARKER.length).trim(),
    ) as InputRequest;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.title !== "string" ||
      !Array.isArray(parsed.fields) ||
      parsed.fields.some(
        (f) => typeof f.key !== "string" || typeof f.label !== "string",
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The latest unanswered input request in a transcript: a request is pending
 * until a later user turn confirms values were provided (the runtime sends
 * that turn) or it was answered locally this mount.
 */
export function findPendingInputRequest(
  items: ChatItem[],
  answered: ReadonlySet<string>,
): InputRequest | null {
  let pending: InputRequest | null = null;
  for (const item of items) {
    if (item.kind === "user") {
      if (item.text.startsWith(INPUT_PROVIDED_PREFIX)) pending = null;
      continue;
    }
    for (const block of item.event.content) {
      if (block.type !== "text") continue;
      const request = parseInputRequest(block.text);
      if (request && !answered.has(request.id)) pending = request;
    }
  }
  return pending;
}

const GOOGLE_CLIENT_FIELDS = [
  {
    key: "clientId",
    label: "Client ID",
    type: "text" as const,
    save: { envKey: "CHIEF_GOOGLE_OAUTH_CLIENT_ID" },
  },
  {
    key: "clientSecret",
    label: "Client secret",
    type: "secret" as const,
    save: { envKey: "CHIEF_GOOGLE_OAUTH_CLIENT_SECRET" },
  },
];

const GOOGLE_CLIENT_STEPS = [
  {
    text: "Sign in to the Google Cloud **credentials page**.",
    url: "https://console.cloud.google.com/apis/credentials",
  },
  {
    text: "Click **Create credentials**, then **OAuth client ID**. Create a new one even if others are listed.",
  },
  { text: "Type: **Desktop app**. Name: **Chief**. Click **Create**." },
  {
    text: "Copy the **Client ID** and **Client secret** into the fields below.",
  },
];

/**
 * Credentials that must exist BEFORE the setup agent is worth starting.
 * Google blocks agent-driven flows without an app key, so collecting these
 * up front replaces a doomed agent run with one form. The connect UI checks
 * which keys are already stored and only asks for what is missing.
 */
const PRE_CONNECT_REQUIREMENTS: Record<string, InputRequest> = {
  "analytics.googleapis.com": {
    id: "google-oauth-client",
    title: "Allow Chief to read your Google Analytics",
    reason:
      "Google needs an app key, created once in your Google Cloud account. Nothing in your Analytics changes; you approve read-only access right after.",
    steps: GOOGLE_CLIENT_STEPS,
    fields: GOOGLE_CLIENT_FIELDS,
  },
  "googleads.googleapis.com": {
    id: "google-ads-access",
    title: "Allow Chief to call Google Ads",
    reason:
      "Google Ads needs the developer token from your Ads manager account plus the Google app key. Both are stored on this Mac only.",
    steps: [
      {
        text: "Open the **API Center** in your Google Ads manager account.",
        url: "https://ads.google.com/aw/apicenter",
      },
      { text: "Copy the **Developer token** into the field below." },
      ...GOOGLE_CLIENT_STEPS,
    ],
    fields: [
      {
        key: "developerToken",
        label: "Developer token",
        type: "secret" as const,
        save: { envKey: "CHIEF_GOOGLE_ADS_DEVELOPER_TOKEN" },
      },
      ...GOOGLE_CLIENT_FIELDS,
    ],
  },
};

/** Google APIs share the OAuth client requirement even when we have no
 * integration-specific extras for them. */
export function preConnectRequirement(domain: string): InputRequest | null {
  const specific = PRE_CONNECT_REQUIREMENTS[domain];
  if (specific) return specific;
  if (domain.endsWith("googleapis.com") || domain.endsWith("google.com")) {
    return PRE_CONNECT_REQUIREMENTS["analytics.googleapis.com"]!;
  }
  return null;
}

export function requirementEnvKeys(request: InputRequest): string[] {
  return request.fields
    .map((field) => ("envKey" in field.save ? field.save.envKey : null))
    .filter((key): key is string => Boolean(key));
}

/**
 * Provider-specific guidance layered onto the generic task when the
 * integration is known to have a preferred local path. Everything else is
 * discovered from the integrations.sh facts at run time.
 */
const PROVIDER_HINTS: Record<string, string> = {
  "googleads.googleapis.com": `Google Ads specifics:
- Known facts, do not rediscover them: integrations.sh has no entry for this domain, so skip the registry lookups entirely. Google blocks its shared gcloud client from the adwords scope exactly like Analytics; NEVER run a plain gcloud login or print-access-token with adwords scopes.
- Everything you need was collected for this workspace before this run. Source "$CHIEF_SECRETS_FILE" for CHIEF_GOOGLE_OAUTH_CLIENT_ID, CHIEF_GOOGLE_OAUTH_CLIENT_SECRET and CHIEF_GOOGLE_ADS_DEVELOPER_TOKEN. Build "$CHIEF_WORKSPACE_DIR/.runtime/google-oauth-client.json" from the client values if it does not exist (same printf as the Analytics flow).
- Log in exactly once with --client-id-file and the UNION of scopes so existing Analytics access survives:
  gcloud auth application-default login --client-id-file="$CHIEF_WORKSPACE_DIR/.runtime/google-oauth-client.json" --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/adwords"
  This opens the browser for consent; say so in one line and wait for the command to exit. Never loop with waiting messages.
- Verify: POST https://googleads.googleapis.com/v20/customers:listAccessibleCustomers with headers "Authorization: Bearer <ADC token>" and "developer-token: $CHIEF_GOOGLE_ADS_DEVELOPER_TOKEN". Check .error first. If the version is rejected, try the adjacent version numbers. A DEVELOPER_TOKEN_NOT_APPROVED style error means the token only works on test accounts yet; say that in one line and stop.
- If the account has no accessible customers, say the user has no Google Ads account reachable from this Google login and suggest removing this source. Do not invent accounts and do not loop.
- Result line: provider "googleads.googleapis.com", externalId the first customer id, displayName its descriptive name.`,
  "analytics.googleapis.com": `Google Analytics specifics:
- Known fact, do not rediscover it by failing: Google blocks its shared gcloud OAuth client from requesting the Analytics scope, so a plain \`gcloud auth application-default login --scopes=...\` dead-ends at "This app is blocked". The analytics-mcp server authenticates through the same Application Default Credentials, so it does not avoid this either. Never attempt the plain login; use the user's own OAuth client from the start.
- Auth sequence:
  1. If "$GOOGLE_APPLICATION_CREDENTIALS" already exists, check what it reaches first. It belongs only to the active Chief workspace. On a valid account, proceed straight to verification and the series report. Never inspect or use "$HOME/.config/gcloud/application_default_credentials.json", "$HOME/.chief/secrets.env", or credentials from another workspace.
  2. If "$CHIEF_WORKSPACE_DIR/.runtime/google-oauth-client.json" is missing, emit this input request IMMEDIATELY, in your first message if possible (the Client ID and secret appear on screen in Google's final dialog, so the user only clicks and pastes):
CHIEF_INPUT_REQUEST {"id":"google-oauth-client","title":"Allow Chief to read your Google Analytics","reason":"Google needs an app key, created once in your Google Cloud account. Nothing in your Analytics changes; you approve read-only access right after.","steps":[{"text":"Sign in to the Google Cloud **credentials page**.","url":"https://console.cloud.google.com/apis/credentials"},{"text":"Click **Create credentials**, then **OAuth client ID**. Create a new one even if others are listed."},{"text":"Type: **Desktop app**. Name: **Chief**. Click **Create**."},{"text":"Copy the **Client ID** and **Client secret** into the fields below."}],"fields":[{"key":"clientId","label":"Client ID","type":"text","save":{"envKey":"CHIEF_GOOGLE_OAUTH_CLIENT_ID"}},{"key":"clientSecret","label":"Client secret","type":"secret","save":{"envKey":"CHIEF_GOOGLE_OAUTH_CLIENT_SECRET"}}]}
     Then keep working in parallel while the user completes it: fetch the integration facts and install gcloud. Once nothing remains that can proceed without the values, say in one short line that you are waiting for the form, then END YOUR TURN. Do not poll, re-check files, or send repeated status updates; the app messages you when the values are saved.
  3. After the confirmation message, build the ephemeral client file without printing the values:
. "$CHIEF_SECRETS_FILE" && printf '{"installed":{"client_id":"%s","client_secret":"%s","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","redirect_uris":["http://localhost"]}}' "$CHIEF_GOOGLE_OAUTH_CLIENT_ID" "$CHIEF_GOOGLE_OAUTH_CLIENT_SECRET" > "$CHIEF_WORKSPACE_DIR/.runtime/google-oauth-client.json" && chmod 600 "$CHIEF_WORKSPACE_DIR/.runtime/google-oauth-client.json"
  4. Log in exactly once:
  gcloud auth application-default login --client-id-file="$CHIEF_WORKSPACE_DIR/.runtime/google-oauth-client.json" --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/analytics.readonly"
  This opens the user's browser for consent and binds a localhost callback; both work here. Say the browser is opening and wait for the command to exit. Desktop clients need no redirect URI setup. Do not use --no-browser or --remote-bootstrap.
- CLOUDSDK_CONFIG and GOOGLE_APPLICATION_CREDENTIALS already point at this workspace's private Google configuration. Do not override them. This is the enforced tenant boundary.
- Verify by listing account summaries on the Admin API, then confirm data access with a minimal runReport (activeUsers, last 7 days) on the Data API.
- Verification discipline: every Google API response may be an error object. Check .error FIRST; never use jq patterns like .accountSummaries[]? that silently turn a 403 into an empty result. Known errors and their fixes, all yours to perform:
  - SERVICE_DISABLED / "has not been used in project": the Analytics APIs are off in the client's project. Enable them yourself with the ADC token and retry after about 15 seconds. The project number is the digits before the dash in the client id:
    token=$(gcloud auth application-default print-access-token); for svc in analyticsadmin.googleapis.com analyticsdata.googleapis.com; do curl -s -X POST "https://serviceusage.googleapis.com/v1/projects/<PROJECT_NUMBER>/services/$svc:enable" -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "{}"; done
    (Note for zsh: write $svc inside the URL as \${svc} or the :e gets eaten as a modifier.)
  - A quota project complaint: run gcloud auth application-default set-quota-project <PROJECT_NUMBER> and retry.
  - Genuinely empty accountSummaries with no .error: consent was given with a Google account that has no Analytics access. Rerun the login command and tell the user in one line to pick the account their Analytics lives on.
- If several GA4 properties exist, list them briefly (name and id) and ask which one to use. If exactly one, use it and say which.
- In the result line use provider id "google-analytics" and include propertyId, propertyName and accountName.`,
};

export function isGoogleAnalyticsResult(result: SetupResult): boolean {
  return (
    result.provider === "google-analytics" ||
    result.provider === "analytics.googleapis.com"
  );
}

/**
 * Persists a verified setup result to the workspace: Google Analytics keeps
 * its property-aware save path, every other provider goes through the
 * generic channel record. Mutations are injected so any page can reuse this.
 */
export async function persistSetupResult(
  result: SetupResult,
  deps: {
    saveProperty: (args: {
      propertyId: string;
      propertyName?: string;
    }) => Promise<unknown>;
    markConnected: (args: {
      provider: string;
      category?: string;
      displayName?: string;
      externalId?: string;
    }) => Promise<unknown>;
    saveSnapshot?: (args: AnalyticsSnapshotInput) => Promise<unknown>;
  },
  category?: string,
): Promise<void> {
  if (isGoogleAnalyticsResult(result) && result.propertyId) {
    await deps.saveProperty({
      propertyId: String(result.propertyId),
      propertyName:
        typeof result.propertyName === "string"
          ? result.propertyName
          : undefined,
    });
  } else {
    await deps.markConnected({
      provider: String(result.provider),
      category,
      displayName:
        typeof result.displayName === "string" ? result.displayName : undefined,
      externalId:
        typeof result.externalId === "string" ? result.externalId : undefined,
    });
  }

  const numeric = (key: string) =>
    typeof result[key] === "number" ? result[key] : undefined;
  const series = Array.isArray(result.series) ? result.series : undefined;
  if (
    deps.saveSnapshot &&
    (series?.length ||
      ["activeUsers", "sessions", "pageViews", "conversions", "revenue"].some(
        (key) => numeric(key) !== undefined,
      ))
  ) {
    await deps.saveSnapshot({
      provider: isGoogleAnalyticsResult(result)
        ? "google-analytics"
        : String(result.provider),
      period:
        typeof result.period === "string"
          ? result.period
          : series?.length
            ? `${series.length} D`
            : "30 D",
      ...(numeric("activeUsers") !== undefined
        ? { activeUsers: numeric("activeUsers") }
        : {}),
      ...(numeric("sessions") !== undefined
        ? { sessions: numeric("sessions") }
        : {}),
      ...(numeric("pageViews") !== undefined
        ? { pageViews: numeric("pageViews") }
        : {}),
      ...(numeric("conversions") !== undefined
        ? { conversions: numeric("conversions") }
        : {}),
      ...(numeric("revenue") !== undefined
        ? { revenue: numeric("revenue") }
        : {}),
      ...(typeof result.metricLabel === "string"
        ? { metricLabel: result.metricLabel }
        : {}),
      ...(series?.length ? { series } : {}),
    });
  }
}

export function integrationSetupTask(integration: SetupIntegration): string {
  const hints = PROVIDER_HINTS[integration.domain];
  return `Connect ${integration.name} (${integration.domain}) for this workspace using this machine. The user is watching your progress inside the app, so work autonomously and keep narration to one short line per step. Never use em dashes. The user may continue with other steps while you work; do not stop to wait for chat replies unless you asked a question.

Get the integration facts, in this order, moving to the next source if one stalls for about a minute:
1. \`npx -y integrations ${integration.domain} --json\` (the first run can be slow while npm installs the CLI).
2. \`curl -s https://raw.githubusercontent.com/UsefulSoftwareCo/integrations/main/domains/${integration.domain}/integrations.json\` (the full registry facts as JSON; the reliable HTTP fallback).
3. \`curl -s "https://integrations.sh/api/search?q=${integration.domain}"\` (summary only).
Do not invent other integrations.sh API paths; they return 404 pages.

Read surfaces[], credentials and auth, then pick the best setup path:
0. Values the user provided before this run are in "$CHIEF_SECRETS_FILE" and scoped to the active workspace; source it first and never ask for something already there. Never inspect global Google credentials or another workspace's files.
1. Prefer credential paths that keep secrets on this machine: provider CLI login, Application Default Credentials, local config files.
2. If the integration needs an API key or token only the user can see, request it with a single CHIEF_INPUT_REQUEST line as described in your instructions: web-only steps with a link on every clickable step, paste fields at a maximum. Never ask the user to run commands, dig through folders, move files or handle file paths.
3. You have full system access with no sandbox: installs, opening the user's browser and binding localhost callback ports all work. Install missing CLI tools with Homebrew when available; say what you are installing in one line first.
4. If you install from a tarball or installer instead, install into "$HOME/.chief/tools" (create it if needed) and use the absolute binary path in every later command; your working directory is not on PATH for future sessions.
5. When a login command opens the user's browser, say so in one line and wait for the command to exit while they complete consent. Never use no-browser or copy-this-command fallbacks; the browser flow works here.
6. Verify the connection with a real API call before declaring success. Summarize the verification in one line without dumping raw responses.
7. If truly blocked by something only the user can do, state the single specific action needed and stop.

When the connection is verified, end your final message with exactly one line:
${SETUP_RESULT_MARKER} {"provider":"${integration.domain}","status":"connected","displayName":"<human-readable account or workspace name>","externalId":"<primary id if the integration has one>"}
Add provider-specific identifier fields when they will be needed for reporting later. This line is machine-read; keep it valid single-line JSON.${hints ? `\n\n${hints}` : ""}`;
}
