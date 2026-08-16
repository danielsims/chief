import type {
  CredentialRequest,
  ShortLivedCredential,
} from "../project-types.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { GitHubProjectProviderAdapter } from "./github-adapter.js";

/**
 * Mints short-lived GitHub App installation tokens through the trusted host.
 * The broker holds no token: each request is minted fresh, scoped to the
 * repository being published, and expires in under an hour.
 */
export class GitHubAppCredentialBroker implements CredentialBroker {
  readonly id = "github-app-installation";

  constructor(private readonly adapter: GitHubProjectProviderAdapter) {}

  async request(request: CredentialRequest): Promise<ShortLivedCredential> {
    return this.adapter.createGitCredential(request);
  }
}
