import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { hexPubkeySchema, userIdSchema } from "@chief/relay-contracts";

import type { DeviceAuthorizationEnvironment } from "../src/device-authorization";
import { AuthenticationError } from "../src/auth";
import {
  issueDeviceAuthorization,
  verifyDeviceAuthorization,
} from "../src/device-authorization";
import { hexKey } from "./helpers";

describe("device authorization", () => {
  const deviceEnv: DeviceAuthorizationEnvironment = {
    AUTH_BASE_URL: env.AUTH_BASE_URL,
    BETTER_AUTH_SECRET: "test-device-authorization-secret",
  };

  it("binds a Better Auth user to the NIP-98 key without a Durable Object read", async () => {
    const pubkey = hexPubkeySchema.parse(hexKey("device-one"));
    const userId = userIdSchema.parse("better-auth-user");
    const issued = await issueDeviceAuthorization(deviceEnv, {
      pubkey,
      userId,
    });

    await expect(
      verifyDeviceAuthorization(deviceEnv, issued.deviceAuthorization, pubkey),
    ).resolves.toEqual({ kind: "user", pubkey, userId });
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("rejects a device proof presented with another NIP-98 key", async () => {
    const pubkey = hexPubkeySchema.parse(hexKey("device-one"));
    const issued = await issueDeviceAuthorization(deviceEnv, {
      pubkey,
      userId: userIdSchema.parse("better-auth-user"),
    });

    await expect(
      verifyDeviceAuthorization(
        deviceEnv,
        issued.deviceAuthorization,
        hexPubkeySchema.parse(hexKey("device-two")),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a tampered device proof", async () => {
    const pubkey = hexPubkeySchema.parse(hexKey("device-one"));
    const issued = await issueDeviceAuthorization(deviceEnv, {
      pubkey,
      userId: userIdSchema.parse("better-auth-user"),
    });
    const tampered = `${issued.deviceAuthorization.slice(0, -1)}${
      issued.deviceAuthorization.endsWith("a") ? "b" : "a"
    }`;

    await expect(
      verifyDeviceAuthorization(deviceEnv, tampered, pubkey),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
