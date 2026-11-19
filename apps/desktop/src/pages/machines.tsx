import { LendMachineCard } from "../components/lend-machine-card";
import { MachinesCard } from "../components/machines-card";
import { useRelaySession } from "../lib/relay-session";

/** Computers lending their connection to this workspace's agents. */
export function MachinesPage() {
  const { snapshot } = useRelaySession();
  if (!snapshot) return null;
  return (
    <div className="space-y-4">
      <LendMachineCard workspaceId={snapshot.id} />
      <MachinesCard workspaceId={snapshot.id} />
    </div>
  );
}
