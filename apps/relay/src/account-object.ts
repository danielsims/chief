import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";

import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import {
  commandIdSchema,
  createWorkspaceCommandSchema,
  isJsonObject,
  isJsonString,
  switchWorkspaceCommandSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import {
  deletePushDevice,
  listPushDevices,
  registerPushDevice,
} from "./account-push";
import { findLegacyAccountDirectory } from "./db/migrations/find-legacy-account-directory";
import { initializeAccountTables } from "./db/migrations/initialize-account-tables";
import { migrateAccountDirectory } from "./db/migrations/migrate-account-directory";
import { attempt, runResponse, sync } from "./effect";
import { json, parseJson, relayError } from "./http";
import {
  readTrustedAccountIdentity,
  withTrustedIdentity,
} from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { deviceActiveWorkspacesDeleteRemove } from "./queries/device-active-workspaces/delete-remove";
import { deviceActiveWorkspacesInsertSetActiveWorkspace } from "./queries/device-active-workspaces/insert-set-active-workspace";
import { workspaceDirectoryV2DeleteRemove } from "./queries/workspace-directory-v2/delete-remove";
import { workspaceDirectoryV2FindActiveDirectory } from "./queries/workspace-directory-v2/find-active-directory";
import { workspaceDirectoryV2FindActiveDirectoryRow } from "./queries/workspace-directory-v2/find-active-directory-row";
import { workspaceDirectoryV2FindCreate } from "./queries/workspace-directory-v2/find-create";
import { workspaceDirectoryV2FindList } from "./queries/workspace-directory-v2/find-list";
import { workspaceDirectoryV2FindSwitchWorkspace } from "./queries/workspace-directory-v2/find-switch-workspace";
import { workspaceDirectoryV2InsertCreate } from "./queries/workspace-directory-v2/insert-create";
import { workspaceDirectoryV2InsertJoin } from "./queries/workspace-directory-v2/insert-join";
import { workspaceDirectoryV2UpdateJoin } from "./queries/workspace-directory-v2/update-join";

interface DirectoryRow extends Record<string, SqlStorageValue> {
  workspace_id: string;
  operation_id: string;
  name: string;
  website: string;
  create_command_json: string | null;
  created_at: string;
  active: number;
}

export class AccountObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      initializeAccountTables(state.storage);
      migrateLegacyDirectory(state.storage);
      return Promise.resolve();
    });
  }

  fetch(request: Request) {
    const create = this.create.bind(this);
    const active = this.active.bind(this);
    const list = this.list.bind(this);
    const switchWorkspace = this.switchWorkspace.bind(this);
    const join = this.join.bind(this);
    const remove = this.remove.bind(this);
    const storage = this.ctx.storage;
    const env = this.env;
    const program = Effect.gen(function* () {
      const identity = yield* sync("account.identity", () =>
        readTrustedAccountIdentity(request),
      );
      const operation = request.headers.get("x-chief-internal-operation");
      if (request.method !== "POST") {
        return relayError(405, "method_not_allowed", "Method not allowed.");
      }
      if (operation === "register-push-device") {
        if (identity.kind !== "user") {
          return relayError(
            403,
            "user_required",
            "A user identity is required.",
          );
        }
        return yield* attempt("account.push.register", () =>
          registerPushDevice(storage, request, env),
        );
      }
      if (operation === "list-push-devices") {
        return yield* sync("account.push.list", () => listPushDevices(storage));
      }
      if (operation === "delete-push-device") {
        return yield* attempt("account.push.delete", () =>
          deletePushDevice(storage, request),
        );
      }
      if (identity.kind !== "user") {
        return relayError(403, "user_required", "A user identity is required.");
      }
      if (operation === "create-workspace") {
        return yield* attempt("account.workspace.create", () =>
          create(request, identity),
        );
      }
      if (operation === "active-workspace") {
        return yield* sync("account.workspace.active", () => active(identity));
      }
      if (operation === "list-workspaces") {
        return yield* attempt("account.workspace.list", () => list(identity));
      }
      if (operation === "switch-workspace") {
        return yield* attempt("account.workspace.switch", () =>
          switchWorkspace(request, identity),
        );
      }
      if (operation === "join-workspace") {
        return yield* attempt("account.workspace.join", () =>
          join(request, identity),
        );
      }
      if (operation === "remove-workspace") {
        return yield* attempt("account.workspace.remove", () =>
          remove(request),
        );
      }
      return relayError(404, "not_found", "Account operation not found.");
    });
    return runResponse(program, this.env, { operation: "account.fetch" });
  }

  private async create(
    request: Request,
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const command = createWorkspaceCommandSchema.parse(
      await parseJson(request),
    );
    const prior = firstRow<DirectoryRow>(
      workspaceDirectoryV2FindCreate(this.ctx.storage, command.commandId),
    );
    if (prior) {
      this.setActiveWorkspace(identity.pubkey, prior.workspace_id);
      return json({ ...toDirectoryEntry(prior), created: false });
    }

    const workspaceId = workspaceIdSchema.parse(
      `workspace-${crypto.randomUUID()}`,
    );
    const createdAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      workspaceDirectoryV2InsertCreate(this.ctx.storage, {
        workspaceId: workspaceId,
        operationId: command.commandId,
        name: command.name,
        website: command.website,
        createCommandJson: JSON.stringify(command),
        createdAt: createdAt,
      });
      this.setActiveWorkspace(identity.pubkey, workspaceId, createdAt);
    });
    return json({ workspaceId, command, createdAt, created: true });
  }

  private active(identity: Extract<AuthenticatedIdentity, { kind: "user" }>) {
    const row = this.activeDirectoryRow(identity.pubkey);
    if (!row) return new Response(null, { status: 204 });
    return json(toDirectoryEntry(row));
  }

  /** List every workspace the account belongs to, with a best-effort snapshot
   * flag so the client can show "finish setup" vs "in". */
  private async list(
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const activeWorkspaceId = this.activeDirectoryRow(
      identity.pubkey,
    )?.workspace_id;
    const rows = [
      ...workspaceDirectoryV2FindList<DirectoryRow>(this.ctx.storage),
    ];
    const workspaces = await Promise.all(
      rows.map(async (row) => {
        const id = workspaceIdSchema.parse(row.workspace_id);
        return {
          id,
          name: String(row.name),
          website: String(row.website),
          imageURL: null,
          isActive: row.workspace_id === activeWorkspaceId,
          onboardingComplete: await this.snapshotComplete(identity, id),
        };
      }),
    );
    return json(workspaceListResult(workspaces));
  }

  private async snapshotComplete(
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
    workspaceIdValue: string,
  ): Promise<boolean> {
    try {
      const workspaceId = workspaceIdSchema.parse(workspaceIdValue);
      const stub = this.env.WORKSPACES.get(
        this.env.WORKSPACES.idFromName(workspaceId),
      );
      const response = await stub.fetch(
        withTrustedIdentity(
          { identity, requestId: crypto.randomUUID(), workspaceId },
          {
            method: "POST",
            headers: { "x-chief-internal-operation": "snapshot" },
          },
        ),
      );
      if (!response.ok) {
        await releaseInternalResponse(response);
        return false;
      }
      const snapshot: { onboardingComplete?: boolean } = await response.json();
      return snapshot.onboardingComplete === true;
    } catch {
      return false;
    }
  }

  private async switchWorkspace(
    request: Request,
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const command = switchWorkspaceCommandSchema.parse(
      await parseJson(request),
    );
    const target = workspaceIdSchema.parse(command.workspaceId);
    const existing = firstRow<DirectoryRow>(
      workspaceDirectoryV2FindSwitchWorkspace(this.ctx.storage, target),
    );
    if (!existing) {
      return relayError(
        404,
        "workspace_not_found",
        "This account does not have that workspace.",
      );
    }
    const current = this.activeDirectoryRow(identity.pubkey);
    if (current?.workspace_id !== target) {
      this.setActiveWorkspace(identity.pubkey, target);
    }
    void this.maybeRecordProductEvents();
    return json({ workspaceId: target, isActive: true });
  }

  private async join(
    request: Request,
    identity: Extract<AuthenticatedIdentity, { kind: "user" }>,
  ) {
    const input = parseJson(request).then((value) => {
      if (!isJsonObject(value)) throw new Error("Expected a JSON object.");
      return value;
    });
    const body = await input;
    const workspaceId = workspaceIdSchema.parse(body.workspaceId);
    const operationId = commandIdSchema.parse(body.operationId);
    const name = isJsonString(body.name) ? body.name.trim() : "";
    const website = isJsonString(body.website) ? body.website.trim() : "";
    const createdAt = isJsonString(body.createdAt) ? body.createdAt : "";
    if (!name || name.length > 120 || website.length > 2_048) {
      return relayError(
        400,
        "invalid_workspace",
        "Workspace details are invalid.",
      );
    }
    const existing = firstRow<DirectoryRow>(
      workspaceDirectoryV2FindSwitchWorkspace(this.ctx.storage, workspaceId),
    );
    this.ctx.storage.transactionSync(() => {
      if (existing) {
        workspaceDirectoryV2UpdateJoin(this.ctx.storage, {
          name: name,
          website: website,
          workspaceId: workspaceId,
        });
      } else {
        workspaceDirectoryV2InsertJoin(this.ctx.storage, {
          workspaceId: workspaceId,
          operationId: operationId,
          name: name,
          website: website,
          createdAt: createdAt,
        });
      }
      this.setActiveWorkspace(identity.pubkey, workspaceId);
    });
    return json({ workspaceId, isActive: true });
  }

  private async remove(request: Request) {
    const input = await parseJson(request);
    if (!isJsonObject(input)) throw new Error("Expected a JSON object.");
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const existing = firstRow<DirectoryRow>(
      workspaceDirectoryV2FindSwitchWorkspace(this.ctx.storage, workspaceId),
    );
    if (!existing) {
      return relayError(
        404,
        "workspace_not_found",
        "This account does not have that workspace.",
      );
    }
    this.ctx.storage.transactionSync(() => {
      deviceActiveWorkspacesDeleteRemove(this.ctx.storage, workspaceId);
      workspaceDirectoryV2DeleteRemove(this.ctx.storage, workspaceId);
    });
    return json({ workspaceId, removed: true });
  }

  private activeDirectoryRow(devicePubkey: string) {
    const selected = firstRow<DirectoryRow>(
      workspaceDirectoryV2FindActiveDirectory(this.ctx.storage, devicePubkey),
    );
    if (selected) return selected;

    const fallback = firstRow<DirectoryRow>(
      workspaceDirectoryV2FindActiveDirectoryRow(this.ctx.storage),
    );
    if (fallback) this.setActiveWorkspace(devicePubkey, fallback.workspace_id);
    return fallback;
  }

  private setActiveWorkspace(
    devicePubkey: string,
    workspaceId: string,
    updatedAt = new Date().toISOString(),
  ) {
    deviceActiveWorkspacesInsertSetActiveWorkspace(this.ctx.storage, {
      devicePubkey: devicePubkey,
      workspaceId: workspaceId,
      updatedAt: updatedAt,
    });
  }

  private async maybeRecordProductEvents() {
    try {
      const { recordProductEvents } = await import("./product-events");
      recordProductEvents(this.env, ["active-workspace"]);
    } catch {
      // Observability only.
    }
  }
}

function workspaceListResult(
  workspaces: {
    id: string;
    name: string;
    website: string;
    imageURL: string | null;
    isActive: boolean;
    onboardingComplete: boolean;
  }[],
) {
  return { workspaces };
}

function toDirectoryEntry(row: DirectoryRow) {
  return {
    workspaceId: workspaceIdSchema.parse(row.workspace_id),
    name: String(row.name),
    website: String(row.website),
    command: parseStoredCreateCommand(row.create_command_json),
    createdAt: String(row.created_at),
  };
}

/** Historical onboarding input is optional recovery metadata, not workspace
 * identity. A command written by an earlier app schema must never make the
 * durable workspace directory unreadable. */
function parseStoredCreateCommand(value: string | null) {
  if (!value) return null;
  try {
    const parsed = createWorkspaceCommandSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function migrateLegacyDirectory(storage: DurableObjectStorage) {
  const legacy = findLegacyAccountDirectory<{ name: string }>(
    storage,
  ).toArray();
  if (legacy.length === 0) return;
  migrateAccountDirectory(storage);
}

function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
