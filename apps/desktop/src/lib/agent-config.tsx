import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AccessMode,
  AgentCapabilityId,
  AgentPreference,
  DriverType,
} from "@marketer/agent-runtime/types";
import {
  type AgentOverride,
  type ApprovalMode,
  getAgentOverride,
  getToolApprovals,
  getWorkspaceProvider,
  onAgentOverridesChange,
  setAgentOverride,
  setToolApprovals,
} from "./agent-overrides";
import { useAgentPreferences } from "./runtime";
import { useAuth } from "./auth/auth-context";

export interface ResolvedAgentConfig {
  driver: DriverType | null;
  model: string;
  enabled: boolean;
  capabilities?: AgentCapabilityId[];
  integrations?: string[];
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
  approvals: ApprovalMode;
  setApprovals(mode: ApprovalMode): void;
  /** Session access derived from the approvals mode. */
  access: AccessMode;
}

const AgentConfigContext = createContext<AgentConfigValue | null>(null);

export function AgentConfigProvider({ children }: { children: ReactNode }) {
  const { cloudOrganizationId } = useAuth();
  const preferences = useAgentPreferences(cloudOrganizationId);
  // Local mirror writes (settings saves, onboarding) re-render consumers.
  const [localVersion, setLocalVersion] = useState(0);
  useEffect(
    () => onAgentOverridesChange(() => setLocalVersion((v) => v + 1)),
    [],
  );

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
      if ((preference.model || undefined) !== local.model) {
        patch.model = preference.model || undefined;
      }
      if (local.enabled !== preference.enabled) {
        patch.enabled = preference.enabled;
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
    const approvals = getToolApprovals(cloudOrganizationId);
    return {
      ready: !loading,
      forAgent: (agentId: string): ResolvedAgentConfig => {
        const durable = byId.get(agentId);
        const mirror = getAgentOverride(cloudOrganizationId, agentId);
        return {
          driver:
            durable?.driver ??
            mirror.driver ??
            getWorkspaceProvider(cloudOrganizationId),
          model: durable?.model ?? mirror.model ?? "",
          enabled: durable?.enabled ?? mirror.enabled ?? true,
          capabilities: durable?.capabilities ?? mirror.capabilities,
          integrations: durable?.integrations ?? mirror.integrations,
        };
      },
      savePreference: save,
      approvals,
      setApprovals: (mode: ApprovalMode) => {
        if (cloudOrganizationId) setToolApprovals(cloudOrganizationId, mode);
      },
      access: approvals === "ask" ? "guarded" : "full",
    };
    // localVersion invalidates the localStorage reads inside forAgent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudOrganizationId, durablePreferences, loading, save, localVersion]);

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
