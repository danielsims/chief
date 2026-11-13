import { Claude, OpenAI, OpenCode } from "@lobehub/icons";

import type { AgentAvatar as Avatar } from "@chief/relay-contracts";

import type { AgentAppearance, ProviderMark } from "./agent-avatar";
import { agentProviderBrand } from "../lib/agent-provider-brand";

const openCode: ProviderMark = {
  Mark: OpenCode,
  tileClassName: "bg-white text-black",
};
const providerMarks: Partial<Record<string, ProviderMark>> = {
  claude: { Mark: Claude, tileClassName: "bg-[#D97757] text-white" },
  codex: { Mark: OpenAI, tileClassName: "bg-white text-black" },
  opencode: openCode,
};

/** Saved avatars, authored Chief colours, and provider marks use the same renderer everywhere. */
export function agentAppearance(
  profiles: readonly {
    id: string;
    name: string;
    avatar?: Avatar;
    provider?: string;
  }[],
): AgentAppearance {
  return {
    providerMarks: new Map(
      profiles.flatMap((agent) => {
        const brand = agentProviderBrand(agent.provider);
        const mark = brand ? providerMarks[brand] : undefined;
        return mark ? [[agent.id, mark] as const] : [];
      }),
    ),
    agentIds: new Map(
      profiles.map((agent) => [agent.name.toLowerCase(), agent.id]),
    ),
    avatars: new Map(
      profiles.flatMap((agent) =>
        agent.avatar ? [[agent.id, agent.avatar] as const] : [],
      ),
    ),
  };
}
