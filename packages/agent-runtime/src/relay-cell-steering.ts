import type { RelayClient } from "@chief/relay-client";
import { parseJsonString } from "@chief/relay-contracts";

import type { AgentSession } from "./session.js";

type Lease = NonNullable<Awaited<ReturnType<RelayClient["claimAgentJob"]>>>;

/**
 * Messages sent to a thread while its run is going. Each joins the run rather
 * than replacing it: folded into the turn at the backend's next step when it
 * can take it, otherwise run in order before the run ends. A message is claimed
 * only once it is acted on, so one this run never reaches still runs as its
 * own job afterwards.
 */
export class RunSteering {
  private readonly waiting: string[] = [];
  private readonly held: Lease[] = [];
  private folding = Promise.resolve();

  constructor(
    readonly conversationId: string,
    readonly threadRootId: string | undefined,
    private readonly client: RelayClient,
    private readonly agentId: string,
    private readonly workerId: string,
    private readonly session: () => AgentSession | null,
  ) {}

  admit(jobId: string) {
    this.folding = this.folding
      .then(() => this.fold(jobId))
      .catch((error) => console.error("[cell] steer:", error));
  }

  /** Runs every message that missed the turn, then lets the run end. */
  async drain(run: (instruction: string, jobId: string) => Promise<boolean>) {
    // The run continues while any message is still pending.
    for (;;) {
      await this.folding;
      for (const jobId of this.waiting.splice(0)) {
        const lease = await this.claim(jobId);
        if (lease) this.held.push(lease);
      }
      const lease = this.held.shift();
      if (!lease) return;
      await run(instructionOf(lease), lease.job.id);
      await this.complete(lease);
    }
  }

  private async fold(jobId: string) {
    const session = this.session();
    if (!session?.canSteer()) {
      this.waiting.push(jobId);
      return;
    }
    const lease = await this.claim(jobId);
    if (!lease) return;
    // The turn may have ended while the claim was in flight.
    if (!session.canSteer()) {
      this.held.push(lease);
      return;
    }
    session.steer(instructionOf(lease));
    await this.complete(lease);
  }

  private claim(jobId: string) {
    return this.client.claimAgentJob(this.agentId, this.workerId, 300, jobId);
  }

  // The run's own reply answers a steered message.
  private complete(lease: Lease) {
    return this.client.completeAgentJob(this.agentId, {
      leaseToken: lease.leaseToken,
      outcome: { status: "completed", result: {} },
    });
  }
}

function instructionOf(lease: Lease) {
  return parseJsonString(lease.job.payload.instruction)?.trim() ?? "";
}
