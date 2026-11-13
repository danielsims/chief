import type { ReactNode } from "react";
import { useMemo } from "react";
import { Claude, OpenAI, OpenCode } from "@lobehub/icons";

import type { ProviderMark } from "./agent-avatar";
import { AgentAppearanceContext } from "./agent-avatar";
import { useRuntime } from "../lib/runtime";

const openCodeMark: ProviderMark = {
  Mark: OpenCode,
  tileClassName: "bg-white text-black",
};

/** Logos for the providers that run agents on this device, each on its own
 * brand colour, by provider. */
const LOCAL_PROVIDER_MARKS: Partial<Record<string, ProviderMark>> = {
  claude: { Mark: Claude, tileClassName: "bg-[#D97757] text-white" },
  codex: { Mark: OpenAI, tileClassName: "bg-white text-black" },
  opencode: openCodeMark,
  openCodeGo: openCodeMark,
};

/** Supplies every agent's avatar from the live roster, with provider logos for
 * on-device agents that have none. It follows the runtime's roster, which
 * changes as soon as an agent is created or reconfigured. */
export function AgentAppearanceProvider({ children }: { children: ReactNode }) {
  const { agents } = useRuntime();
  const value = useMemo(() => {
    const profiles = agents.flatMap((agent) => [
      agent,
      ...(agent.subagents ?? []),
    ]);
    return {
      providerMarks: new Map(
        profiles.flatMap((agent) => {
          const mark = agent.provider
            ? LOCAL_PROVIDER_MARKS[agent.provider]
            : undefined;
          return mark ? [[agent.id, mark] as const] : [];
        }),
      ),
      agentIds: new Map(
        profiles.map((agent) => [agent.name.toLowerCase(), agent.id] as const),
      ),
      avatars: new Map(
        profiles.flatMap((agent) =>
          agent.avatar ? [[agent.id, agent.avatar] as const] : [],
        ),
      ),
    };
  }, [agents]);
  return (
    <AgentAppearanceContext.Provider value={value}>
      {children}
    </AgentAppearanceContext.Provider>
  );
}

