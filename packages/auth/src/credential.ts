import { z } from "zod";

import type { createChiefAuth } from "./server";

type ChiefAuth = ReturnType<typeof createChiefAuth>;

const oauthUserInfoSchema = z.object({ sub: z.string().trim().min(1) });

export async function verifyChiefAccountCredential(
  auth: ChiefAuth,
  token: string,
  audience: string,
) {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (session?.user.id) return session.user.id;

  try {
    // Native Chief clients use the OAuth provider's opaque access tokens.
    // Validate those through the provider-owned userinfo action, which checks
    // the token against the auth database. The generic resource-client helper
    // only performs local JWKS verification unless a confidential introspection
    // client is configured, so it cannot validate our public-client opaque
    // tokens.
    const payload = oauthUserInfoSchema.safeParse(
      await auth.api.oauth2UserInfo({ headers }),
    );
    void audience;
    return payload.success ? payload.data.sub : null;
  } catch {
    // Callers deliberately receive no token claims or validation detail.
    return null;
  }
}
