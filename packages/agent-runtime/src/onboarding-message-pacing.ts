import { ONBOARDING_OPENING_MESSAGE } from "./onboarding-kickoff.js";

export const ONBOARDING_MESSAGE_INTERVAL_MS = 2_500;

function isOnboardingPublication(input: {
  content: string;
  idempotencyKey?: string;
}) {
  return (
    input.content.includes(ONBOARDING_OPENING_MESSAGE) ||
    input.idempotencyKey?.startsWith("onboarding-") === true
  );
}

/**
 * Keeps onboarding's visible channel publications readable. Each accepted post
 * starts its mentioned agent as usual; the following kickoff waits for a small
 * breathing interval while agents that already started continue independently.
 */
export class OnboardingMessagePacer {
  private readonly nextPublicationAt = new Map<string, number>();

  constructor(
    private readonly intervalMs = ONBOARDING_MESSAGE_INTERVAL_MS,
    private readonly now = () => Date.now(),
    private readonly wait = (delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
  ) {}

  async beforePost(
    workspaceId: string,
    input: { content: string; idempotencyKey?: string },
  ) {
    if (!isOnboardingPublication(input)) return;
    const now = this.now();
    const publicationAt = Math.max(
      now,
      this.nextPublicationAt.get(workspaceId) ?? now,
    );
    this.nextPublicationAt.set(workspaceId, publicationAt + this.intervalMs);
    if (publicationAt > now) await this.wait(publicationAt - now);
  }
}
