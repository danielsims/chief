import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { verifyAccountTokenWithKeySet } from "../src/account-token";

describe("account token verification", () => {
  it("accepts the configured issuer/audience and rejects another audience", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "test" };
    const keySet = createLocalJWKSet({ keys: [jwk] });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("account-1")
      .setIssuer("https://auth.test")
      .setAudience("convex")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      verifyAccountTokenWithKeySet(token, keySet, "https://auth.test"),
    ).resolves.toEqual({ accountSubject: "account-1" });
    await expect(
      verifyAccountTokenWithKeySet(
        await new SignJWT({})
          .setProtectedHeader({ alg: "RS256", kid: "test" })
          .setSubject("account-1")
          .setIssuer("https://auth.test")
          .setAudience("another-service")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey),
        keySet,
        "https://auth.test",
      ),
    ).rejects.toThrow(/invalid or expired/u);
  });
});
