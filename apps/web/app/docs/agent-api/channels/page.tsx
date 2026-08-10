import type { Metadata } from "next";

import { buildChannelDocsModel } from "./docs-model";
import { DocsShell } from "./docs-shell";

export const metadata: Metadata = {
  title: "Agent CLI | Chief",
  description:
    "The internal channel, message and proactive-work commands available to Chief agents.",
};

export default function ChannelApiPage() {
  return <DocsShell model={buildChannelDocsModel()} />;
}
