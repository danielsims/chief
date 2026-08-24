import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { JsonValue } from "@chief/relay-contracts";
import {
  isJsonObject,
  isJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

import type * as schema from "./db/schema.js";
import type {
  AgentEvent,
  DiagnosticEventRecord,
  SessionRecord,
} from "./types.js";
import { sessionRecord } from "./local-store-messages.js";

const CHIEF_KEYCHAIN_SERVICE = "com.danielsims.chief.local-database";
const bigintSchema = z.bigint();

function diagnosticSessionRecord(
  row: typeof schema.sessions.$inferSelect,
): SessionRecord {
  return {
    ...sessionRecord(row),
    lastText: redactString(row.lastText),
    summary: row.summary ? redactString(row.summary) : undefined,
    error: row.error ? redactString(row.error) : undefined,
  };
}

const MAX_DIAGNOSTIC_EVENT_BYTES = 64 * 1024;
const SECRET_KEY =
  /(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|client[_-]?secret)/i;
const STRING_SECRET_ASSIGNMENT =
  /(["']?(?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|authorization|cookie|api[_-]?key|credential|private[_-]?key|client[_-]?secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi;
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PREFIXED_SECRET =
  /\b(?:sk-(?:(?:proj|ant)-)?|[spr]k_live_|gh[pousr]_|github_pat_|glpat-|v(?:cp|ci|ca|cr|ck)_|npm_|pypi-|xox[baprs]-|ya29\.|AIza|AKIA|ASIA|SG\.)[A-Za-z0-9_./+=-]{8,}/g;
const JWT_SECRET = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
export const PRODUCT_ACTION_SOURCE = /^(?:agent|automation)-[A-Za-z0-9_-]+$/;

function redactString(value: string) {
  return value
    .replace(BEARER_SECRET, "Bearer [REDACTED]")
    .replace(PREFIXED_SECRET, "[REDACTED]")
    .replace(JWT_SECRET, "[REDACTED]")
    .replace(STRING_SECRET_ASSIGNMENT, "$1[REDACTED]");
}

function redactSecrets<TValue>(
  value: TValue,
  seen = new WeakSet<object>(),
): JsonValue {
  const bigint = bigintSchema.safeParse(value);
  if (bigint.success) return bigint.data.toString();
  if (isJsonString(value)) return redactString(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen));
  }
  if (!value || !isJsonObject(value)) {
    return parseJsonValue(value) ?? String(value);
  }
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? "[REDACTED]" : redactSecrets(item, seen),
    ]),
  );
}

function diagnosticData(event: AgentEvent): JsonValue {
  const redacted = redactSecrets(event);
  const bytes = Buffer.byteLength(JSON.stringify(redacted), "utf8");
  return bytes <= MAX_DIAGNOSTIC_EVENT_BYTES
    ? redacted
    : { type: event.type, truncated: true, originalBytes: bytes };
}

function diagnosticLevel(event: AgentEvent): DiagnosticEventRecord["level"] {
  if (event.type === "error") return "error";
  if (event.type === "result") return event.ok ? "info" : "error";
  if (event.type === "exit") return event.code === 0 ? "info" : "error";
  if (event.type === "permission") return "warn";
  if (event.type === "status" && event.status === "error") return "error";
  if (event.type === "stream" || event.type === "toolProgress") return "debug";
  return "info";
}

function encryptionKey(directory: string) {
  const configured = process.env.CHIEF_DATABASE_ENCRYPTION_KEY;
  if (configured) return configured;
  const account = "default";
  if (process.platform === "darwin") {
    try {
      return execFileSync(
        "/usr/bin/security",
        [
          "find-generic-password",
          "-s",
          CHIEF_KEYCHAIN_SERVICE,
          "-a",
          account,
          "-w",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      const key = randomBytes(32).toString("base64url");
      execFileSync(
        "/usr/bin/security",
        [
          "add-generic-password",
          "-U",
          "-s",
          CHIEF_KEYCHAIN_SERVICE,
          "-a",
          account,
          "-w",
          key,
        ],
        { stdio: "ignore" },
      );
      return key;
    }
  }
  const path = join(directory, ".database-key");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const key = randomBytes(32).toString("base64url");
  writeFileSync(path, key, { mode: 0o600 });
  return key;
}

export {
  diagnosticData,
  diagnosticLevel,
  diagnosticSessionRecord,
  encryptionKey,
};
