import { z } from "zod";

import type { SignInAccount } from "./sign-in-context";
import { env } from "./env";
import {
  forwardedRelayHeaders,
  readRelayAccount,
  relayJson,
} from "./sign-in-context";

/**
 * The public relay origin this web deployment fronts. Hosted heychief.sh
 * proxies to relay.heychief.sh; a self-hosted deployment serves its own relay
 * at the same public origin.
 */
export function publicRelayOrigin(): string {
  return new URL(env.CHIEF_PUBLIC_RELAY_URL ?? env.CHIEF_RELAY_URL).origin;
}

export interface InvitationContext {
  account: SignInAccount | null | undefined;
  workspaceName: string | null;
  invitationEmail: string | null;
}

const invitationViewSchema = z
  .object({
    email: z.string().optional(),
    organization: z
      .object({ id: z.string().optional(), name: z.string().optional() })
      .optional(),
  })
  .nullable();

/**
 * Reads the visitor's relay session and, when possible, the invitation's
 * workspace name through the first-party cookie. `account` is undefined when
 * the relay could not be reached, null when signed out.
 */
export async function readInvitationContext(
  invitationId: string,
): Promise<InvitationContext> {
  const forwarded = await forwardedRelayHeaders();
  const account = await readRelayAccount(forwarded);
  if (!account) {
    return { account, workspaceName: null, invitationEmail: null };
  }
  const payload = await relayJson(
    `/api/auth/organization/get-invitation?id=${encodeURIComponent(invitationId)}`,
    forwarded,
  );
  const parsed = invitationViewSchema.safeParse(payload ?? null);
  if (!parsed.success || !parsed.data) {
    return { account, workspaceName: null, invitationEmail: null };
  }
  return {
    account,
    workspaceName: parsed.data.organization?.name ?? null,
    invitationEmail: parsed.data.email ?? null,
  };
}
