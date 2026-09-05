import type {
  AttachmentUploadPayload,
  BrandProfile,
  ChannelDetail,
  ChannelRecord,
  CreateWorkspaceCommand,
  JsonValue,
  OnboardingTelemetryEvent,
  Prospect,
  RelayDiscovery,
  RelayProject,
  RelayProjectCreate,
  WorkspaceFile,
  WorkspaceId,
  WorkspaceInvite,
  WorkspaceInviteClaimResult,
  WorkspaceMember,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "@chief/relay-contracts";
import {
  attachmentUploadPayloadSchema,
  attachmentUploadResultSchema,
  brandProfileResultSchema,
  brandProfileSaveSchema,
  brandProfileSchema,
  channelActionResultSchema,
  channelCreateCommandSchema,
  channelDetailSchema,
  channelListResultSchema,
  channelMemberAddCommandSchema,
  conversationIdSchema,
  imageAssetDeleteResultSchema,
  isJsonString,
  onboardingTelemetryEventSchema,
  onboardingTelemetryReceiptSchema,
  organizationWorkspaceJoinResultSchema,
  parseJsonValue,
  prospectSaveSchema,
  prospectSchema,
  prospectsResultSchema,
  relayDiscoverySchema,
  relayProjectCreateSchema,
  relayProjectDeleteResultSchema,
  relayProjectSchema,
  relayProjectsResultSchema,
  workspaceDeleteResultSchema,
  workspaceFileSaveSchema,
  workspaceFileSchema,
  workspaceFilesResultSchema,
  workspaceFileUpdateSchema,
  workspaceIdSchema,
  workspaceInviteClaimResultSchema,
  workspaceInviteSchema,
  workspaceListResultSchema,
  workspaceMediaUploadSchema,
  workspaceMemberListSchema,
  workspaceSnapshotSchema,
  workspaceSwitchResultSchema,
} from "@chief/relay-contracts";

import type { RelayClientOptions, RelaySocket } from "./relay-client-options";
import { normalizedRelayOrigin, RelayClientError } from "./relay-client-error";

export class RelayClientBase {
  readonly workspaceId: WorkspaceId | null;
  protected readonly relayUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  protected readonly createWebSocket: (url: string) => RelaySocket;
  private discoveryRequest: Promise<RelayDiscovery> | null = null;

  constructor(protected readonly options: RelayClientOptions) {
    this.workspaceId = options.workspaceId
      ? workspaceIdSchema.parse(options.workspaceId)
      : null;
    this.relayUrl = normalizedRelayOrigin(options.relayUrl);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createWebSocket =
      options.createWebSocket ?? ((url) => new WebSocket(url));
  }

  discovery() {
    this.discoveryRequest ??= this.fetchJson(
      `${this.relayUrl}/.well-known/relay`,
      relayDiscoverySchema,
      false,
    );
    return this.discoveryRequest;
  }

  activeWorkspace(): Promise<WorkspaceSnapshot> {
    return this.fetchJson(
      new URL("/v1/me/workspace", this.relayUrl),
      workspaceSnapshotSchema,
    );
  }
  async uploadProfileImage(input: AttachmentUploadPayload) {
    return this.uploadImage(new URL("/v1/me/avatar", this.relayUrl), input);
  }
  async deleteProfileImage() {
    return this.deleteImage(new URL("/v1/me/avatar", this.relayUrl));
  }
  async uploadWorkspaceImage(input: AttachmentUploadPayload) {
    return this.uploadImage(this.workspaceUrl("logo"), input);
  }
  async deleteWorkspaceImage() {
    return this.deleteImage(this.workspaceUrl("logo"));
  }
  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return (
      await this.fetchJson(
        new URL("/v1/workspaces", this.relayUrl),
        workspaceListResultSchema,
      )
    ).workspaces;
  }
  async createWorkspace(command: CreateWorkspaceCommand, credential: string) {
    const secrets =
      command.agentRuntime === "vercel-eve"
        ? {}
        : command.inferenceProvider === "vercelAiGateway"
          ? { vercelAiGateway: credential }
          : { opencode: credential };
    return await this.fetchJson(
      new URL("/v1/workspaces", this.relayUrl),
      workspaceSnapshotSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: command, secrets }),
      },
    );
  }
  async recordOnboardingEvent(event: OnboardingTelemetryEvent) {
    return await this.fetchJson(
      new URL("/v1/onboarding/events", this.relayUrl),
      onboardingTelemetryReceiptSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(onboardingTelemetryEventSchema.parse(event)),
      },
    );
  }
  async switchWorkspace(workspaceId: WorkspaceId | string) {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(`/v1/workspaces/${encodeURIComponent(id)}/switch`, this.relayUrl),
      workspaceSwitchResultSchema,
      true,
      { method: "POST" },
    );
  }
  async deleteWorkspace(workspaceId: WorkspaceId | string) {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(`/v1/workspaces/${encodeURIComponent(id)}`, this.relayUrl),
      workspaceDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  async createWorkspaceInvite(input: {
    secret: string;
    conversationId?: string | null;
    expiresAt: string;
  }): Promise<WorkspaceInvite> {
    return await this.fetchJson(
      this.workspaceUrl("invites"),
      workspaceInviteSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          secret: input.secret,
          conversationId: input.conversationId ?? null,
          expiresAt: input.expiresAt,
        }),
      },
    );
  }

  async previewWorkspaceInvite(
    workspaceId: WorkspaceId | string,
    secret: string,
  ): Promise<WorkspaceInvite> {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(
        `/v1/workspaces/${encodeURIComponent(id)}/invites/preview`,
        this.relayUrl,
      ),
      workspaceInviteSchema,
      false,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      },
    );
  }

  async claimWorkspaceInvite(
    workspaceId: WorkspaceId | string,
    secret: string,
  ): Promise<WorkspaceInviteClaimResult> {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(
        `/v1/workspaces/${encodeURIComponent(id)}/invites/claim`,
        this.relayUrl,
      ),
      workspaceInviteClaimResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), secret }),
      },
    );
  }

  async joinOrganizationWorkspace(workspaceId: WorkspaceId | string) {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(
        `/v1/workspaces/${encodeURIComponent(id)}/organization-membership`,
        this.relayUrl,
      ),
      organizationWorkspaceJoinResultSchema,
      true,
      { method: "POST" },
    );
  }

  async listChannels(): Promise<ChannelRecord[]> {
    return (
      await this.fetchJson(
        this.workspaceUrl("channels"),
        channelListResultSchema,
      )
    ).channels;
  }

  async createChannel(input: {
    conversationId: string;
    name: string;
    isPrivate?: boolean;
  }): Promise<ChannelDetail> {
    return await this.fetchJson(
      this.workspaceUrl("channels"),
      channelDetailSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          channelCreateCommandSchema.parse({
            commandId: crypto.randomUUID(),
            protocolVersion: 1,
            occurredAt: new Date().toISOString(),
            payload: {
              conversationId: input.conversationId,
              name: input.name,
              isPrivate: input.isPrivate ?? false,
            },
          }),
        ),
      },
    );
  }

  async addChannelMembers(
    conversationId: string,
    members: readonly { kind: "user" | "agent"; principalId: string }[],
  ): Promise<void> {
    const conversation = conversationIdSchema.parse(conversationId);
    await this.fetchJson(
      this.workspaceUrl(
        `channels/${encodeURIComponent(conversation)}/members/add`,
      ),
      channelActionResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          channelMemberAddCommandSchema.parse({
            commandId: crypto.randomUUID(),
            protocolVersion: 1,
            occurredAt: new Date().toISOString(),
            payload: { conversationId: conversation, members },
          }),
        ),
      },
    );
  }

  async listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    return (
      await this.fetchJson(
        this.workspaceUrl("members"),
        workspaceMemberListSchema,
      )
    ).members;
  }

  async saveBrandProfile(input: {
    markdown: string;
    sourceUrls: string[];
    conversationId: string;
  }): Promise<BrandProfile> {
    return (
      await this.fetchJson(
        this.workspaceUrl("data/brand-profile"),
        brandProfileResultSchema,
        true,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(brandProfileSaveSchema.parse(input)),
        },
      )
    ).profile;
  }

  async loadBrandProfile(): Promise<BrandProfile | null> {
    const response = await this.fetchResponse(
      this.workspaceUrl("data/brand-profile"),
    );
    if (response.status === 204) return null;
    if (!response.ok) throw await RelayClientError.fromResponse(response);
    return brandProfileSchema.parse(await response.json());
  }

  async loadWorkspaceAsset(
    asset: { agentId: string; artifactId: string },
    signal?: AbortSignal,
  ): Promise<Blob> {
    const response = await this.fetchResponse(
      this.workspaceUrl(
        `agents/${encodeURIComponent(asset.agentId)}/artifacts/${encodeURIComponent(asset.artifactId)}`,
      ),
      true,
      { signal },
    );
    if (!response.ok) throw await RelayClientError.fromResponse(response);
    return response.blob();
  }

  async publishWorkspaceAsset(
    agentId: string,
    input: {
      name: string;
      contentType: string;
      contentBase64: string;
      conversationId: string;
    },
  ): Promise<WorkspaceFile> {
    return this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/artifacts`),
      workspaceFileSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(workspaceMediaUploadSchema.parse(input)),
      },
    );
  }

  async listWorkspaceFiles(): Promise<WorkspaceFile[]> {
    return (
      await this.fetchJson(
        this.workspaceUrl("files"),
        workspaceFilesResultSchema,
      )
    ).files;
  }

  async listProjects(): Promise<RelayProject[]> {
    return (
      await this.fetchJson(
        this.workspaceUrl("projects"),
        relayProjectsResultSchema,
      )
    ).projects;
  }

  async createProject(input: RelayProjectCreate): Promise<RelayProject> {
    return await this.fetchJson(
      this.workspaceUrl("projects"),
      relayProjectSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(relayProjectCreateSchema.parse(input)),
      },
    );
  }

  async deleteProject(projectId: string) {
    return await this.fetchJson(
      this.workspaceUrl(`projects/${encodeURIComponent(projectId)}`),
      relayProjectDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  async updateWorkspaceFile(
    fileId: string,
    input: { title: string; content: string; expectedVersion: number },
  ): Promise<WorkspaceFile> {
    return await this.fetchJson(
      this.workspaceUrl(`files/${encodeURIComponent(fileId)}`),
      workspaceFileSchema,
      true,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(workspaceFileUpdateSchema.parse(input)),
      },
    );
  }

  async saveWorkspaceFile(input: {
    id?: string;
    path: string;
    title: string;
    mimeType: string;
    content: string;
    conversationId: string;
    expectedVersion?: number;
  }): Promise<WorkspaceFile> {
    return await this.fetchJson(
      this.workspaceUrl("files"),
      workspaceFileSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(workspaceFileSaveSchema.parse(input)),
      },
    );
  }

  async listProspects(): Promise<Prospect[]> {
    return (
      await this.fetchJson(
        this.workspaceUrl("data/prospects"),
        prospectsResultSchema,
      )
    ).prospects;
  }

  async saveProspect(
    input: Parameters<typeof prospectSaveSchema.parse>[0],
  ): Promise<Prospect> {
    return await this.fetchJson(
      this.workspaceUrl("data/prospects"),
      // The relay returns the saved prospect record directly.
      prospectSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prospectSaveSchema.parse(input)),
      },
    );
  }

  private uploadImage(url: URL, input: AttachmentUploadPayload) {
    const payload = attachmentUploadPayloadSchema.parse(input);
    return this.fetchJson(url, attachmentUploadResultSchema, true, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  private deleteImage(url: URL) {
    return this.fetchJson(url, imageAssetDeleteResultSchema, true, {
      method: "DELETE",
    });
  }

  protected conversationUrl(conversationId: string, resource: string) {
    const workspaceId = this.requireWorkspaceId();
    const conversation = conversationIdSchema.parse(conversationId);
    return new URL(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversation)}/${resource}`,
      this.relayUrl,
    );
  }

  protected workspaceUrl(resource: string) {
    const workspaceId = this.requireWorkspaceId();
    return new URL(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/${resource}`,
      this.relayUrl,
    );
  }

  protected requireWorkspaceId() {
    if (!this.workspaceId) {
      throw new Error("Choose a workspace before using workspace resources.");
    }
    return this.workspaceId;
  }

  protected async fetchJson<T>(
    url: URL | string,
    schema: {
      parse: (value: JsonValue) => T;
    },
    authenticated = true,
    init: RequestInit = {},
  ) {
    const response = await this.fetchResponse(url, authenticated, init);
    if (!response.ok) throw await RelayClientError.fromResponse(response);
    const value = parseJsonValue(await response.json());
    if (value === undefined) throw new Error("Relay returned invalid JSON.");
    return schema.parse(value);
  }

  protected async fetchResponse(
    url: URL | string,
    authenticated = true,
    init: RequestInit = {},
  ) {
    const headers = new Headers(init.headers);
    if (authenticated) {
      const method = init.method?.toUpperCase() ?? "GET";
      const body = isJsonString(init.body) ? init.body : "";
      if (!this.options.getAuthorization) {
        throw new Error("Relay authorization is not configured.");
      }
      const authorization = await this.options.getAuthorization({
        url: url.toString(),
        method,
        body,
      });
      headers.set("authorization", authorization);
      const deviceAuthorization = await this.options.getDeviceAuthorization?.();
      if (deviceAuthorization) {
        headers.set("x-chief-device-authorization", deviceAuthorization);
      }
    }
    return this.fetcher(url, { ...init, headers });
  }
}
