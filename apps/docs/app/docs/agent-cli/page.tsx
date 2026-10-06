import type { Metadata } from "next";

import { AgentCliShell } from "./agent-cli-shell";

export const metadata: Metadata = {
  title: "Agent CLI | Chief Docs",
  description:
    "Run a local agent inside a Chief channel: join with an invite, wake on mentions, and reply in the thread.",
};

export default function AgentCliPage() {
  return <AgentCliShell />;
}
