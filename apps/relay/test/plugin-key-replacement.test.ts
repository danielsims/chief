import { afterEach, expect, it, vi } from "vitest";

import type { McpConnection } from "@chief/relay-contracts";

import * as client from "../src/mcp/client";
import { replaceMcpHeaders } from "../src/mcp/connection-headers";
import { McpCredentialStore } from "../src/mcp/credentials";
import { relayTestEnv } from "./helpers";
import { withWorkspaceStorage } from "./sqlite-test-storage";

afterEach(() => vi.restoreAllMocks());

it("keeps the working key during validation and after a rejected replacement", async () => {
  await withWorkspaceStorage(async (storage) => {
    const credentials = new McpCredentialStore(
      storage,
      relayTestEnv().RELAY_SECRET_KEY,
      "key-test",
    );
    const connection: McpConnection = {
      id: "example",
      name: "Example",
      description: "",
      url: "https://mcp.example.com/mcp",
      auth: { kind: "headers", headerNames: ["Authorization"] },
      status: "connected",
      tools: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const original = {
      kind: "headers" as const,
      headers: [{ name: "Authorization", value: "Bearer working" }],
    };
    await credentials.write(connection.id, connection.url, original);
    const listTools = vi
      .spyOn(client, "listMcpTools")
      .mockImplementation(async () => {
        expect(await credentials.read(connection.id, connection.url)).toEqual(
          original,
        );
        throw new Error("Provider echoed a secret: replacement");
      });
    const save = vi.fn((value: McpConnection) => value);
    const input = {
      connection,
      headers: [{ name: "Authorization", value: "Bearer replacement" }],
      limits: { relayHost: "relay.test", maxBytes: 512_000, timeoutMs: 30_000 },
      credentials,
      read: () => connection,
      save,
      lockKey: "key-test:example",
    };
    await expect(replaceMcpHeaders(input)).rejects.toThrow(
      "Example rejected this key.",
    );
    expect(save).not.toHaveBeenCalled();
    expect(await credentials.read(connection.id, connection.url)).toEqual(
      original,
    );
    listTools.mockResolvedValue([]);
    await expect(replaceMcpHeaders(input)).resolves.toMatchObject({
      status: "connected",
    });
    expect(await credentials.read(connection.id, connection.url)).toEqual({
      kind: "headers",
      headers: input.headers,
    });
    expect(save).toHaveBeenCalledOnce();
  });
});
