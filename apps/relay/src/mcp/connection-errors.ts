import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

import { HttpError } from "../http";
import { McpFetchError } from "./fetch-guard";

/** Never let a provider's error text (which may echo request data) through. */
export function parseFailureMessage(error: unknown) {
  if (error instanceof HttpError || error instanceof McpFetchError)
    return error.message;
  if (error instanceof UnauthorizedError)
    return "The plugin needs to be connected again.";
  return "Chief could not reach this plugin.";
}
