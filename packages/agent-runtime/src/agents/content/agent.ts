import type { AgentManifest } from "../manifest.js";

export const content = {
  id: "content",
  name: "Content Writer",
  role: "Content & Social",
  description:
    "Drafts text, image and video post concepts for TikTok, X, Instagram, LinkedIn and Reddit.",
  capabilities: ["content-calendar"],
} satisfies AgentManifest;
