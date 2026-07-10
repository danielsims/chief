/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentTools from "../agentTools.js";
import type * as analyticsSnapshots from "../analyticsSnapshots.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as debug from "../debug.js";
import type * as dev from "../dev.js";
import type * as env from "../env.js";
import type * as googleAnalytics from "../googleAnalytics.js";
import type * as http from "../http.js";
import type * as imageAssets from "../imageAssets.js";
import type * as integrations from "../integrations.js";
import type * as lib_auth from "../lib/auth.js";
import type * as socialAccounts from "../socialAccounts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentTools: typeof agentTools;
  analyticsSnapshots: typeof analyticsSnapshots;
  auth: typeof auth;
  billing: typeof billing;
  debug: typeof debug;
  dev: typeof dev;
  env: typeof env;
  googleAnalytics: typeof googleAnalytics;
  http: typeof http;
  imageAssets: typeof imageAssets;
  integrations: typeof integrations;
  "lib/auth": typeof lib_auth;
  socialAccounts: typeof socialAccounts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
