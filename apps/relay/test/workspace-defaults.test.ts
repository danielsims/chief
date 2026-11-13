import { describe, expect, it } from "vitest";

import { defaultWorkspaceAgents } from "../src/workspace-defaults";

describe("workspace defaults", () => {
  it("creates one directly addressable Chief with nested specialists", () => {
    expect(defaultWorkspaceAgents).toHaveLength(1);
    expect(defaultWorkspaceAgents[0].id).toBe("chief");
    expect(
      defaultWorkspaceAgents[0].subagents.map((agent) => agent.id),
    ).toEqual([
      "brand",
      "content",
      "analyst",
      "prospector",
      "ads",
      "engineer",
      "setup",
    ]);
    expect(
      defaultWorkspaceAgents[0].subagents.every(
        (agent) => agent.instructions.trim().length > 0,
      ),
    ).toBe(true);
  });
});
