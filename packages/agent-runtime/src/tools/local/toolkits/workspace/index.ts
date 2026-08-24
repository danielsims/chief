import { getBrandProfileStatusTool } from "./get-brand-profile-status.js";
import { saveBrandProfileTool } from "./save-brand-profile.js";

export const workspaceToolkit = [
  getBrandProfileStatusTool,
  saveBrandProfileTool,
] as const;
