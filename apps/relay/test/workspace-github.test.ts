import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { userIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { appJwt, pkcs8FromPem } from "../src/github-app";
import { signGitHubTicket, verifyGitHubTicket } from "../src/github-tickets";
import {
  withTrustedContext,
  withTrustedIdentity,
} from "../src/internal-context";
import { hexKey, relayTestEnv } from "./helpers";

let workspaceId = workspaceIdSchema.parse("workspace-github-test");
const ownerId = userIdSchema.parse("github-owner");
const memberId = userIdSchema.parse("github-member");
const secret = "test-relay-secret-master-key-0123456789abcdef";
// The workspace object runs with the relay secret from vitest.config.ts.
const workspaceSecret =
  "test-only-relay-secret-key-with-at-least-thirty-two-characters";

const owner = {
  kind: "user" as const,
  userId: ownerId,
  pubkey: hexKey(ownerId),
  workspaceId: workspaceIdSchema.parse("workspace-github-test"),
  role: "owner" as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// Each test gets its own workspace so stored apps and installations never leak.
function freshWorkspace() {
  workspaceId = workspaceIdSchema.parse(
    `workspace-github-${crypto.randomUUID().slice(0, 8)}`,
  );
  owner.workspaceId = workspaceId;
}

describe("GitHub tickets", () => {
  it("round-trip only for their own purpose, unaltered and unexpired", async () => {
    const ticket = await signGitHubTicket(secret, {
      purpose: "install",
      principal: owner,
    });
    await expect(
      verifyGitHubTicket(secret, ticket, "install"),
    ).resolves.toMatchObject({ principal: owner });

    await expect(verifyGitHubTicket(secret, ticket, "setup")).rejects.toThrow(
      "expired",
    );
    await expect(
      verifyGitHubTicket("another-relay-secret", ticket, "install"),
    ).rejects.toThrow("expired");
    const [payload = "", signature = ""] = ticket.split(".");
    await expect(
      verifyGitHubTicket(secret, `${payload}x.${signature}`, "install"),
    ).rejects.toThrow("expired");
    await expect(
      verifyGitHubTicket(secret, ticket, "install", Date.now() + 31 * 60_000),
    ).rejects.toThrow("expired");
    await expect(verifyGitHubTicket(secret, null, "install")).rejects.toThrow(
      "expired",
    );
  });
});

describe("GitHub App authentication", () => {
  it("signs app JWTs with the PKCS#1 keys GitHub issues", async () => {
    const { pkcs1Pem, pkcs8, publicKey } = await rsaKey();
    expect(new Uint8Array(pkcs8FromPem(pkcs1Pem))).toEqual(pkcs8);

    const jwt = await appJwt(
      testApp(pkcs1Pem),
      Date.parse("2026-09-29T00:00:00Z"),
    );
    const [header = "", body = "", signature = ""] = jwt.split(".");
    expect(JSON.parse(atob(body))).toEqual({
      iat: Date.parse("2026-09-29T00:00:00Z") / 1000 - 60,
      exp: Date.parse("2026-09-29T00:00:00Z") / 1000 + 540,
      iss: "Iv1.test",
    });
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      fromBase64Url(signature),
      new TextEncoder().encode(`${header}.${body}`),
    );
    expect(verified).toBe(true);
  });
});

describe("workspace GitHub connection", () => {
  it("lets only an owner start setting up GitHub", async () => {
    freshWorkspace();
    const stub = workspaceStub();
    await claimWorkspace(stub);

    const denied = await stub.fetch(
      trusted("github-setup", memberId, "member", { name: "Test Agents" }),
    );
    expect(denied.status).toBe(403);

    const started = await stub.fetch(
      trusted("github-setup", ownerId, "owner", { name: "Test Agents" }),
    );
    expect(started.status).toBe(200);
    const { url } = (await started.json()) as { url: string };
    const ticket = new URL(url).searchParams.get("ticket");
    await expect(
      verifyGitHubTicket(workspaceSecret, ticket, "setup"),
    ).resolves.toMatchObject({ name: "Test Agents" });
  });

  it("links an installation only when the installer can access it", async () => {
    freshWorkspace();
    const stub = workspaceStub();
    await claimWorkspace(stub);
    await storeApp(stub);

    stubGitHub({ userInstallations: [111] });
    const denied = await stub.fetch(
      trusted("github-installation-add", ownerId, "owner", {
        installationId: 999,
        code: "oauth-code",
      }),
    );
    expect(denied.status).toBe(403);

    const linked = await stub.fetch(
      trusted("github-installation-add", ownerId, "owner", {
        installationId: 111,
        code: "oauth-code",
      }),
    );
    expect(linked.status).toBe(200);

    const connection = await stub.fetch(
      trusted("github-connection", ownerId, "owner", undefined),
    );
    expect(await connection.json()).toMatchObject({
      app: "workspace",
      appSlug: "test-agents",
      canManage: true,
      installations: [{ id: 111, account: "example-org" }],
    });
  });

  it("issues clone tokens only for repositories this workspace connected", async () => {
    freshWorkspace();
    const stub = workspaceStub();
    await claimWorkspace(stub);
    await storeApp(stub);
    stubGitHub({ userInstallations: [111] });
    await stub.fetch(
      trusted("github-installation-add", ownerId, "owner", {
        installationId: 111,
        code: "oauth-code",
      }),
    );

    const github = stubGitHub({
      userInstallations: [111],
      repositoryInstallations: {
        "example-org/app": 111,
        "other/secret": 222,
      },
    });
    const refused = await stub.fetch(
      trusted("github-clone-token", ownerId, "owner", {
        repository: "other/secret",
      }),
    );
    expect(refused.status).toBe(404);

    const granted = await stub.fetch(
      trusted("github-clone-token", ownerId, "owner", {
        repository: "example-org/app",
      }),
    );
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({
      token: "installation-token-111",
      expiresAt: "2026-09-29T01:00:00Z",
    });
    const tokenRequest = github.mock.calls
      .map(([input, init]) => ({ url: requestUrl(input), init }))
      .find(
        ({ url }) => url.pathname === "/app/installations/111/access_tokens",
      );
    expect(JSON.parse(z.string().parse(tokenRequest?.init?.body))).toEqual({
      repositories: ["app"],
      permissions: { contents: "read", metadata: "read" },
    });
  });
});

function stubGitHub(input: {
  userInstallations: number[];
  repositoryInstallations?: Record<string, number>;
}) {
  const github = vi.fn(
    async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(request);
      if (url.pathname === "/login/oauth/access_token") {
        return Response.json({ access_token: "user-token" });
      }
      if (url.pathname === "/user/installations") {
        return Response.json({
          installations: input.userInstallations.map((id) => ({ id })),
        });
      }
      const installation = /^\/app\/installations\/(\d+)$/u.exec(url.pathname);
      if (installation) {
        return Response.json({
          id: Number(installation[1]),
          account: { login: "example-org" },
        });
      }
      const repository = /^\/repos\/([^/]+)\/([^/]+)\/installation$/u.exec(
        url.pathname,
      );
      if (repository) {
        const id =
          input.repositoryInstallations?.[`${repository[1]}/${repository[2]}`];
        return id
          ? Response.json({ id, account: { login: repository[1] } })
          : Response.json({ message: "Not Found" }, { status: 404 });
      }
      const token = /^\/app\/installations\/(\d+)\/access_tokens$/u.exec(
        url.pathname,
      );
      if (token && init?.method === "POST") {
        return Response.json({
          token: `installation-token-${token[1]}`,
          expires_at: "2026-09-29T01:00:00Z",
        });
      }
      return Response.json({ message: "Not Found" }, { status: 404 });
    },
  );
  vi.stubGlobal("fetch", github);
  return github;
}

async function storeApp(stub: DurableObjectStub) {
  const { pkcs1Pem } = await rsaKey();
  const response = await stub.fetch(
    trusted("github-app-store", ownerId, "owner", testApp(pkcs1Pem)),
  );
  expect(response.status).toBe(200);
}

function testApp(privateKey: string) {
  return {
    appId: "12345",
    slug: "test-agents",
    privateKey,
    clientId: "Iv1.test",
    clientSecret: "client-secret",
  };
}

// Key generation is CPU-heavy; one key serves every test in this file.
let sharedKey: ReturnType<typeof generateRsaKey> | undefined;
function rsaKey() {
  sharedKey ??= generateRsaKey();
  return sharedKey;
}

async function generateRsaKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  // PKCS#8 wraps the PKCS#1 key in its final OCTET STRING: strip the 26-byte
  // prefix a 2048-bit key always has to get the key GitHub would issue.
  const pkcs1 = pkcs8.slice(26);
  let binary = "";
  for (const byte of pkcs1) binary += String.fromCharCode(byte);
  return {
    pkcs8,
    publicKey: pair.publicKey,
    pkcs1Pem: `-----BEGIN RSA PRIVATE KEY-----\n${btoa(binary)}\n-----END RSA PRIVATE KEY-----`,
  };
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function workspaceStub() {
  const { WORKSPACES: workspaces } = relayTestEnv();
  return workspaces.get(workspaces.idFromName(workspaceId));
}

function claimWorkspace(stub: DurableObjectStub) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-chief-internal-operation", "claim");
  return stub.fetch(
    withTrustedIdentity(
      {
        identity: { kind: "user", userId: ownerId, pubkey: hexKey(ownerId) },
        requestId: crypto.randomUUID(),
        workspaceId,
      },
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          commandId: "5d7cf0c2-1d0b-4a53-9f65-0c0a2b8a6e11",
          workspaceId,
          name: "GitHub connector test",
          bootstrapToken: "relay-bootstrap-token-for-testing",
        }),
      },
    ),
  );
}

function trusted(
  operation: string,
  userId: typeof ownerId,
  role: "owner" | "member",
  body: object | undefined,
) {
  const headers = new Headers({ "x-chief-internal-operation": operation });
  if (body) headers.set("content-type", "application/json");
  return withTrustedContext(
    new Request("https://relay.test/v1/workspaces/github", {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    {
      principal: {
        kind: "user",
        userId,
        pubkey: hexKey(userId),
        workspaceId,
        role,
      },
      requestId: crypto.randomUUID(),
      workspaceId,
    },
  );
}

function requestUrl(request: RequestInfo | URL) {
  return new URL(request instanceof Request ? request.url : request.toString());
}
