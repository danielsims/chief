export class WorkspaceAuthorization<Client extends object> {
  private readonly workspaces = new WeakMap<Client, string | null>();

  connect(client: Client) {
    this.workspaces.set(client, null);
  }

  authorize(client: Client, workspaceId: string) {
    if (!this.workspaces.has(client))
      throw new Error("Client is not connected.");
    const previous = this.workspaces.get(client);
    this.workspaces.set(client, workspaceId);
    return previous;
  }

  canReceive(client: Client, workspaceId: string) {
    return this.workspaces.get(client) === workspaceId;
  }
}

export function capabilityWhoamiUrl(
  apiBaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  let base: URL;
  try {
    base = new URL(apiBaseUrl);
  } catch {
    throw new Error("Workspace capability endpoint is invalid.");
  }
  const configured = environment.CHIEF_AGENT_TOOLS_ORIGIN?.trim();
  if (configured) {
    let expected: URL;
    try {
      expected = new URL(configured);
    } catch {
      throw new Error("CHIEF_AGENT_TOOLS_ORIGIN is invalid.");
    }
    if (base.origin !== expected.origin) {
      throw new Error(
        "Workspace capability endpoint does not match CHIEF_AGENT_TOOLS_ORIGIN.",
      );
    }
  } else {
    const localhost =
      base.hostname === "localhost" ||
      base.hostname === "127.0.0.1" ||
      base.hostname === "[::1]";
    if (!(
      localhost && environment.CHIEF_ALLOW_LOCAL_CAPABILITY_ENDPOINT === "1"
    )) {
      throw new Error(
        "Configure CHIEF_AGENT_TOOLS_ORIGIN before using a hosted workspace capability endpoint.",
      );
    }
  }
  if (
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      environment.CHIEF_ALLOW_LOCAL_CAPABILITY_ENDPOINT !== "1")
  ) {
    throw new Error("Workspace capability endpoint must use HTTPS.");
  }
  return new URL("/agent-tools/whoami", base);
}
