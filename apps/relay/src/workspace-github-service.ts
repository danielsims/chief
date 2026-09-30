import { z } from "zod";

import type {
  GitHubConnection,
  GitHubInstallation,
  Principal,
} from "@chief/relay-contracts";
import {
  githubAppSetupCommandSchema,
  githubCloneTokenCommandSchema,
  githubInstallationSchema,
} from "@chief/relay-contracts";

import type { GitHubAppCredentials } from "./github-app";
import {
  GitHubApi,
  githubAppCredentialsSchema,
  relayGitHubApp,
} from "./github-app";
import { signGitHubTicket } from "./github-tickets";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { WorkspaceSecretStore } from "./workspace-secret-store";

const APP_SECRET = "github-app";
// Installations are private workspace state, out of reach of the secrets API,
// so a workspace can only hold installations its owner verifiably installed.
const INSTALLATIONS_KEY = "github:installations";

const storedAppSchema = githubAppCredentialsSchema;
const installationListSchema = z.array(githubInstallationSchema);

const appStoreInputSchema = githubAppCredentialsSchema;
const installationInputSchema = z.object({
  installationId: z.number().int().positive(),
  code: z.string().min(1),
});

export class WorkspaceGitHubService {
  private readonly channels: WorkspaceChannelStore;
  private readonly secrets: WorkspaceSecretStore;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly github = new GitHubApi(),
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
    this.secrets = new WorkspaceSecretStore(storage, env.RELAY_SECRET_KEY);
  }

  async connection(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    const relayApp = relayGitHubApp(this.env);
    const workspaceApp = relayApp
      ? null
      : await this.workspaceApp(context.workspaceId);
    const app = relayApp ?? workspaceApp;
    const connection: GitHubConnection = {
      app: relayApp ? "relay" : workspaceApp ? "workspace" : null,
      ...(app ? { appSlug: app.slug } : undefined),
      canManage: this.isOwner(context.principal),
      installations: await this.installations(),
    };
    return json(connection);
  }

  /** Starts creating a private GitHub App for a relay that has none. */
  async setup(request: Request) {
    const context = readTrustedContext(request);
    const principal = this.requireOwner(context.principal);
    if (await this.app(context.workspaceId)) {
      throw new HttpError(
        409,
        "github_app_exists",
        "GitHub is already set up for this workspace.",
      );
    }
    const { name } = githubAppSetupCommandSchema.parse(
      await parseJson(request),
    );
    const ticket = await signGitHubTicket(this.env.RELAY_SECRET_KEY, {
      purpose: "setup",
      principal,
      name,
    });
    const url = new URL("/github/setup", publicOrigin(this.env, request.url));
    url.searchParams.set("ticket", ticket);
    return json({ url: url.toString() });
  }

  async install(request: Request) {
    const context = readTrustedContext(request);
    const principal = this.requireOwner(context.principal);
    const app = await this.requireApp(context.workspaceId);
    return json({ url: await this.installUrl(app, principal) });
  }

  async repositories(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    const app = await this.requireApp(context.workspaceId);
    const lists = await Promise.all(
      (await this.installations()).map(async (installation) => {
        const { token } = await this.github.installationToken(
          app,
          installation.id,
          { permissions: { metadata: "read" } },
        );
        return await this.github.installationRepositories(token);
      }),
    );
    const repositories = lists
      .flat()
      .sort((left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
      );
    return json({ repositories });
  }

  /** A read-only token, scoped to one connected repository, for cloning it. */
  async cloneToken(request: Request) {
    const context = readTrustedContext(request);
    this.channels.requirePrincipalMember(context.principal);
    const { repository } = githubCloneTokenCommandSchema.parse(
      await parseJson(request),
    );
    const app = await this.requireApp(context.workspaceId);
    const [owner = "", name = ""] = repository.split("/");
    const installationId = await this.github.repositoryInstallation(
      app,
      owner,
      name,
    );
    const connected = new Set((await this.installations()).map(({ id }) => id));
    if (!installationId || !connected.has(installationId)) {
      throw new HttpError(
        404,
        "github_repository_not_connected",
        "Chief can't reach this repository. Share it with Chief on GitHub first.",
      );
    }
    return json(
      await this.github.installationToken(app, installationId, {
        repositories: [name],
        permissions: { contents: "read", metadata: "read" },
      }),
      { headers: { "cache-control": "no-store" } },
    );
  }

  /** Stores the app GitHub created from the manifest, then continues to install it. */
  async storeApp(request: Request) {
    const context = readTrustedContext(request);
    const principal = this.requireOwner(context.principal);
    if (await this.app(context.workspaceId)) {
      throw new HttpError(
        409,
        "github_app_exists",
        "GitHub is already set up for this workspace.",
      );
    }
    const app = appStoreInputSchema.parse(await parseJson(request));
    await this.secrets.set(
      context.workspaceId,
      APP_SECRET,
      JSON.stringify(app),
    );
    return json({ url: await this.installUrl(app, principal) });
  }

  /**
   * Links an installation only after GitHub confirms the person who started
   * the flow can access it, so no workspace can claim someone else's.
   */
  async addInstallation(request: Request) {
    const context = readTrustedContext(request);
    this.requireOwner(context.principal);
    const { installationId, code } = installationInputSchema.parse(
      await parseJson(request),
    );
    const app = await this.requireApp(context.workspaceId);
    const userToken = await this.github.userToken(app, code);
    if (
      !(await this.github.userCanAccessInstallation(userToken, installationId))
    )
      throw new HttpError(
        403,
        "github_installation_denied",
        "Your GitHub account can't access that installation.",
      );
    const installation = await this.github.installation(app, installationId);
    const installations = (await this.installations()).filter(
      ({ id }) => id !== installation.id,
    );
    await this.storage.put(INSTALLATIONS_KEY, [...installations, installation]);
    return json({ installation });
  }

  private async installUrl(app: GitHubAppCredentials, principal: Principal) {
    if (principal.kind !== "user") throw new Error("Expected a user.");
    const ticket = await signGitHubTicket(this.env.RELAY_SECRET_KEY, {
      purpose: "install",
      principal,
    });
    const url = new URL(
      `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`,
    );
    url.searchParams.set("state", ticket);
    return url.toString();
  }

  private async installations(): Promise<GitHubInstallation[]> {
    const stored = installationListSchema.safeParse(
      await this.storage.get(INSTALLATIONS_KEY),
    );
    return stored.success ? stored.data : [];
  }

  private async app(workspaceId: string) {
    return relayGitHubApp(this.env) ?? (await this.workspaceApp(workspaceId));
  }

  private async requireApp(workspaceId: string) {
    const app = await this.app(workspaceId);
    if (!app) {
      throw new HttpError(
        409,
        "github_not_set_up",
        "Set up GitHub for this workspace first.",
      );
    }
    return app;
  }

  private async workspaceApp(workspaceId: string) {
    const value = await this.secrets.get(workspaceId, APP_SECRET);
    if (!value) return null;
    const parsed = storedAppSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  }

  private isOwner(principal: Principal) {
    return (
      principal.kind === "user" &&
      this.channels.memberRole("user", principal.userId) === "owner"
    );
  }

  private requireOwner(principal: Principal) {
    if (principal.kind !== "user" || !this.isOwner(principal)) {
      throw new HttpError(
        403,
        "github_owner_required",
        "Only a workspace owner can connect GitHub.",
      );
    }
    return principal;
  }
}

/** The address people reach this relay at, which GitHub sends them back to. */
export function publicOrigin(env: Env, requestUrl: string) {
  return (env.RELAY_PUBLIC_URL ?? new URL(requestUrl).origin).replace(
    /\/$/u,
    "",
  );
}
