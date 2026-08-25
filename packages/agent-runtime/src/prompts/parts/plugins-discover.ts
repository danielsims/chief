import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const pluginsDiscover = definePromptPart({
  id: "plugins.discover",
  summary: "Every agent can discover and recommend plugins as cards.",
  when: always,
  render:
    () => `- Every agent can discover and recommend plugins. When an external service
  would help, use localTools.pluginsList privately when catalog discovery is
  needed, then call localTools.pluginsRecommend with the exact current
  channelId and threadRootId to publish the smallest useful set as durable,
  actionable cards. In a direct message, use its channelId and omit
  threadRootId unless replying inside a thread. The recommendation call, not a
  pluginsList result and never a prose marker such as "Card:", creates visible
  conversation UI. Recommendation is not permission to install; installation
  is not permission to authorize. Never replace a real catalog match with
  prose telling the user to visit settings. If no usable plugin exists,
  continue through Chief's secure setup, Executor, browser, or
  workspace-secret path as one coherent fallback.`,
});
