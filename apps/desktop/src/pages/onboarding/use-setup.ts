import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { RelayClient } from "@chief/relay-client";
import type {
  AccountProfile,
  OwnedAgent,
  OwnedAgentRequest,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import {
  createWorkspaceCommandSchema,
  suggestedAgentIds,
  welcomeChannelId,
} from "@chief/relay-contracts";

import type { SetupDraft, SetupStep } from "./model";
import { useAcceptAgentRequest } from "../../components/agents/owned-agents-panel";
import { useAuth } from "../../lib/auth/auth-context";
import { RELAY_URL } from "../../lib/config";
import { useRelaySession } from "../../lib/relay-session";
import { useRuntime } from "../../lib/runtime";
import {
  activeSetupKey,
  newSetupDraft,
  readSetupDraft,
  resumeSetupDraft,
  workspaceSetupDraftKey,
} from "./model";
import {
  cachedSetupProfile,
  loadSetupProfile,
  rememberSetupProfile,
} from "./profile-cache";

export function useWorkspaceSetup() {
  const auth = useAuth();
  const relay = useRelaySession();
  const navigate = useNavigate();
  const key = `chief.workspace-setup.v1:${RELAY_URL}:${auth.user?.id ?? "anonymous"}`;
  const cachedProfile = useMemo(() => cachedSetupProfile(key), [key]);
  const [draft, setDraft] = useState(() => {
    const saved = readSetupDraft(key);
    const intent = new URLSearchParams(window.location.search).get("intent");
    const wantsNew = intent === "create" || intent === "add";
    const resumable =
      !wantsNew && relay.snapshot?.setupComplete === false
        ? relay.snapshot
        : null;
    const workspaceDraft = resumable
      ? readSetupDraft(workspaceSetupDraftKey(key, resumable.id))
      : null;
    // A remount or reload of the same setup keeps its progress; only a fresh
    // "Create a workspace" starts over.
    const sameSession =
      sessionStorage.getItem(activeSetupKey(key)) === saved.commandId;
    const current = resumable
      ? resumeSetupDraft(
          workspaceDraft?.workspaceId === resumable.id
            ? workspaceDraft
            : saved.workspaceId === resumable.id
              ? saved
              : newSetupDraft(),
          resumable,
        )
      : wantsNew && saved.workspaceId && !sameSession
        ? newSetupDraft()
        : saved;
    return cachedProfile?.username && current.step === "profile"
      ? { ...current, step: "workspace" as const }
      : current;
  });
  const [profile, setProfile] = useState<AccountProfile | null>(cachedProfile);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(!cachedProfile);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState(cachedProfile?.username ?? "");
  const [invite, setInvite] = useState<{
    link: string;
    expiresAt: string;
  } | null>(null);
  const [requests, setRequests] = useState<OwnedAgentRequest[]>([]);
  const accept = useAcceptAgentRequest();
  // Agents this device runs join as on-device agents, not connections.
  const { agents: runtimeAgents } = useRuntime();
  const joined = useMemo(
    () => runtimeAgents.filter((agent) => agent.connectionKind === "owned"),
    [runtimeAgents],
  );
  const [agents, setAgents] = useState<OwnedAgent[]>([]);
  const running = useRef(false);
  const client = useMemo(
    () =>
      draft.workspaceId
        ? (relay.client?.forWorkspace(draft.workspaceId) ?? null)
        : null,
    [draft.workspaceId, relay.client],
  );
  const patch = (value: Partial<SetupDraft>) =>
    setDraft((current) => ({ ...current, ...value }));
  const go = (step: SetupStep) => {
    setError(null);
    patch({ step });
  };
  useEffect(() => {
    sessionStorage.setItem(activeSetupKey(key), draft.commandId);
    localStorage.setItem(key, JSON.stringify(draft));
    if (draft.workspaceId)
      localStorage.setItem(
        workspaceSetupDraftKey(key, draft.workspaceId),
        JSON.stringify(draft),
      );
  }, [draft, key]);
  useEffect(() => {
    if (!relay.client) return;
    let stopped = false;
    Promise.all([
      loadSetupProfile(relay.client, key),
      draft.workspaceId
        ? relay.client.forWorkspace(draft.workspaceId).setupSnapshot()
        : Promise.resolve(null),
    ])
      .then(([account, workspace]) => {
        if (stopped) return;
        setError(null);
        setProfile(account);
        setUsername(account.username ?? "");
        setSnapshot(workspace);
        setLoading(false);
        setDraft((current) => ({
          ...current,
          step:
            account.username && current.step === "profile"
              ? "workspace"
              : current.step,
        }));
      })
      .catch((e: unknown) => {
        if (!stopped) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      stopped = true;
    };
    // Workspace creation updates snapshot directly; reload only on account/client changes or retry.
  }, [relay.client, key, retry, draft.workspaceId]);
  const run = async (action: () => Promise<void>, label = "") => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setActivity(label);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setBusy(false);
      setActivity("");
    }
  };
  const refreshAgents = async () => {
    if (!client) return;
    const [pending, connected] = await Promise.all([
      client.ownedAgentRequests(),
      client.ownedAgents(),
    ]);
    setRequests(pending.requests);
    setAgents(connected.agents.filter((a) => a.owner.userId === auth.user?.id));
    if (pending.requests.length)
      setDraft((current) =>
        current.step === "invite" ? { ...current, step: "approve" } : current,
      );
  };
  useEffect(() => {
    if (!client || !["invite", "approve", "success"].includes(draft.step))
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [pending, connected] = await Promise.all([
          client.ownedAgentRequests(),
          client.ownedAgents(),
        ]);
        if (stopped) return;
        setRequests(pending.requests);
        setAgents(
          connected.agents.filter((a) => a.owner.userId === auth.user?.id),
        );
        if (pending.requests.length)
          setDraft((current) =>
            current.step === "invite"
              ? { ...current, step: "approve" }
              : current,
          );
        setPollError(null);
      } catch (e) {
        if (!stopped) setPollError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 4000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client, draft.step, auth.user?.id]);
  // The setup prompt is ready to copy on arrival, on either agent step.
  useEffect(() => {
    if (!client || !["invite", "approve"].includes(draft.step) || invite)
      return;
    let stopped = false;
    const timer = setTimeout(() => {
      void client
        .createOwnedAgentInvite()
        .then((result) => {
          if (!stopped)
            setInvite({
              link: result.connectionUrl,
              expiresAt: result.expiresAt,
            });
        })
        .catch((e: unknown) => {
          if (!stopped) setError(e instanceof Error ? e.message : String(e));
        });
    }, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client, draft.step, invite]);
  const saveProfile = () =>
    run(async () => {
      if (!relay.client)
        throw new Error("Chief is reconnecting. Please try again.");
      const saved = await relay.client.setUsername(username);
      setUsername(saved.username);
      setProfile((current) => {
        if (!current) return current;
        const next = { ...current, username: saved.username };
        rememberSetupProfile(key, next);
        return next;
      });
      go("workspace");
    });
  const providerName =
    draft.location === "device"
      ? { codex: "ChatGPT", claude: "Claude", opencode: "OpenCode" }[
          draft.localProvider
        ]
      : draft.service === "opencode"
        ? "OpenCode"
        : "Vercel AI Gateway";
  /** Creates the workspace with Chief, or points an existing Chief at the chosen app. */
  const prepareChief = async (): Promise<string> => {
    if (draft.workspaceId) {
      // Chief already exists: a different agent app just changes what
      // Chief and its teammates run on.
      if (draft.location === "device" && client && snapshot)
        await applyLocalProvider(client, snapshot, draft.localProvider);
      return draft.workspaceId;
    }
    const command = createWorkspaceCommandSchema.parse({
      commandId: draft.commandId,
      name: draft.name,
      slug: draft.slug,
      purpose: draft.purpose,
      companyName: draft.purpose === "company" ? draft.companyName : undefined,
      website: draft.purpose === "company" ? draft.website : "",
      runtime: draft.location === "device" ? "desktop" : "cloud",
      agentRuntime: draft.location === "cloud" ? draft.host : "relay-cell",
      inferenceProvider:
        draft.location === "device" ? "onDevice" : draft.service,
      localProvider: draft.localProvider,
      inferenceModel: "auto",
      selectedAgentIds: draft.selectedAgentIds,
      selectedApps: draft.selectedApps,
    });
    const created = await relay.createWorkspace(command, apiKey, {
      reconnect: false,
    });
    setSnapshot(created);
    setApiKey("");
    patch({ workspaceId: created.id });
    return created.id;
  };
  /** Reads the workspace back and confirms Chief is in it. */
  const verifyChief = async (workspaceId: string) => {
    if (!relay.client) throw new Error("Chief is reconnecting. Try again.");
    const loaded = await relay.client.forWorkspace(workspaceId).setupSnapshot();
    if (!loaded.agents.some((agent) => agent.id === "chief"))
      throw new Error("Chief isn’t in your workspace yet. Try again.");
    setSnapshot(loaded);
  };
  const eveSetup = draft.location === "cloud" && draft.host === "vercel-eve";
  /** Eve deploys on its own screen; everything else shows Connecting Chief. */
  const connect = () =>
    eveSetup
      ? run(async () => {
          await prepareChief();
          go("eve");
        }, `Connecting ${providerName}`)
      : go("connecting");
  const createInvite = () =>
    run(async () => {
      if (!client)
        throw new Error("Create your workspace before inviting agents.");
      const result = await client.createOwnedAgentInvite();
      setInvite({ link: result.connectionUrl, expiresAt: result.expiresAt });
    });
  const decide = (id: string, approve: boolean, name: string) =>
    run(async () => {
      const request = requests.find((entry) => entry.id === id);
      if (!client || !request) return;
      if (approve) await accept(client, request, name);
      else await client.decideOwnedAgent(id, false);
      await refreshAgents();
    });
  const enter = () =>
    run(async () => {
      if (!client || !draft.workspaceId)
        throw new Error("Your workspace is still reconnecting.");
      if (draft.emails.length) {
        const sent = await client.listWorkspaceInvitations();
        for (const email of draft.emails) {
          if (
            !sent.some(
              (i) =>
                i.email.toLowerCase() === email &&
                i.status === "pending" &&
                Date.parse(i.expiresAt) > Date.now(),
            )
          )
            await client.createWorkspaceInvitation({ email, role: "member" });
        }
      }
      await client.finishWorkspaceSetup(draft.selectedApps);
      // Already in this workspace when setup was resumed: switching would be a
      // no-op and keep the unfinished snapshot, which sends you back to setup.
      if (relay.client?.workspaceId === draft.workspaceId)
        await relay.refresh();
      else await relay.switchWorkspace(draft.workspaceId);
      localStorage.removeItem(key);
      localStorage.removeItem(workspaceSetupDraftKey(key, draft.workspaceId));
      sessionStorage.removeItem(activeSetupKey(key));
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const entry = sessionStorage.key(i);
        if (entry?.startsWith("chief.active-workspace-create.v1:"))
          sessionStorage.removeItem(entry);
      }
      sessionStorage.removeItem("chief.pending-workspace-create-relay.v1");
      void navigate(
        `/conversations?channel=${encodeURIComponent(welcomeChannelId(auth.user?.id ?? ""))}`,
        { replace: true },
      );
    }, "Opening your workspace");
  return {
    auth,
    relay,
    client,
    draft,
    profile,
    snapshot,
    loading,
    busy,
    error: error ?? pollError,
    activity,
    apiKey,
    username,
    invite,
    requests,
    joined,
    agents,
    patch,
    go,
    run,
    providerName,
    prepareChief,
    verifyChief,
    setApiKey,
    setUsername,
    setError,
    saveProfile,
    connect,
    createInvite,
    decide,
    enter,
    retry: () => {
      setLoading(true);
      setRetry((n) => n + 1);
    },
    setPurpose: (purpose: SetupDraft["purpose"]) =>
      patch({ purpose, selectedAgentIds: suggestedAgentIds(purpose) }),
  };
}
export type WorkspaceSetup = ReturnType<typeof useWorkspaceSetup>;

async function applyLocalProvider(
  client: NonNullable<ReturnType<RelayClient["forWorkspace"]>>,
  snapshot: WorkspaceSnapshot,
  provider: SetupDraft["localProvider"],
) {
  const chief = snapshot.agents.find((agent) => agent.id === "chief");
  const ids = ["chief", ...(chief?.subagents.map((agent) => agent.id) ?? [])];
  for (const id of ids) {
    const { config } = await client.loadAgentConfig(id);
    if (config.inference.provider === provider) continue;
    await client.saveAgentConfig(id, {
      ...config,
      inference:
        provider === "opencode"
          ? { provider, model: "auto", secretRef: "opencode" }
          : { provider, model: "auto" },
    });
  }
}
