import { describe, expect, it } from "vitest";

import {
  defaultAgentConfigFor,
  effectiveAgentConfigFor,
  hasAgentPermission,
} from "../src/workspace-agent-config";

describe("workspace agent capability policy", () => {
  it("grants Advertising its browser and user-approved plugin tools", () => {
    const config = defaultAgentConfigFor("ads");

    expect(hasAgentPermission(config.toolPermissions, "browser.use")).toBe(
      true,
    );
    expect(
      hasAgentPermission(config.toolPermissions, "integrations.manage"),
    ).toBe(true);
  });

  it("grants Setup its browser and user-approved plugin tools", () => {
    const config = defaultAgentConfigFor("setup");

    expect(hasAgentPermission(config.toolPermissions, "browser.use")).toBe(
      true,
    );
    expect(
      hasAgentPermission(config.toolPermissions, "integrations.manage"),
    ).toBe(true);
  });

  it("grants every agent user-approved plugin connections", () => {
    const config = defaultAgentConfigFor("content");

    expect(
      hasAgentPermission(config.toolPermissions, "integrations.manage"),
    ).toBe(true);
  });

  it("restores Brand's narrow write grant after a client settings save", () => {
    const defaults = defaultAgentConfigFor("brand");
    const config = effectiveAgentConfigFor("brand", {
      ...defaults,
      toolPermissions: defaults.toolPermissions.filter(
        (permission) => permission !== "brand-profile-write",
      ),
    });

    expect(
      hasAgentPermission(config.toolPermissions, "brand-profile-write"),
    ).toBe(true);
    expect(hasAgentPermission(config.toolPermissions, "prospects-write")).toBe(
      false,
    );
  });

  it("restores Prospector's narrow write grant after a client settings save", () => {
    const defaults = defaultAgentConfigFor("prospector");
    const config = effectiveAgentConfigFor("prospector", {
      ...defaults,
      toolPermissions: defaults.toolPermissions.filter(
        (permission) => permission !== "prospects-write",
      ),
    });

    expect(hasAgentPermission(config.toolPermissions, "prospects-write")).toBe(
      true,
    );
    expect(
      hasAgentPermission(config.toolPermissions, "brand-profile-write"),
    ).toBe(false);
  });

  it("does not derive specialist writes after workspace saving is disabled", () => {
    const defaults = defaultAgentConfigFor("brand");
    const config = effectiveAgentConfigFor("brand", {
      ...defaults,
      toolPermissions: defaults.toolPermissions.filter(
        (permission) =>
          permission !== "workspace.write" &&
          permission !== "brand-profile-write",
      ),
    });

    expect(
      hasAgentPermission(config.toolPermissions, "brand-profile-write"),
    ).toBe(false);
  });

  it("upgrades the exact legacy Advertising permission snapshot", () => {
    const config = effectiveAgentConfigFor("ads", {
      enabled: true,
      providerAssigned: true,
      deploymentTarget: "cloud",
      driver: "codex",
      model: "gpt-5.6-luna",
      approvals: "auto",
      capabilities: [],
      integrations: [],
      toolPermissions: [
        "workspace.read",
        "channels.read",
        "channels.create",
        "members.read",
        "members.manage",
        "messages.read",
        "messages.send",
      ],
    });

    expect(config.capabilities).toContain("advanced");
    expect(config.toolPermissions).toContain("browser.use");
    expect(config.toolPermissions).toContain("integrations.manage");
  });

  it("restores the workspace plugin baseline for Advertising", () => {
    const config = defaultAgentConfigFor("ads");
    const customized = effectiveAgentConfigFor("ads", {
      ...config,
      toolPermissions: config.toolPermissions.filter(
        (permission) => permission !== "integrations.manage",
      ),
    });

    expect(customized.toolPermissions).toContain("integrations.manage");
  });

  it("upgrades the exact legacy Setup permission snapshot", () => {
    const config = effectiveAgentConfigFor("setup", {
      enabled: true,
      providerAssigned: true,
      deploymentTarget: "cloud",
      driver: "codex",
      model: "gpt-5.6-luna",
      approvals: "auto",
      capabilities: [],
      integrations: [],
      toolPermissions: [
        "workspace.read",
        "channels.read",
        "channels.create",
        "members.read",
        "members.manage",
        "messages.read",
        "messages.send",
      ],
    });

    expect(config.capabilities).toContain("advanced");
    expect(config.toolPermissions).toContain("browser.use");
    expect(config.toolPermissions).toContain("integrations.manage");
  });

  it("restores the workspace plugin baseline for Setup", () => {
    const config = defaultAgentConfigFor("setup");
    const customized = effectiveAgentConfigFor("setup", {
      ...config,
      toolPermissions: config.toolPermissions.filter(
        (permission) => permission !== "integrations.manage",
      ),
    });

    expect(customized.toolPermissions).toContain("integrations.manage");
  });
});
