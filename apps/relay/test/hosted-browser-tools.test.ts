import { describe, expect, it } from "vitest";

import { hostedDurableTools } from "../src/hosted-agent-tools";

describe("hosted browser tools", () => {
  it("treats browser navigation as retryable when the browser host rejects it", () => {
    const open = hostedDurableTools({
      browserEnabled: true,
      computerEnabled: false,
    }).find((tool) => tool.definition.name === "browser_open");

    expect(open?.effect).toBe("idempotent");
  });

  it("does not expose browser or computer tools without an assigned machine", () => {
    const tools = hostedDurableTools({
      browserEnabled: false,
      computerEnabled: false,
    });

    expect(
      tools.some((tool) => tool.definition.name.startsWith("browser_")),
    ).toBe(false);
    expect(
      tools.some((tool) => tool.definition.name.startsWith("computer_")),
    ).toBe(false);
  });
});
