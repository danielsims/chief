import { z } from "zod";

import type { AgentBrowser, AgentBrowserTarget } from "@chief/agent-computer";
import {
  browserSnapshotSchema,
  browserStreamSchema,
} from "@chief/relay-contracts";

import type { RemoteComputerClient } from "./remote-computer-client";

export class RemoteAgentBrowser implements AgentBrowser {
  constructor(private readonly client: RemoteComputerClient) {}

  async open(url: string, options?: { fresh?: boolean }) {
    return await this.client.json("/v1/browser/open", browserSnapshotSchema, {
      url,
      fresh: options?.fresh ?? false,
    });
  }

  async snapshot() {
    return await this.client.json(
      "/v1/browser/snapshot",
      browserSnapshotSchema,
    );
  }

  async click(target: AgentBrowserTarget) {
    return await this.client.json(
      "/v1/browser/click",
      browserSnapshotSchema,
      target,
    );
  }

  async type(target: AgentBrowserTarget, text: string) {
    return await this.client.json("/v1/browser/fill", browserSnapshotSchema, {
      target,
      text,
    });
  }

  async select(target: AgentBrowserTarget, values: readonly string[]) {
    return await this.client.json("/v1/browser/select", browserSnapshotSchema, {
      target,
      values,
    });
  }

  async screenshot() {
    return await this.client.bytes("/v1/browser/screenshot");
  }

  async stream() {
    return await this.client.json(
      "/v1/browser/stream-ticket",
      browserStreamSchema,
    );
  }

  async close() {
    await this.client.json(
      "/v1/browser/close",
      z.object({ closed: z.boolean() }),
    );
  }
}
