import {
  githubBrowserUrlSchema,
  githubCloneTokenSchema,
  githubConnectionSchema,
  githubRepositoryListSchema,
} from "@chief/relay-contracts";

import type { RelayClientOptions } from "./relay-client-options";
import { RelayClientBase } from "./relay-client-base";

/** The workspace's GitHub connection, held by the relay. */
export class RelayGitHubClient extends RelayClientBase {
  constructor(options: RelayClientOptions) {
    super(options);
  }

  connection() {
    return this.fetchJson(this.workspaceUrl("github"), githubConnectionSchema);
  }

  /** A browser URL that creates this workspace's own GitHub App. */
  async setupUrl(name: string) {
    return (
      await this.fetchJson(
        this.workspaceUrl("github/setup"),
        githubBrowserUrlSchema,
        true,
        this.post({ name }),
      )
    ).url;
  }

  /** A browser URL where GitHub asks which repositories to share. */
  async installUrl() {
    return (
      await this.fetchJson(
        this.workspaceUrl("github/install"),
        githubBrowserUrlSchema,
        true,
        this.post({}),
      )
    ).url;
  }

  async repositories() {
    return (
      await this.fetchJson(
        this.workspaceUrl("github/repositories"),
        githubRepositoryListSchema,
      )
    ).repositories;
  }

  /** A short-lived, read-only token for cloning one connected repository. */
  cloneToken(repository: string) {
    return this.fetchJson(
      this.workspaceUrl("github/clone-token"),
      githubCloneTokenSchema,
      true,
      this.post({ repository }),
    );
  }

  private post(body: { name?: string; repository?: string }): RequestInit {
    return {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }
}
