import { getBrandProfileStatusTool } from "../../runtime/workspace/get-brand-profile-status.js";
import { saveBrandProfileTool } from "../../runtime/workspace/save-brand-profile.js";

export const workspaceToolkit = [
  getBrandProfileStatusTool,
  saveBrandProfileTool,
] as const;
