export type IntegrationSetupPhase =
  | "prepare-connection"
  | "authenticated-session"
  | "project"
  | "enable-api"
  | "auth-platform"
  | "create-client"
  | "create-credential"
  | "save-client"
  | "authorize"
  | "verify"
  | "complete";

export interface IntegrationSetupPlanStep {
  readonly id: string;
  readonly label: string;
  readonly phase: IntegrationSetupPhase;
}

export interface BrowserCredentialSetupRecipe {
  readonly id: string;
  readonly domain: string;
  readonly name: string;
  readonly providerPage: string;
  readonly credentialLabel: string;
  readonly agentInstructions: string;
  readonly integration: {
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly specUrl: string;
    readonly baseUrl: string;
    readonly family: string;
  };
  readonly steps: readonly IntegrationSetupPlanStep[];
}

export interface PreparedIntegrationSetup {
  readonly integrationSlug?: string;
  readonly recipeId: string;
}

const sharedTokenSteps = (
  provider: string,
  credential: string,
): readonly IntegrationSetupPlanStep[] => [
  {
    id: "prepare-connection",
    label: `Prepare the ${provider} connection`,
    phase: "prepare-connection",
  },
  {
    id: "authenticated-session",
    label: `Sign in to ${provider}`,
    phase: "authenticated-session",
  },
  {
    id: "create-credential",
    label: `Create the dedicated ${credential}`,
    phase: "create-credential",
  },
  {
    id: "save-client",
    label: "Save the credential in Chief",
    phase: "save-client",
  },
  {
    id: "verify",
    label: `Verify the ${provider} connection`,
    phase: "verify",
  },
];

export const githubSetupRecipe: BrowserCredentialSetupRecipe = {
  id: "github",
  domain: "github.com",
  name: "GitHub",
  providerPage: "https://github.com/settings/personal-access-tokens/new",
  credentialLabel: "access token",
  agentInstructions: `GitHub browser credential specifics:
- Chief has already prepared the locked GitHub REST connection for this setup attempt. Do not call Executor connection-creation tools, open a bearer-token handoff, or ask the user to paste a token.
- Open the prepared fine-grained token page with integration.openProviderPage. If sign-in is required, ask the human only to complete sign-in, passkey, MFA, or account confirmation, then end the turn. Chief resumes you automatically on the same page. Never switch GitHub identities yourself.
- After sign-in, you own the entire token form. Never tell the human to create, configure, or copy the token. Inspect the visible page and use browser.snapshot, browser.click, browser.fill, browser.select, and browser.press to complete it. Use browser.select for native select fields such as Expiration; do not repeatedly guess through their options with click or keyboard commands.
- Identify the single repository that backs this workspace from the workspace context and GitHub's visible repository choices. If that repository is genuinely ambiguous, use the structured multiple-choice question tool to ask which repository Chief may access. Explain that access will be limited to that repository. Do not ask the human to operate the repository selector.
- Name the token exactly Chief - <repository name>, preserving the repository's visible name. Set its description to: Created by Chief for <repository name> on <today in YYYY-MM-DD>. Repository-scoped access for code and pull request changes.
- Choose Only select repositories and select only the confirmed repository. Never choose All repositories. Grant only Metadata read, Contents read and write, and Pull requests read and write. Metadata may be mandatory. Do not grant Actions, Administration, Workflows, or another permission unless the user has explicitly requested a task that requires it.
- In GitHub's Permissions section, open Add permissions, choose Contents and Pull requests, then close the picker. GitHub adds Metadata read-only automatically. For both Contents and Pull requests, open the Access: Read-only menu and choose Read and write. Re-snapshot after every picker or menu change because refs expire. Confirm the page shows Repositories (3), Contents read and write, Metadata read-only, and Pull requests read and write before generating the token.
- Choose GitHub's 90-day expiration with browser.select and tell the user its exact date in one short chat line. Create the token yourself. When GitHub displays it once, leave the page open and call integration.captureGeneratedCredential with only the current sessionId and setup attemptId. Never read, copy, paste, or narrate the token. Then verify with GitHub's current-user endpoint and persist the verified login and numeric user id.`,
  integration: {
    slug: "github-rest",
    name: "GitHub REST API",
    description: "GitHub repositories, pull requests, releases, and metadata.",
    specUrl:
      "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    baseUrl: "https://api.github.com",
    family: "github",
  },
  steps: sharedTokenSteps("GitHub", "access token"),
};

export const vercelSetupRecipe: BrowserCredentialSetupRecipe = {
  id: "vercel",
  domain: "vercel.com",
  name: "Vercel",
  providerPage: "https://vercel.com/account/tokens",
  credentialLabel: "access token",
  agentInstructions: `Vercel browser credential specifics:
- Chief has already prepared the locked Vercel REST connection for this setup attempt. Do not call Executor connection-creation tools, open a bearer-token handoff, or ask the user to paste a token.
- Open the prepared token page with integration.openProviderPage. If sign-in is required, ask the human only to complete sign-in, passkey, MFA, or account confirmation, then end the turn. Chief resumes you automatically on the same page. Never switch Vercel identities yourself.
- After sign-in, operate the entire token form yourself. Never tell the human to create, configure, copy, or paste the token. Name it Chief - <workspace name>. If several personal or team scopes are visible and the intended owner is ambiguous, use the structured multiple-choice question tool before creating it.
- When Vercel displays the token once, leave the page open and call integration.captureGeneratedCredential with only the current sessionId and setup attemptId. Never inspect or narrate its value. Then verify with Vercel's current-user endpoint and persist the verified user or team identity.`,
  integration: {
    slug: "vercel-rest",
    name: "Vercel REST API",
    description: "Vercel projects, deployments, domains, and configuration.",
    specUrl: "https://openapi.vercel.sh/",
    baseUrl: "https://api.vercel.com",
    family: "vercel",
  },
  steps: sharedTokenSteps("Vercel", "access token"),
};

export const browserCredentialSetupRecipes = [
  githubSetupRecipe,
  vercelSetupRecipe,
] as const;

export function browserCredentialSetupRecipe(
  identifier: string,
): BrowserCredentialSetupRecipe | undefined {
  const normalized = identifier.trim().toLowerCase();
  return browserCredentialSetupRecipes.find(
    (recipe) => recipe.domain === normalized || recipe.id === normalized,
  );
}

export function integrationSetupStepIndex(
  steps: readonly IntegrationSetupPlanStep[],
  phase: IntegrationSetupPhase,
): number {
  if (phase === "complete") return steps.length;
  const index = steps.findIndex((step) => step.phase === phase);
  return index < 0 ? 0 : index;
}
