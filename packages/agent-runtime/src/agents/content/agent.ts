import {
  contentCalendarCapability,
  defineAgent,
} from "../../capabilities/index.js";
import { instructions } from "./instructions.js";

export const content = defineAgent({
  id: "content",
  name: "Content Writer",
  role: "Content & Social",
  description:
    "Drafts text, image and video post concepts for TikTok, X, Instagram, LinkedIn and Reddit.",
  capabilities: [contentCalendarCapability],
  instructions,
});
