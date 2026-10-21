import {
  LendMachineCard,
  MachineActivityCard,
  PairedMachinesCard,
} from "../components/lend-machine-card";
import { useRelaySession } from "../lib/relay-session";
import { useWebMachinePolicy } from "../lib/web-machine";

/** Computers lending their connection to this workspace's agents. */
export function MachinesPage() {
  const { snapshot } = useRelaySession();
  const lending = useWebMachinePolicy(snapshot?.id) !== null;
  if (!snapshot) return null;
  return (
    <div className="space-y-4">
      <LendMachineCard workspaceId={snapshot.id} />
      <PairedMachinesCard workspaceId={snapshot.id} />
      {lending ? <MachineActivityCard workspaceId={snapshot.id} /> : null}
    </div>
  );
}
