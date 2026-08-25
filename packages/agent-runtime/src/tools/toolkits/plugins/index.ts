import { listPluginsTool } from "../../runtime/plugins/list-plugins.js";
import { recommendPluginsTool } from "../../runtime/plugins/recommend-plugins.js";
import { authorizePluginTool } from "./authorize-plugin.js";
import { installPluginTool } from "./install-plugin.js";
import { uninstallPluginTool } from "./uninstall-plugin.js";

export const pluginsToolkit = [
  recommendPluginsTool,
  listPluginsTool,
  installPluginTool,
  authorizePluginTool,
  uninstallPluginTool,
] as const;
