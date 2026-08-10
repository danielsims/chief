import type { Metadata } from "next";

import { buildChannelDocsModel } from "./channels/docs-model";
import { DocsShell } from "./channels/docs-shell";

export const metadata: Metadata = {
  title: "Agent CLI | Chief",
  description:
    "The internal channel, message and proactive-work commands available to Chief agents.",
};

export default function AgentCliPage() {
  return <DocsShell model={buildChannelDocsModel()} />;
}
