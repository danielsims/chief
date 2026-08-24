import type { JsonValue } from "@chief/relay-contracts";

import type { StartOptions } from "../types.js";

export interface AcpRuntimeAdapter {
  name: string;
  command: () => string;
  args: string[];
  configureEnvironment?: (
    options: StartOptions,
    environment: NodeJS.ProcessEnv,
  ) => void;
}

export interface PendingAcpRpc {
  resolve: (value: JsonValue | undefined) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}
