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
  /** Set while the run waits on a person's answer, such as an approval. */
  private answering: ((answer: string) => void) | null = null;

  constructor(
    readonly conversationId: string,
    readonly threadRootId: string | undefined,
    private readonly client: RelayClient,
    private readonly agentId: string,
    private readonly workerId: string,
    private readonly session: () => AgentSession | null,
    /** The message a lease brings, with anything attached made readable. */
    private readonly instruction: (lease: Lease) => Promise<string> = (lease) =>
      Promise.resolve(instructionOf(lease)),
  ) {}

  admit(jobId: string) {
    this.folding = this.folding
      .then(() => this.fold(jobId))
      .catch((error) => console.error("[cell] steer:", error));
  }

  /**
   * The next message in the run's thread, taken as an answer rather than
   * steering, or undefined if none comes in time.
   */
  awaitAnswer(timeoutMs: number) {
    return new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.answering = null;
        resolve(undefined);
      }, timeoutMs);
      this.answering = (answer) => {
        clearTimeout(timer);
        this.answering = null;
        resolve(answer);
      };
    });
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
      await run(await this.instruction(lease), lease.job.id);
      await this.complete(lease);
    }
  }

  private async fold(jobId: string) {
    const answer = this.answering;
    if (answer) {
      const lease = await this.claim(jobId);
      if (!lease) return;
      answer(await this.instruction(lease));
      await this.complete(lease);
      return;
    }
    const session = this.session();
    if (!session?.canSteer()) {
      this.waiting.push(jobId);
      return;
    }
    const lease = await this.claim(jobId);
    if (!lease) return;
    const instruction = await this.instruction(lease);
    // The turn may have ended while the claim was in flight.
    if (!session.canSteer()) {
      this.held.push(lease);
      return;
    }
    session.steer(instruction);
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

export function instructionOf(lease: Lease) {
  return parseJsonString(lease.job.payload.instruction)?.trim() ?? "";
}
