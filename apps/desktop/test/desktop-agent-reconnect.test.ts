import assert from "node:assert/strict";
import { test } from "node:test";

import { RelayClientError } from "@chief/relay-client";
import { agentIdSchema } from "@chief/relay-contracts";

import { registerDesktopAgentKeys } from "../src/lib/desktop-agent-reconnect";

const previous = "ab".repeat(32);
const identities = ["chief", "engineer"].map((agentId) => ({
  agentId,
  pubkey: "cd".repeat(32),
}));
const conflict = () =>
  new RelayClientError("Mismatch", 409, "agent_key_already_registered", {
    pubkey: previous,
  });
void test("asks once, and replaces only after confirmation with the expected old key", async () => {
  const calls: unknown[][] = [];
  let prompts = 0;
  const ready = await registerDesktopAgentKeys(
    identities,
    {
      registerAgentKey: (id, key, old) => {
        calls.push([id, key, old]);
        return old
          ? Promise.resolve({ agentId: agentIdSchema.parse(id), pubkey: key })
          : Promise.reject(conflict());
      },
    },
    (ids) => {
      prompts++;
      assert.equal(ids.length, 2);
      assert.equal(calls.length, 2);
      return Promise.resolve(true);
    },
  );
  assert.equal(prompts, 1);
  assert.equal(ready.size, 2);
  assert.deepEqual(
    calls.slice(2).map((c) => c[2]),
    [previous, previous],
  );
});
void test("declining leaves working agents available without replacing any key", async () => {
  const ready = await registerDesktopAgentKeys(
    identities,
    {
      registerAgentKey: (id, key, old) => {
        assert.equal(old, undefined);
        return id === "chief"
          ? Promise.reject(conflict())
          : Promise.resolve({ agentId: agentIdSchema.parse(id), pubkey: key });
      },
    },
    () => Promise.resolve(false),
  );
  assert.deepEqual([...ready], ["engineer"]);
});
void test("authorization failures and old relays cannot trigger replacement", async () => {
  for (const error of [
    new RelayClientError("Denied", 403),
    new RelayClientError("Old relay", 409, "agent_key_already_registered"),
  ]) {
    await assert.rejects(
      registerDesktopAgentKeys(
        identities,
        { registerAgentKey: () => Promise.reject(error) },
        () => {
          assert.fail("Unexpected recovery prompt");
        },
      ),
      (caught) => caught === error,
    );
  }
});
