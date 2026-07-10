import {
  defineAgent,
  prospectMemoryCapability,
  trendMemoryCapability,
} from "../../capabilities/index.js";
import { instructions } from "./instructions.js";

export const prospector = defineAgent({
  id: "prospector",
  name: "Prospector",
  role: "Prospecting & Trends",
  description:
    "Finds new prospects and trending conversations worth joining across Twitter, Reddit and other channels.",
  capabilities: [prospectMemoryCapability, trendMemoryCapability],
  instructions,
});
