import {
  ChartNoAxesColumn,
  Megaphone,
  PenLine,
  Target,
  Telescope,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon per agent, keyed by agent id. Line icons instead of emoji so the
 * roster reads as one considered system rather than a chat sticker pack.
 */
const icons: Record<string, LucideIcon> = {
  cmo: Target,
  content: PenLine,
  analyst: ChartNoAxesColumn,
  prospector: Telescope,
  ads: Megaphone,
};

export function AgentIcon({
  agentId,
  size = 16,
  className,
}: {
  agentId: string;
  size?: number;
  className?: string;
}) {
  const Icon = icons[agentId] ?? UserRound;
  return <Icon size={size} strokeWidth={1.75} className={className} />;
}
