import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { hexKey } from "./helpers";

describe("IdentityObject", () => {
  it("maps independent device keys to one relay-local account user", async () => {
    const accountSubject = `account-${crypto.randomUUID()}`;
    const accountUserId = `user-${crypto.randomUUID()}`;
    const firstPubkey = hexKey(`phone-${accountSubject}`);
    const secondPubkey = hexKey(`desktop-${accountSubject}`);
    const account = identityStub(`account:${accountSubject}`);

    const firstAccount = await operation(account, "account-resolve-or-create", {
      accountSubject,
      candidateUserId: accountUserId,
    });
    const secondAccount = await operation(
      account,
      "account-resolve-or-create",
      {
        accountSubject,
        candidateUserId: accountUserId,
      },
    );

    expect(await firstAccount.json()).toEqual({ userId: accountUserId });
    expect(await secondAccount.json()).toEqual({ userId: accountUserId });

    const phone = identityStub(`device:${firstPubkey}`);
    const desktop = identityStub(`device:${secondPubkey}`);
    expect(
      (
        await operation(phone, "device-bind", {
          accountSubject,
          userId: accountUserId,
          pubkey: firstPubkey,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await operation(desktop, "device-bind", {
          accountSubject,
          userId: accountUserId,
          pubkey: secondPubkey,
        })
      ).status,
    ).toBe(201);

    const phoneIdentity = await operation(phone, "device-resolve");
    const desktopIdentity = await operation(desktop, "device-resolve");
    expect(await phoneIdentity.json()).toEqual({
      userId: accountUserId,
      pubkey: firstPubkey,
    });
    expect(await desktopIdentity.json()).toEqual({
      userId: accountUserId,
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

  it("moves the same device and relay user to a new account issuer", async () => {
    const pubkey = hexKey(`migration-${crypto.randomUUID()}`);
    const device = identityStub(`device:${pubkey}`);
    await operation(device, "device-bind", {
      accountSubject: "legacy-account",
      userId: pubkey,
      pubkey,
    });

    const migrated = await operation(device, "device-bind", {
      accountSubject: "relay-local-account",
      userId: pubkey,
      pubkey,
    });

    expect(migrated.status).toBe(200);
    expect(await migrated.json()).toEqual({ userId: pubkey, pubkey });
    expect(await (await operation(device, "device-resolve")).json()).toEqual({
      userId: pubkey,
      pubkey,
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
