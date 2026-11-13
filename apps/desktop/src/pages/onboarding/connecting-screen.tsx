import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import type { WorkspaceSetup } from "./use-setup";
import { SetupHeading } from "./elements";

export type StageState = "pending" | "active" | "done" | "failed";

/** Long enough to read each stage, short enough never to feel slow. */
const minimum = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function ProgressStages({
  progress,
  stopped,
  stages,
}: {
  /** Percent for the sky bar; leave out for stages alone. */
  progress?: number;
  stopped?: boolean;
  stages: { label: string; state: StageState }[];
}) {
  return (
    <>
      {progress === undefined ? null : (
        <div
          className={stopped ? "ob-sky-bar is-stopped" : "ob-sky-bar"}
          aria-hidden="true"
        >
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
      <ol className="ob-stages">
        {stages.map((stage) => (
          <li key={stage.label} className="ob-stage" data-state={stage.state}>
            <span className="ob-stage-dot">
              {stage.state === "done" ? (
                <Check size={10} strokeWidth={3.5} />
              ) : stage.state === "failed" ? (
                <X size={10} strokeWidth={3.5} />
              ) : null}
            </span>
            <span>{stage.label}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Connects Chief to the chosen agent app, then confirms Chief is in the
 * workspace. Each stage is real work, shown for a moment so it can be read.
 */
export function ConnectingScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const [stages, setStages] = useState<[StageState, StageState]>([
    "pending",
    "pending",
  ]);
  const [progress, setProgress] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Each attempt runs exactly once, using the latest setup functions.
  const started = useRef(-1);
  const actions = useRef({
    prepareChief: s.prepareChief,
    verifyChief: s.verifyChief,
  });
  useEffect(() => {
    actions.current = {
      prepareChief: s.prepareChief,
      verifyChief: s.verifyChief,
    };
  });
  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;
    const fail = (stage: 0 | 1, message: string) => {
      setStages(stage === 0 ? ["failed", "pending"] : ["done", "failed"]);
      setError(message);
    };
    const run = async () => {
      setError(null);
      setStages(["active", "pending"]);
      setProgress(24);
      let workspaceId: string;
      try {
        [workspaceId] = await Promise.all([
          actions.current.prepareChief(),
          minimum(1100),
        ]);
      } catch (cause) {
        fail(0, cause instanceof Error ? cause.message : String(cause));
        return;
      }
      setStages(["done", "active"]);
      setProgress(64);
      try {
        await Promise.all([
          actions.current.verifyChief(workspaceId),
          minimum(800),
        ]);
      } catch (cause) {
        fail(1, cause instanceof Error ? cause.message : String(cause));
        return;
      }
      setStages(["done", "done"]);
      setProgress(100);
    };
    void run();
  }, [attempt]);
  const done = stages[1] === "done";
  const failed = Boolean(error);
  return (
    <>
      <SetupHeading title="Connecting Chief">
        <span role="status">
          {failed
            ? error
            : done
              ? `Chief is connected to ${s.providerName}.`
              : `Connecting Chief to ${s.providerName}.`}
        </span>
      </SetupHeading>
      <ProgressStages
        progress={progress}
        stopped={failed}
        stages={[
          { label: `Connecting ${s.providerName}`, state: stages[0] },
          { label: "Connect Chief to your workspace", state: stages[1] },
        ]}
      />
      {failed ? (
        <button
          className="ob-primary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </button>
      ) : (
        <button
          className="ob-primary"
          disabled={!done}
          onClick={() => s.go("apps")}
        >
          {done ? "Continue" : "Waiting for connection"}
        </button>
      )}
      {done || failed ? (
        <button className="ob-back" onClick={() => s.go("connect")}>
          Back
        </button>
      ) : null}
    </>
  );
}
