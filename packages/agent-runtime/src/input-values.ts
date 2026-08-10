import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { InputRequest } from "./types.js";

let cachedKey: string | null = null;

function authorizationKey() {
  if (cachedKey) return cachedKey;
  const configured = process.env.CHIEF_CONTEXT_AUTHORIZATION_KEY;
  if (configured) return (cachedKey = configured);
  const directory = join(homedir(), ".chief");
  const path = join(directory, ".context-authorization-key");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(path)) return (cachedKey = readFileSync(path, "utf8").trim());
  cachedKey = randomBytes(32).toString("base64url");
  writeFileSync(path, cachedKey, { mode: 0o600 });
  return cachedKey;
}

function contextPayload(
  workspaceId: string,
  recurringWorkId: string,
  request: InputRequest,
) {
  return JSON.stringify({
    workspaceId,
    recurringWorkId,
    id: request.id,
    title: request.title,
    reason: request.reason,
    steps: request.steps,
    questions: request.questions,
    fields: request.fields,
  });
}

function contextSignature(
  workspaceId: string,
  recurringWorkId: string,
  request: InputRequest,
) {
  return createHmac("sha256", authorizationKey())
    .update(contextPayload(workspaceId, recurringWorkId, request))
    .digest("base64url");
}

export function authorizeContextRequest(
  workspaceId: string,
  recurringWorkId: string,
  request: InputRequest,
): InputRequest {
  return {
    ...request,
    contextAuthorization: contextSignature(
      workspaceId,
      recurringWorkId,
      request,
    ),
  };
}

export function verifyContextRequest(
  workspaceId: string,
  recurringWorkId: string,
  request: InputRequest,
) {
  if (!request.contextAuthorization) return false;
  const expected = Buffer.from(
    contextSignature(workspaceId, recurringWorkId, request),
  );
  const actual = Buffer.from(request.contextAuthorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertSafeInputRequest(
  request: InputRequest,
  allowWorkspaceContext = false,
) {
  for (const field of request.fields) {
    if (
      "contextKey" in field.save &&
      (!allowWorkspaceContext || field.type !== "multiline")
    ) {
      throw new Error(
        `Field ${field.key} must be stored in the workspace vault, not model context.`,
      );
    }
  }
}
