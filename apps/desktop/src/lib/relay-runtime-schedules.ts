import type { ClientMessage } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { workspaceScheduleInputSchema } from "@chief/relay-contracts";

export async function routeRelayScheduleCommand(
  message: ClientMessage,
  relay: Pick<RelayClient, "schedules">,
) {
  switch (message.type) {
    case "saveRecurringWork": {
      const saved = await relay.schedules.save(
        workspaceScheduleInputSchema.parse(message.work),
      );
      if (message.work.status === "active" && saved.status !== "active") {
        await relay.schedules.act(
          saved.id,
          saved.status === "needs_approval" || saved.status === "draft"
            ? "approve"
            : "resume",
          { expectedUpdatedAt: saved.updatedAt },
        );
      } else if (
        message.work.status === "paused" &&
        saved.status !== "paused"
      ) {
        await relay.schedules.act(saved.id, "pause");
      }
      return true;
    }
    case "runRecurringWorkNow":
      await relay.schedules.act(message.recurringWorkId, "run");
      return true;
    case "deleteRecurringWork":
      await relay.schedules.delete(message.recurringWorkId);
      return true;
    default:
      return false;
  }
}
