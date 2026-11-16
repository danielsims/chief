import { useState } from "react";

import { WorkspaceUnavailableCard } from "./workspace-unavailable-card";

const workspaces = [
  {
    id: "design",
    name: "Design team",
    relayUrl: "https://relay.example.com",
    accountId: "preview",
  },
  {
    id: "studio",
    name: "Studio",
    relayUrl: "https://studio.example.com",
    accountId: "preview",
  },
];

/** Interactive local example; selecting a workspace never contacts a real relay. */
export function WorkspaceUnavailablePreview() {
  const [loading, setLoading] = useState(false);
  const retry = async () => {
    setLoading(true);
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    setLoading(false);
  };
  return (
    <div className="bg-background flex h-dvh items-center justify-center">
      <WorkspaceUnavailableCard
        loading={loading}
        workspaces={workspaces}
        onRetry={retry}
        onSelect={async () => {
          await retry();
          throw new Error("Workspace unavailable");
        }}
        onSignIn={() => undefined}
        connectionSettings={null}
      />
    </div>
  );
}
