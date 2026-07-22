export interface GoogleApiService {
  readonly name: string;
  readonly service: string;
}

/**
 * Describes provider setup only. OAuth consent scopes intentionally live in
 * the consuming integration, matching Executor's OAuth client model.
 */
export interface GoogleOAuthSetupRecipe {
  readonly id: string;
  readonly name: string;
  readonly services: readonly GoogleApiService[];
}

export interface GoogleOAuthClientIdentity {
  readonly grant: "authorization_code";
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly projectId?: string;
}

export type GoogleOAuthSetupPhase =
  | "authenticated-session"
  | "project"
  | "enable-api"
  | "auth-platform"
  | "create-client"
  | "save-client"
  | "authorize"
  | "verify"
  | "complete";

export interface GoogleOAuthSetupProgress {
  readonly phase: GoogleOAuthSetupPhase;
  readonly instruction: string;
  readonly service?: string;
}

export interface GoogleOAuthSetupPlanStep {
  readonly id: string;
  readonly label: string;
  readonly phase: GoogleOAuthSetupPhase;
  readonly service?: string;
}

export class GoogleOAuthSetupError extends Error {
  constructor(
    readonly code: "invalid-credentials",
    message: string,
    readonly instruction: string,
  ) {
    super(message);
    this.name = "GoogleOAuthSetupError";
  }
}
