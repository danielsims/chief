import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  agentIdSchema,
  machineBrowserCommandSchema,
} from "@chief/relay-contracts";

import type { MachineSocket } from "../src/workspace-web-machine";
import { withTrustedContext } from "../src/internal-context";
import { WorkspaceChannelStore } from "../src/workspace-channel-store";
import {
  browseThroughWebMachine,
  receiveWebMachineMessage,
} from "../src/workspace-web-machine";
import { setupChannelTest, testAgentPrincipal } from "./channel-test-helpers";

function socket(owner: string, id: string) {
  let attachment: {
    ownerUserId: string;
    machineId: string;
    policy: { allow: string };
    servedAt?: number[];
  } = {
    ownerUserId: owner,
    machineId: id,
    policy: { allow: "mine" },
  };
  let send: (value: string) => void = vi.fn();
  const ws = {
    readyState: 1,
    deserializeAttachment: () => attachment,
    serializeAttachment: (value: typeof attachment) => {
      attachment = value;
    },
    send: (value: string) => send(value),
    close: vi.fn(),
  } satisfies MachineSocket;
  return {
    ws,
    onSend: (handler: (value: string) => void) => {
      send = handler;
    },
  };
}

describe("workspace browser security", () => {
  it("does not admit scripts, CDP endpoints or host paths into its contract", () => {
    const input = {
      sessionId: crypto.randomUUID(),
      operation: "open",
      url: "https://example.com",
    };
    for (const field of ["cdp", "script", "executable", "profile", "agentId"]) {
      expect(
        machineBrowserCommandSchema.safeParse({
          ...input,
          [field]: "untrusted",
        }).success,
      ).toBe(false);
    }
  });
  it("requires membership and permission and binds replies to the selected machine", async () => {
    const test = await setupChannelTest();
    const stub = test.env.WORKSPACES.get(
      test.env.WORKSPACES.idFromName(test.workspaceId),
    );
    await runInDurableObject(stub, async (_instance, state) => {
      const selected = socket(test.principal.userId, "selected-machine");
      const foreign = socket("someone-else", "foreign-machine");
      const ctx = {
        storage: state.storage,
        getWebSockets: () => [selected.ws],
      };
      const channels = new WorkspaceChannelStore(state.storage, test.env);
      const principal = testAgentPrincipal(
        test,
        agentIdSchema.parse("chief"),
        test.principal.pubkey,
      );
      const request = (
        operation: string,
        sessionId: string,
        who: typeof principal | typeof test.principal = principal,
      ) =>
        withTrustedContext(
          new Request("https://workspace.internal", {
            method: "POST",
            body: JSON.stringify({
              operation,
              sessionId,
              ...(operation === "open"
                ? { url: "https://example.com" }
                : undefined),
            }),
          }),
          {
            principal: who,
            requestId: crypto.randomUUID(),
            workspaceId: test.workspaceId,
          },
        );
      await expect(
        browseThroughWebMachine(
          ctx,
          channels,
          request("open", crypto.randomUUID(), test.principal),
        ),
      ).rejects.toMatchObject({ status: 403 });
      const missing = {
        ...principal,
        agentId: agentIdSchema.parse("not-enrolled"),
      };
      await expect(
        browseThroughWebMachine(
          ctx,
          channels,
          request("open", crypto.randomUUID(), missing),
        ),
      ).rejects.toMatchObject({ status: 403 });
      let forgedWasIgnored = false;
      selected.onSend((value) => {
        const command = JSON.parse(value) as { requestId: string };
        receiveWebMachineMessage(
          foreign.ws,
          JSON.stringify({
            type: "browser.result",
            requestId: command.requestId,
            ok: true,
            output: { url: "https://attacker.example" },
          }),
        );
        forgedWasIgnored = true;
        receiveWebMachineMessage(
          selected.ws,
          JSON.stringify({
            type: "browser.result",
            requestId: command.requestId,
            ok: true,
            output: { url: "https://example.com" },
          }),
        );
      });
      const id = crypto.randomUUID();
      const response = await browseThroughWebMachine(
        ctx,
        channels,
        request("open", id),
      );
      expect(await response.json()).toEqual({ url: "https://example.com" });
      expect(forgedWasIgnored).toBe(true);
      const replacement = socket(test.principal.userId, "replacement-machine");
      const offline = {
        storage: state.storage,
        getWebSockets: () => [replacement.ws],
      };
      await expect(
        browseThroughWebMachine(offline, channels, request("snapshot", id)),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        browseThroughWebMachine(
          ctx,
          channels,
          request("snapshot", crypto.randomUUID()),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});
