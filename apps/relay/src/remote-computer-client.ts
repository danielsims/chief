import { SignJWT } from "jose";
import { z } from "zod";

import type { AgentJob } from "@chief/relay-contracts";
import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";
import { executionLeaseSchema } from "@chief/relay-contracts";

const COMPUTER_TOKEN_ISSUER = "https://chief-relay.internal";
const COMPUTER_TOKEN_AUDIENCE = "chief-computer";
export const REMOTE_COMPUTER_REQUEST_TIMEOUT_MS = 45_000;

type RemoteComputerRequest =
  | {
      readonly argv: readonly string[];
      readonly cwd: string;
      readonly timeoutMillis: number;
    }
  | { readonly path: string; readonly maxBytes?: number }
  | {
      readonly path: string;
      readonly contentBase64: string;
      readonly createParents: boolean;
    }
  | { readonly path: string; readonly recursive?: boolean }
  | { readonly url: string; readonly fresh: boolean }
  | { readonly ref?: string; readonly labels?: string[] }
  | {
      readonly target: { readonly ref?: string; readonly labels?: string[] };
      readonly text: string;
    }
  | {
      readonly target: { readonly ref?: string; readonly labels?: string[] };
      readonly values: readonly string[];
    };

export class RemoteComputerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly job: AgentJob,
  ) {}

  async json<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: RemoteComputerRequest,
  ) {
    const response = await this.request(path, body);
    const document: unknown = await response.json();
    return schema.parse(document);
  }

  async bytes(path: string, body?: RemoteComputerRequest) {
    const response = await this.request(path, body);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(path: string, body?: RemoteComputerRequest) {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.token()}`,
        ...(body === undefined
          ? undefined
          : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REMOTE_COMPUTER_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw computerRequestFailure(
        path,
        response.status,
        await response.text(),
      );
    }
    return response;
  }

  private async token() {
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 15 * 60_000);
    const lease = executionLeaseSchema.parse({
      id: crypto.randomUUID(),
      workspaceId: this.job.workspaceId,
      agentId: this.job.agentId,
      placementEpoch: 1,
      capabilities: [
        "filesystem:read",
        "filesystem:write",
        "git:read",
        "git:write",
        "process:exec",
        "browser:use",
        "network:egress",
      ],
      resources: {
        cpuMillis: 4_000,
        memoryMib: 2_048,
        diskMib: 16_384,
        wallTimeSeconds: 900,
      },
      network: { mode: "allow-list", allowedHosts: ["*"] },
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    return await new SignJWT({ lease })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(COMPUTER_TOKEN_ISSUER)
      .setAudience(COMPUTER_TOKEN_AUDIENCE)
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1_000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(new TextEncoder().encode(this.secret));
  }
}

function computerRequestFailure(path: string, status: number, body: string) {
  const detail = body.slice(0, 1_000);
  const message = `Computer host ${path} failed (${status}): ${detail}`;
  const code = computerErrorCode(body);
  if (code && rejectedBeforeExecution.has(code)) {
    return new RecoverableToolError(
      `The computer rejected the request before running it. ${message}`,
    );
  }
  return new Error(message);
}

function computerErrorCode(value: string): string | undefined {
  try {
    const parsed = computerErrorResponseSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data.error.code : undefined;
  } catch {
    return undefined;
  }
}

const computerErrorResponseSchema = z.object({
  error: z.object({ code: z.string() }),
});

const rejectedBeforeExecution = new Set([
  "capability_denied",
  "file_too_large",
  "invalid_lease",
  "invalid_path",
  "invalid_request",
  "not_found",
  "request_too_large",
]);
