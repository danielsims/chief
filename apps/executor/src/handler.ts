import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JsonValue } from "@chief/relay-contracts";
import {
  execRequestSchema,
  readExecutionFileSchema,
  writeExecutionFileSchema,
} from "@chief/relay-contracts";

import type { ExecutorConfig } from "./config";
import {
  CapabilityError,
  LeaseError,
  LeaseVerifier,
  requireCapability,
} from "./auth";
import { PathBoundaryError, resolveExecutionPath } from "./paths";
import { runProcess } from "./process";

export function createExecutorHandler(config: ExecutorConfig) {
  const verifier = new LeaseVerifier(config);
  return async (request: Request) => {
    const requestId =
      request.headers.get("x-request-id") ?? crypto.randomUUID();
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, protocolVersion: 1 });
      }
      const lease = await verifier.verify(request);
      if (request.method === "POST" && url.pathname === "/v1/exec") {
        requireCapability(lease, "process:exec");
        const input = execRequestSchema.parse(await request.json());
        const cwd = resolveExecutionPath(config.EXECUTOR_ROOT, input.cwd);
        return json(
          await runProcess(input, {
            cwd,
            maxOutputBytes: config.EXECUTOR_MAX_OUTPUT_BYTES,
          }),
        );
      }
      if (request.method === "POST" && url.pathname === "/v1/files/read") {
        requireCapability(lease, "filesystem:read");
        const input = readExecutionFileSchema.parse(await request.json());
        const filePath = resolveExecutionPath(config.EXECUTOR_ROOT, input.path);
        const content = await readFile(filePath);
        if (content.byteLength > input.maxBytes) {
          return error(
            413,
            "file_too_large",
            "File exceeds the lease read limit.",
            requestId,
          );
        }
        return json({ contentBase64: content.toString("base64") });
      }
      if (request.method === "POST" && url.pathname === "/v1/files/write") {
        requireCapability(lease, "filesystem:write");
        const input = writeExecutionFileSchema.parse(await request.json());
        const filePath = resolveExecutionPath(config.EXECUTOR_ROOT, input.path);
        if (input.createParents)
          await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, Buffer.from(input.contentBase64, "base64"));
        return json({ written: true });
      }
      return error(404, "not_found", "Executor route not found.", requestId);
    } catch (caught) {
      if (caught instanceof LeaseError) {
        return error(401, "invalid_lease", caught.message, requestId);
      }
      if (caught instanceof CapabilityError) {
        return error(403, "capability_denied", caught.message, requestId);
      }
      if (caught instanceof PathBoundaryError) {
        return error(400, "invalid_path", caught.message, requestId);
      }
      return error(
        400,
        "invalid_request",
        "Executor request is invalid.",
        requestId,
      );
    }
  };
}

function json(value: JsonValue, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function error(
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return json({ error: { code, message, requestId } }, { status });
}
