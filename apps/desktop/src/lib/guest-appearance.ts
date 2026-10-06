import type { GuestAppearance } from "@chief/agent-runtime/types";
import type {
  ChannelGuestSummary,
  ConversationMessage,
  GuestProvider,
} from "@chief/relay-contracts";

type GuestAuthor = Extract<ConversationMessage["author"], { kind: "guest" }>;

/** The relay's guest author, carried through the desktop as one value. */
export function guestAppearance(author: GuestAuthor): GuestAppearance {
  return {
    id: author.id,
    name: author.name,
    provider: author.provider,
    ...(author.model ? { model: author.model } : undefined),
    ...(author.image ? { image: author.image } : undefined),
    ...(author.mark ? { mark: author.mark } : undefined),
    ...(author.operator ? { operator: author.operator } : undefined),
  };
}

/** A channel's guest list entry, as the same value. */
export function guestSummaryAppearance(
  guest: ChannelGuestSummary,
): GuestAppearance {
  return {
    id: guest.id,
    name: guest.name,
    provider: guest.provider,
    ...(guest.model ? { model: guest.model } : undefined),
    ...(guest.image ? { image: guest.image } : undefined),
    ...(guest.mark ? { mark: guest.mark } : undefined),
    ...(guest.operator ? { operator: guest.operator } : undefined),
  };
}

const providers: Record<
  Exclude<GuestProvider, "other">,
  { name: string; domain: string }
> = {
  claude: { name: "Claude", domain: "claude.ai" },
  openai: { name: "OpenAI", domain: "openai.com" },
  grok: { name: "Grok", domain: "x.ai" },
  gemini: { name: "Gemini", domain: "gemini.google.com" },
  opencode: { name: "opencode", domain: "opencode.ai" },
  openclaw: { name: "OpenClaw", domain: "openclaw.ai" },
  hermes: { name: "Hermes", domain: "nousresearch.com" },
};

/** The product an agent runs on, for its logo and label; none for "other". */
export function guestProvider(provider: GuestProvider | undefined) {
  return provider && provider !== "other" ? providers[provider] : undefined;
}

/** Who a guest is, in a few words: "Claude agent · for Daniel Sims". The
 * operator only appears because the relay verified it through that member's
 * personal invite. */
export function guestLabel(
  guest: Partial<Pick<GuestAppearance, "operator" | "provider">>,
) {
  const product = guestProvider(guest.provider);
  const noun = product ? `${product.name} agent` : "Agent";
  return guest.operator ? `${noun} · for ${guest.operator.name}` : noun;
}
