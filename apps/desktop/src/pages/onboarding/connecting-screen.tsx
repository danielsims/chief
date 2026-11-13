import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import type { LocalProviderProbe } from "../../lib/local-provider-probe";
import type { WorkspaceSetup } from "./use-setup";
import { probeLocalProvider } from "../../lib/local-provider-probe";
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

type Joined =
  { ok: true; workspaceId: string } | { ok: false; message: string };

/** What went wrong with the agent app, in a sentence a person can act on. */
function probeMessage(name: string, probe: LocalProviderProbe) {
  if (probe.ok) return "";
  if (probe.reason === "usage") {
    const reset = /try again at ([^.]+)\./iu.exec(probe.detail)?.[1];
    return reset
      ? `${name} is out of usage until ${reset}. Choose another app, or try again then.`
      : `${name} is out of usage right now. Choose another app, or try again later.`;
  }
  if (probe.reason === "signed_out")
    return `${name} isn’t signed in on this computer. Sign in, then try again.`;
  if (probe.reason === "missing")
    return `${name} isn’t installed on this computer. Choose another app.`;
  return `${name} didn’t answer. ${probe.detail}`.trim();
}

/**
 * Checks the agent app answers on this computer while Chief joins the
 * workspace, then confirms Chief is in it. Both run at once so the wait is
 * barely longer than the check; the bar creeps while it works.
 */
export function ConnectingScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const [stages, setStages] = useState<[StageState, StageState]>([
    "pending",
    "pending",
  ]);
  const [progress, setProgress] = useState(6);
  const [error, setError] = useState<{ message: string; app: boolean } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  // Each attempt runs exactly once, using the latest setup values.
  const started = useRef(-1);
  const latest = useRef(s);
  useEffect(() => {
    latest.current = s;
  });
  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;
    let creep: ReturnType<typeof setInterval> | undefined;
    const run = async () => {
      const setup = latest.current;
      const local = setup.draft.location === "device";
      setError(null);
      setStages(["active", "pending"]);
      setProgress(16);
      creep = setInterval(
        () => setProgress((value) => value + (58 - value) * 0.07),
        250,
      );
      const check = async (): Promise<LocalProviderProbe> => {
        if (!local) return { ok: true };
        try {
          return await probeLocalProvider(setup.draft.localProvider);
        } catch (cause) {
          return {
            ok: false,
            reason: "failed",
            detail: cause instanceof Error ? cause.message : String(cause),
          };
        }
      };
      const join = async (): Promise<Joined> => {
        try {
          return { ok: true, workspaceId: await setup.prepareChief() };
        } catch (cause) {
          return {
            ok: false,
            message: cause instanceof Error ? cause.message : String(cause),
          };
        }
      };
      const probe = check();
      // Joining the workspace starts straight away, alongside the check.
      const prepared = join();
      const [checked] = await Promise.all([probe, minimum(700)]);
      clearInterval(creep);
      if (!checked.ok) {
        setStages(["failed", "pending"]);
        setError({
          message: probeMessage(setup.providerName, checked),
          app: true,
        });
        return;
      }
      setStages(["done", "active"]);
      setProgress(68);
      const joined = await prepared;
      try {
        if (!joined.ok) throw new Error(joined.message);
        await Promise.all([
          latest.current.verifyChief(joined.workspaceId),
          minimum(500),
        ]);
      } catch (cause) {
        setStages(["done", "failed"]);
        setError({
          message: cause instanceof Error ? cause.message : String(cause),
          app: false,
        });
        return;
      }
      setStages(["done", "done"]);
      setProgress(100);
    };
    void run();
    return () => clearInterval(creep);
  }, [attempt]);
  const done = stages[1] === "done";
  const failed = Boolean(error);
  const retry = () => setAttempt((value) => value + 1);
  return (
    <>
      <SetupHeading title="Connecting Chief">
        <span role="status">
          {error
            ? error.message
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
      {error?.app ? (
        <>
          <button className="ob-primary" onClick={() => s.go("connect")}>
            Choose another app
          </button>
          <button className="ob-back" onClick={retry}>
            Try again
          </button>
        </>
      ) : error ? (
        <>
          <button className="ob-primary" onClick={retry}>
            Try again
          </button>
          <button className="ob-back" onClick={() => s.go("connect")}>
            Back
          </button>
        </>
      ) : (
        <>
          <button
            className="ob-primary"
            disabled={!done}
            onClick={() => s.go("apps")}
          >
            {done ? "Continue" : "Waiting for connection"}
          </button>
          {done ? (
            <button className="ob-back" onClick={() => s.go("connect")}>
              Back
            </button>
          ) : null}
        </>
      )}
    </>
  );
}
