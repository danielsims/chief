import { describe, expect, it } from "vitest";

import { hostedDurableTools } from "../src/hosted-agent-tools";

describe("hosted browser tools", () => {
  it("treats browser navigation as retryable when the browser host rejects it", () => {
    const open = hostedDurableTools(true).find(
      (tool) => tool.definition.name === "browser_open",
    );

    expect(open?.effect).toBe("idempotent");
  });
});
