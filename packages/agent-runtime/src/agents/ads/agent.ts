import {
  campaignMemoryCapability,
  defineAgent,
} from "../../capabilities/index.js";
import { instructions } from "./instructions.js";

export const ads = defineAgent({
  id: "ads",
  name: "Ads Manager",
  role: "Paid Acquisition",
  description:
    "Reviews Google Ads performance and ad content; proposes budget and creative changes.",
  capabilities: [campaignMemoryCapability],
  instructions,
});
