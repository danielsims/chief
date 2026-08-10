import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

import type * as agent from "../agent.js";
import type * as sessions from "../sessions.js";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  sessions: typeof sessions;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
export declare const components: Record<string, never>;
