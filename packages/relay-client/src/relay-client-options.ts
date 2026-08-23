import type { WorkspaceId } from "@chief/relay-contracts";

export interface RelayClientOptions {
  relayUrl: string;
  workspaceId?: WorkspaceId | string;
  getAuthorization?: (request: {
    url: string;
    method: string;
    body: string;
  }) => Promise<string>;
  getDeviceAuthorization?: () =>
    string | undefined | Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
  createWebSocket?: (url: string) => WebSocket;
}
