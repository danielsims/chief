import { listCampaignsTool } from "./list-campaigns.js";
import { saveCampaignTool } from "./save-campaign.js";

export const campaignsToolkit = [listCampaignsTool, saveCampaignTool] as const;
