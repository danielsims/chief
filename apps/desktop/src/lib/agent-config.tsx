import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type {
  AccessMode,
  AgentApprovalMode,
  AgentCapabilityId,
  AgentPreference,
  AgentToolPermission,
  DriverType,
} from "@chief/agent-runtime/types";

import type { AgentOverride, AgentOverrides } from "./agent-overrides";
import {
  getAgentOverride,
  getAgentOverrides,
  getToolApprovals,
  getWorkspaceProvider,
  onAgentOverridesChange,
  setAgentOverride,
} from "./agent-overrides";
import { useAuth } from "./auth/auth-context";
import { useAgentPreferences } from "./runtime";

export interface ResolvedAgentConfig {
  driver: DriverType | null;
  model: string;
  enabled: boolean;
  approvals: AgentApprovalMode;
  access: AccessMode;
  capabilities?: AgentCapabilityId[];
  integrations?: string[];
  toolPermissions?: AgentToolPermission[];
}

interface AgentConfigValue {
  /** False until the durable agent preferences have loaded once. */
  ready: boolean;
  /**
   * Effective config for an agent: durable Agent-settings preference >
   * synchronous localStorage mirror > workspace provider chosen at
   * onboarding. Every chat entry point resolves through this.
   */
  forAgent(agentId: string): ResolvedAgentConfig;
  savePreference(preference: AgentPreference): void;
}

const AgentConfigContext = createContext<AgentConfigValue | null>(null);

export function AgentConfigProvider({ children }: { children: ReactNode }) {
  const { cloudOrganizationId } = useAuth();
  const preferences = useAgentPreferences(cloudOrganizationId);
  const [localConfig, setLocalConfig] = useState<{
    overrides: AgentOverrides;
    approvals: AgentApprovalMode;
    provider: DriverType | null;
  }>(() => ({
    overrides: {},
    approvals: "auto",
    provider: null,
  }));
  useEffect(() => {
    const syncLocalConfig = () => {
      if (!cloudOrganizationId) {
        setLocalConfig({ overrides: {}, approvals: "auto", provider: null });
        return;
      }
      setLocalConfig({
        overrides: getAgentOverrides(cloudOrganizationId),
        approvals: getToolApprovals(cloudOrganizationId),
        provider: getWorkspaceProvider(cloudOrganizationId),
      });
    };
    syncLocalConfig();
    return onAgentOverridesChange(syncLocalConfig);
  }, [cloudOrganizationId]);

  // Hydrate the synchronous localStorage mirror from the runtime database as
  // soon as preferences load, app-wide — previously this only happened when
  // the Agents settings page was visited, so every other entry point saw an
  // empty mirror and asked the user to choose an agent app again.
  useEffect(() => {
    if (!cloudOrganizationId) return;
    for (const preference of preferences.preferences) {
      const local = getAgentOverride(cloudOrganizationId, preference.agentId);
      const patch: AgentOverride = {};
      if (preference.driver && local.driver !== preference.driver) {
        patch.driver = preference.driver;
      }
      if ((preference.model ?? undefined) !== local.model) {
        patch.model = preference.model ?? undefined;
      }
      if (local.enabled !== preference.enabled) {
        patch.enabled = preference.enabled;
      }
      if (
        preference.approvals !== undefined &&
        local.approvals !== preference.approvals
      ) {
        patch.approvals = preference.approvals;
      }
      if (
        JSON.stringify(local.capabilities ?? []) !==
        JSON.stringify(preference.capabilities ?? [])
      ) {
        patch.capabilities = preference.capabilities;
      }
      if (
        JSON.stringify(local.integrations ?? []) !==
        JSON.stringify(preference.integrations ?? [])
      ) {
        patch.integrations = preference.integrations;
      }
      if (
        JSON.stringify(local.toolPermissions ?? []) !==
        JSON.stringify(preference.toolPermissions ?? [])
      ) {
        patch.toolPermissions = preference.toolPermissions;
      }
      if (Object.keys(patch).length > 0) {
        setAgentOverride(cloudOrganizationId, preference.agentId, patch);
      }
    }
  }, [cloudOrganizationId, preferences.preferences]);

  const { preferences: durablePreferences, loading, save } = preferences;
  const value = useMemo<AgentConfigValue>(() => {
    const byId = new Map(
      durablePreferences.map((preference) => [preference.agentId, preference]),
    );
    return {
      ready: !loading,
      forAgent: (agentId: string): ResolvedAgentConfig => {
        const durable = byId.get(agentId);
        const mirror = localConfig.overrides[agentId] ?? {};
        const approvals =
          durable?.approvals ?? mirror.approvals ?? localConfig.approvals;
        return {
          driver: durable?.driver ?? mirror.driver ?? localConfig.provider,
          model: durable?.model ?? mirror.model ?? "",
          enabled: durable?.enabled ?? mirror.enabled ?? true,
          approvals,
          access: approvals === "ask" ? "guarded" : "full",
          capabilities: durable?.capabilities ?? mirror.capabilities,
          integrations: durable?.integrations ?? mirror.integrations,
          toolPermissions: durable?.toolPermissions ?? mirror.toolPermissions,
        };
      },
      savePreference: save,
    };
  }, [durablePreferences, loading, save, localConfig]);

  return (
    <AgentConfigContext.Provider value={value}>
      {children}
    </AgentConfigContext.Provider>
  );
}

export function useAgentConfig(): AgentConfigValue {
  const value = useContext(AgentConfigContext);
  if (!value) {
    throw new Error("useAgentConfig must be used inside AgentConfigProvider");
  }
  return value;
}
