import type { SessionRecord } from "@chief/agent-runtime/types";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

const AGENT_WORKING_COLOR: Record<string, string> = {
  brand: "text-foreground",
  prospector: "text-sky-300",
  content: "text-amber-300",
  analyst: "text-cyan-300",
  ads: "text-rose-300",
  setup: "text-emerald-300",
  engineer: "text-orange-300",
};

export function specialistIsStartingOrWorking(status: SessionRecord["status"]) {
  return status === "idle" || status === "running" || status === "waiting";
}

export function SpecialistStatusIndicator({
  agent,
  className,
  status,
}: {
  agent: string;
  className?: string;
  status: SessionRecord["status"];
}) {
  if (specialistIsStartingOrWorking(status)) {
    return (
      <MatrixLoader
        ariaLabel={
          status === "idle"
            ? "Starting"
            : status === "waiting"
              ? "Waiting for you"
              : "Working"
        }
        className={cn(
          "border-0 bg-transparent shadow-none [&_.matrix-loader-cell]:rounded-[24%]",
          AGENT_WORKING_COLOR[agent] ?? "text-slate-300",
          className,
        )}
        size={17}
      />
    );
  }
  if (status === "failed") {
    return (
      <MatrixLoader
        ariaLabel="Failed"
        className={cn(
          "border-0 bg-transparent text-red-500 shadow-none [&_.matrix-loader-cell]:!animate-none [&_.matrix-loader-cell]:!rounded-[24%] [&_.matrix-loader-cell]:!opacity-100",
          className,
        )}
        size={17}
      />
    );
  }
  if (status === "completed") {
    return (
      <MatrixLoader
        ariaLabel="Complete"
        className={cn(
          "border-0 bg-transparent shadow-none [&_.matrix-loader-cell]:!animate-none [&_.matrix-loader-cell]:!rounded-[24%] [&_.matrix-loader-cell]:!opacity-45",
          AGENT_WORKING_COLOR[agent] ?? "text-slate-300",
          className,
        )}
        size={17}
      />
    );
  }
  return null;
}
