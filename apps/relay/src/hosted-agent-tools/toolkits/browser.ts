import {
  browserTarget,
  requiredString,
  stringArray,
  stringValue,
} from "../input";
import { defineHostedAgentTool } from "../tool";

function browserRequired<T>(browser: T | undefined): T {
  if (!browser) throw new Error("The agent browser is unavailable.");
  return browser;
}

export const hostedBrowserTools = [
  defineHostedAgentTool(
    "browser.open",
    async ({ browser }, input) =>
      await browserRequired(browser).open(requiredString(input, "url"), {
        fresh: input.fresh === true,
      }),
    { requiresBrowser: true, effect: "idempotent" },
  ),
  defineHostedAgentTool(
    "browser.snapshot",
    async ({ browser }) => await browserRequired(browser).snapshot(),
    { requiresBrowser: true, effect: "read_only" },
  ),
  defineHostedAgentTool(
    "browser.click",
    async ({ browser }, input) =>
      await browserRequired(browser).click(browserTarget(input)),
    { requiresBrowser: true, effect: "non_replayable" },
  ),
  defineHostedAgentTool(
    "browser.fill",
    async ({ browser }, input) =>
      await browserRequired(browser).type(
        browserTarget(input),
        stringValue(input, "value"),
      ),
    { requiresBrowser: true, effect: "non_replayable" },
  ),
  defineHostedAgentTool(
    "browser.select",
    async ({ browser }, input) =>
      await browserRequired(browser).select(
        browserTarget(input),
        stringArray(input, "values"),
      ),
    { requiresBrowser: true, effect: "non_replayable" },
  ),
  defineHostedAgentTool(
    "browser.close",
    async ({ browser }) => {
      await browserRequired(browser).close();
      return { closed: true };
    },
    { requiresBrowser: true, effect: "idempotent" },
  ),
];
