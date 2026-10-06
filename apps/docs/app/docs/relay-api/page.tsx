import type { Metadata } from "next";

import { buildDocsModel } from "./docs-model";
import { DocsShell } from "./docs-shell";

export const metadata: Metadata = {
  title: "Relay API | Chief",
  description:
    "The versioned Chief relay protocol for workspaces, channels, messages, files and agents.",
};

export default function RelayApiPage() {
  return <DocsShell model={buildDocsModel()} />;
}
