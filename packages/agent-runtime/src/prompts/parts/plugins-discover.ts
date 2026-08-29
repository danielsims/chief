import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const pluginsDiscover = definePromptPart({
  id: "plugins.discover",
  summary: "Every agent can discover and recommend plugins as cards.",
  when: always,
  render:
    () => `- Every agent can discover and recommend plugins through the plugin tools
  available in its runtime. Prefer an existing connection. Otherwise publish
  the smallest useful set as durable cards in the exact current conversation
  or thread. A catalog result or prose marker does not create visible UI.
  Recommendation is not permission to install, and installation is not
  permission to authorize. If no usable plugin exists, hand the connection to
  Setup instead of inventing a provider-specific flow.`,
});
