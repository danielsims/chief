import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";

import type { JsonValue } from "@chief/relay-contracts";
import {
  execRequestSchema,
  listExecutionFilesSchema,
  readExecutionFileSchema,
  removeExecutionFileSchema,
  writeExecutionFileSchema,
} from "@chief/relay-contracts";

import type { BrowserRegistry } from "./browser-registry";
import type { ExecutorConfig } from "./config";
import {
  CapabilityError,
  LeaseError,
  LeaseVerifier,
  requireCapability,
} from "./auth";
import { routeBrowserRequest } from "./browser-handler";
import { executionRoot, PathBoundaryError, resolveLeasePath } from "./paths";
import { runProcess } from "./process";

export function createExecutorHandler(
  config: ExecutorConfig,
  browsers: BrowserRegistry,
) {
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
      const browserResponse = await routeBrowserRequest(
        request,
        url,
        lease,
        browsers,
      );
      if (browserResponse) return browserResponse;
      if (request.method === "POST" && url.pathname === "/v1/exec") {
        requireCapability(lease, "process:exec");
        const input = execRequestSchema.parse(await request.json());
        const cwd = await resolveLeasePath(
          config.EXECUTOR_ROOT,
          lease,
          input.cwd,
        );
        return json(
          await runProcess(input, {
            cwd,
            workspaceRoot: executionRoot(config.EXECUTOR_ROOT, lease),
            maxOutputBytes: config.EXECUTOR_MAX_OUTPUT_BYTES,
          }),
        );
      }
      if (request.method === "POST" && url.pathname === "/v1/files/read") {
        requireCapability(lease, "filesystem:read");
        const input = readExecutionFileSchema.parse(await request.json());
        const filePath = await resolveLeasePath(
          config.EXECUTOR_ROOT,
          lease,
          input.path,
        );
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
        const filePath = await resolveLeasePath(
          config.EXECUTOR_ROOT,
          lease,
          input.path,
        );
        if (input.createParents)
          await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, Buffer.from(input.contentBase64, "base64"));
        return json({ written: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/files/list") {
        requireCapability(lease, "filesystem:read");
        const input = listExecutionFilesSchema.parse(await request.json());
        const directory = await resolveLeasePath(
          config.EXECUTOR_ROOT,
          lease,
          input.path,
        );
        const entries = await Promise.all(
          (await readdir(directory, { withFileTypes: true })).map(
            async (entry) => {
              const relativePath = path.posix.join(input.path, entry.name);
              const stat = await lstat(path.join(directory, entry.name));
              const kind: "directory" | "file" | "symlink" = entry.isDirectory()
                ? "directory"
                : entry.isSymbolicLink()
                  ? "symlink"
                  : "file";
              return {
                path: relativePath,
                kind,
                size: stat.size,
              };
            },
          ),
        );
        return json({ entries });
      }
      if (request.method === "POST" && url.pathname === "/v1/files/remove") {
        requireCapability(lease, "filesystem:write");
        const input = removeExecutionFileSchema.parse(await request.json());
        const filePath = await resolveLeasePath(
          config.EXECUTOR_ROOT,
          lease,
          input.path,
        );
        await rm(filePath, { recursive: input.recursive, force: true });
        return json({ removed: true });
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
      if (caught instanceof ZodError) {
        return error(
          400,
          "invalid_request",
          "Executor request is invalid.",
          requestId,
        );
      }
      console.error(
        JSON.stringify({
          event: "computer.request.failed",
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          error: caught instanceof Error ? caught.message : String(caught),
        }),
      );
      return error(
        500,
        "operation_failed",
        "Executor operation failed. Retry the request.",
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
