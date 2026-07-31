import type { GoogleOAuthSetupRecipe } from "@chief/google-oauth-connector";
import { googleApiLibraryUrl } from "@chief/google-oauth-connector";

interface GoogleOAuthBrowserPromptOptions {
  recipe: GoogleOAuthSetupRecipe;
  afterCaptureInstruction: string;
  lockedAuthUser?: string;
}

function googleOAuthBrowserInstructions({
  recipe,
  afterCaptureInstruction,
  lockedAuthUser,
}: GoogleOAuthBrowserPromptOptions) {
  const clientName = `Chief - ${recipe.name}`;
  const services = recipe.services
    .map((service) => `${service.name} (${googleApiLibraryUrl(service)})`)
    .join(" and ");

  return [
    `Use browser.snapshot, browser.open, browser.click, browser.fill, browser.select, and browser.press as ordinary agent-browser tools. Prefer snapshot @refs and refresh them after every navigation or material UI change. The Google account the human selected is locked for this attempt${lockedAuthUser ? ` as browser identity authuser=${lockedAuthUser}` : ""}. Chief's host enforces that identity on every Google Cloud and OAuth URL. Never open the account menu, switch to another remembered identity, or try to change authuser. If the account cannot access the intended project, make no changes; return to Google's account chooser for the same Cloud URL and pause for the human to choose again.`,
    "Establish the Cloud project before making any mutation. Treat the project in Google's post-login URL, the current selector, and any remembered default as untrusted context: none of them counts as a human selection. Never infer a project from recency or a name such as Chief. If the human has not explicitly selected a project in this setup conversation and more than one is available, use the structured multiple-choice question tool to list the visible project names and IDs and ask which project should own this integration. Do not ask in ordinary chat prose. Create a project only when the human explicitly selects that option. Once chosen, lock that project ID, preserve its project query parameter on every Google Cloud URL, and verify it before every mutation. If it becomes unavailable, stop rather than substituting another project.",
    `Complete this Google OAuth recipe in the locked project: enable ${services}; configure Google Auth Platform at https://console.cloud.google.com/auth/overview; and use a Desktop app OAuth client dedicated to this integration. The exact client name is ${clientName}. First open https://console.cloud.google.com/auth/clients with the locked project parameter and check for an exact Desktop app match. If one or more exact matches already exist, open one of them and do not create another client. Only when no exact match exists, create one at https://console.cloud.google.com/auth/clients/create. Never reuse a differently named client or a client belonging to another Google service.`,
    `From Google's client-created dialog or the exact ${clientName} client's edit page, call googleOAuth.captureClient with the current session and attempt IDs. Do not click Download JSON, add or inspect a client secret yourself, or inspect any credential value. The trusted host creates a fresh secret on that same client when Google has masked the original and stores it without exposing its ID or secret to you. ${afterCaptureInstruction}`,
    "Operate Google Cloud yourself after the human has chosen the account and project. Pause only if Google asks for a password, passkey, MFA, account sign-in, consent, or an explicit account/project choice that only the human can make.",
  ];
}

/** Shared continuation after the human selects a Google account. */
export function googleOAuthAuthenticatedBrowserPrompt(
  options: GoogleOAuthBrowserPromptOptions,
) {
  return [
    "Google OAuth authentication finished and browser control is now yours. Continue immediately; do not ask the user to tell you they are ready and do not call googleOAuth.provisionClient again.",
    ...googleOAuthBrowserInstructions(options),
  ].join("\n\n");
}

/** Fresh-agent continuation after an interrupted Google OAuth browser run. */
export function googleOAuthInterruptedBrowserPrompt(
  options: GoogleOAuthBrowserPromptOptions,
) {
  return [
    "Resume the interrupted Google OAuth setup from the visible browser page. Inspect the current page and continue immediately without asking the user to repeat completed work or tell you they are ready. Do not call googleOAuth.provisionClient again.",
    ...googleOAuthBrowserInstructions(options),
  ].join("\n\n");
}
