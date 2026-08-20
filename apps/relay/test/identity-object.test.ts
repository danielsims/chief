import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { hexKey } from "./helpers";

describe("IdentityObject", () => {
  it("maps independent device keys to the first account identity", async () => {
    const accountSubject = `account-${crypto.randomUUID()}`;
    const firstPubkey = hexKey(`phone-${accountSubject}`);
    const secondPubkey = hexKey(`desktop-${accountSubject}`);
    const account = identityStub(`account:${accountSubject}`);

    const firstAccount = await operation(account, "account-resolve-or-create", {
      accountSubject,
      candidateUserId: firstPubkey,
    });
    const secondAccount = await operation(
      account,
      "account-resolve-or-create",
      {
        accountSubject,
        candidateUserId: secondPubkey,
      },
    );

    expect(await firstAccount.json()).toEqual({ userId: firstPubkey });
    expect(await secondAccount.json()).toEqual({ userId: firstPubkey });

    const phone = identityStub(`device:${firstPubkey}`);
    const desktop = identityStub(`device:${secondPubkey}`);
    expect(
      (
        await operation(phone, "device-bind", {
          accountSubject,
          userId: firstPubkey,
          pubkey: firstPubkey,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await operation(desktop, "device-bind", {
          accountSubject,
          userId: firstPubkey,
          pubkey: secondPubkey,
        })
      ).status,
    ).toBe(201);

    const phoneIdentity = await operation(phone, "device-resolve");
    const desktopIdentity = await operation(desktop, "device-resolve");
    expect(await phoneIdentity.json()).toEqual({
      userId: firstPubkey,
      pubkey: firstPubkey,
    });
    expect(await desktopIdentity.json()).toEqual({
      userId: firstPubkey,
      pubkey: secondPubkey,
    });
  });

  it("rejects rebinding a device key to another account", async () => {
    const pubkey = hexKey(`device-${crypto.randomUUID()}`);
    const device = identityStub(`device:${pubkey}`);
    await operation(device, "device-bind", {
      accountSubject: "account-one",
      userId: pubkey,
      pubkey,
    });

    const conflict = await operation(device, "device-bind", {
      accountSubject: "account-two",
      userId: hexKey("account-two"),
      pubkey,
    });

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "device_binding_conflict" },
    });
  });
});

function identityStub(name: string) {
  const identities = (env as unknown as { IDENTITIES: DurableObjectNamespace })
    .IDENTITIES;
  return identities.get(identities.idFromName(name));
}

function operation(
  stub: DurableObjectStub,
  name: string,
  body?: Record<string, unknown>,
) {
  return stub.fetch("https://identity.internal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chief-internal-operation": name,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
