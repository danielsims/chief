import { z } from "zod";

import type { AgentBrowser, AgentBrowserTarget } from "@chief/agent-computer";
import {
  RecoverableToolError,
  UnavailableToolError,
} from "@chief/agent-runtime/durable-turn";
import {
  browserSnapshotSchema,
  browserStreamSchema,
} from "@chief/relay-contracts";

import type { RemoteComputerClient } from "./remote-computer-client";

export class RemoteAgentBrowser implements AgentBrowser {
  constructor(
    private readonly client: Pick<RemoteComputerClient, "bytes" | "json">,
  ) {}

  async open(url: string, options?: { fresh?: boolean }) {
    try {
      return await this.client.json("/v1/browser/open", browserSnapshotSchema, {
        url,
        fresh: options?.fresh ?? false,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error.";
      if (/(?:429|too many requests|rate.?limit|capacity)/iu.test(detail)) {
        throw new UnavailableToolError(
          `The interactive browser is temporarily unavailable. Continue with web_read, another source, or the evidence already available. ${detail}`,
        );
      }
      throw new RecoverableToolError(
        `The interactive browser could not open this page. Continue with another available method. ${detail}`,
      );
    }
  }

  async snapshot() {
    return await this.client.json(
      "/v1/browser/snapshot",
      browserSnapshotSchema,
    );
  }

  async click(target: AgentBrowserTarget) {
    return await this.recoverableInteraction("click", () =>
      this.client.json("/v1/browser/click", browserSnapshotSchema, target),
    );
  }

  async type(target: AgentBrowserTarget, text: string) {
    return await this.recoverableInteraction("fill", () =>
      this.client.json("/v1/browser/fill", browserSnapshotSchema, {
        target,
        text,
      }),
    );
  }

  async select(target: AgentBrowserTarget, values: readonly string[]) {
    return await this.recoverableInteraction("select", () =>
      this.client.json("/v1/browser/select", browserSnapshotSchema, {
        target,
        values,
      }),
    );
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

  private async recoverableInteraction<T>(
    action: string,
    execute: () => Promise<T>,
  ) {
    try {
      return await execute();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error.";
      throw new RecoverableToolError(
        `Browser ${action} failed. Inspect the current page before trying another interaction. ${detail}`,
      );
    }
  }
}
