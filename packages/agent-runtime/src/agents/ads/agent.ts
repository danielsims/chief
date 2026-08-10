import type { AgentManifest } from "../manifest.js";

export const ads = {
  id: "ads",
  name: "Ads Manager",
  role: "Paid Acquisition",
  description:
    "Reviews Google Ads performance and ad content; proposes budget and creative changes.",
  capabilities: ["campaign-memory"],
} satisfies AgentManifest;
