import { useEffect, useRef, useState } from "react";

import type {
  AgentPreference,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

export function useWorkspaceFiles(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    workspaceId: string | null;
    client: typeof client;
    files: WorkspaceFileRecord[];
    loaded: boolean;
    error: string | null;
  }>({ workspaceId, client, files: [], loaded: false, error: null });
  const current = state.workspaceId === workspaceId && state.client === client;
  useEffect(() => {
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    )
      return;
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(
      () =>
        setState((previous) => ({
          workspaceId,
          client,
          files:
            previous.workspaceId === workspaceId && previous.client === client
              ? previous.files
              : [],
          loaded: true,
          error: "Files are taking longer than expected. Try again.",
        })),
      20_000,
    );
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceFiles" &&
        message.workspaceId === workspaceId
      ) {
        window.clearTimeout(timer);
        setState({
          workspaceId,
          client,
          files: message.files,
          loaded: true,
          error: null,
        });
      }
      if (message.type === "error" && message.requestId === requestId) {
        window.clearTimeout(timer);
        setState({
          workspaceId,
          client,
          files: [],
          loaded: true,
          error: message.message,
        });
      }
    });
    client.send({
      type: "listWorkspaceFiles",
      workspaceId,
      requestId,
      executorCapability: capability,
    });
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        client.send({
          type: "listWorkspaceFiles",
          workspaceId,
          requestId,
          executorCapability: capability,
        });
    }, 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(refreshTimer);
      unsubscribe();
    };
  }, [attempt, capability, client, cloudOrganizationId, status, workspaceId]);
  return {
    files: current ? state.files : [],
    loading: Boolean(workspaceId && (!current || !state.loaded)),
    error: current ? state.error : null,
    refresh: () => setAttempt((value) => value + 1),
  };
}

export function useWorkspaceFile(
  workspaceId: string | null,
  fileId: string | null,
) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const key = workspaceId && fileId ? `${workspaceId}\0${fileId}` : null;
  const [state, setState] = useState<{
    key: string | null;
    client: typeof client;
    file: WorkspaceFileSnapshot | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
  }>({
    key,
    client,
    file: null,
    loading: Boolean(key),
    saving: false,
    error: null,
  });
  const active =
    state.key === key && state.client === client
      ? state
      : {
          key,
          client,
          file: null,
          loading: Boolean(key),
          saving: false,
          error: null,
        };
  const pendingRequests = useRef(new Set<string>());
  useEffect(() => {
    if (
      !workspaceId ||
      !fileId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    )
      return;
    const requestId = crypto.randomUUID();
    const requests = pendingRequests.current;
    requests.add(requestId);
    const unsubscribe = client.subscribe((message) => {
      if (
        (message.type === "workspaceFile" ||
          message.type === "workspaceFileSaved") &&
        message.workspaceId === workspaceId &&
        message.file.id === fileId
      ) {
        pendingRequests.current.delete(message.requestId);
        setState({
          key,
          client,
          file: message.file,
          loading: false,
          saving: false,
          error: null,
        });
      }
      if (
        message.type === "error" &&
        message.requestId &&
        pendingRequests.current.delete(message.requestId)
      ) {
        setState((previous) => ({
          key,
          client,
          file:
            previous.key === key && previous.client === client
              ? previous.file
              : null,
          loading: false,
          saving: false,
          error:
            message.message.includes("version_conflict") ||
            message.message === "FILE_VERSION_CONFLICT"
              ? "This file changed since you opened it. Copy your edits, then reopen the file before saving."
              : message.message,
        }));
      }
    });
    client.send({
      type: "getWorkspaceFile",
      workspaceId,
      fileId,
      requestId,
      executorCapability: capability,
    });
    return () => {
      requests.clear();
      unsubscribe();
    };
  }, [
    capability,
    client,
    cloudOrganizationId,
    fileId,
    key,
    status,
    workspaceId,
  ]);
  const save = (content: string, name?: string) => {
    if (
      !workspaceId ||
      !active.file ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      active.file.asset
    )
      return;
    if (status !== "connected") {
      setState({ ...active, error: "Reconnect to save your changes." });
      return;
    }
    const requestId = crypto.randomUUID();
    pendingRequests.current.add(requestId);
    setState({ ...active, saving: true, error: null });
    client.send({
      type: "saveWorkspaceFile",
      workspaceId,
      requestId,
      file: {
        id: active.file.id,
        name: name?.trim() ? name.trim() : active.file.name,
        path: active.file.path,
        mimeType: active.file.mimeType,
        kind: active.file.kind,
        content,
        expectedVersionId: active.file.currentVersionId,
        createdBy: "user",
        sourceAgentId: active.file.sourceAgentId,
        sourceSessionId: active.file.sourceSessionId,
      },
      executorCapability: capability,
    });
  };
  return { ...active, save };
}

interface EmailPreview {
  html: string;
  text: string;
  versionId: string;
}

export function useWorkspaceEmailPreview(
  workspaceId: string | null,
  file: WorkspaceFileSnapshot | null,
) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const cacheKey =
    workspaceId && file
      ? `${workspaceId}\0${file.id}\0${file.currentVersionId}`
      : null;
  interface EmailPreviewState {
    client: typeof client;
    key: string | null;
    preview: EmailPreview | null;
    loading: boolean;
    error: string | null;
  }
  const [state, setState] = useState<EmailPreviewState>({
    client,
    key: cacheKey,
    preview: null,
    loading: Boolean(cacheKey),
    error: null,
  });
  const active: EmailPreviewState =
    state.key === cacheKey && state.client === client
      ? state
      : {
          client,
          key: cacheKey,
          preview: null,
          loading: Boolean(cacheKey),
          error: null,
        };

  useEffect(() => {
    const nextKey =
      workspaceId && file
        ? `${workspaceId}\0${file.id}\0${file.currentVersionId}`
        : null;
    if (
      !nextKey ||
      !workspaceId ||
      file?.kind !== "email" ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "workspaceEmailPreview" &&
        message.requestId === requestId
      ) {
        const next = {
          html: message.html,
          text: message.text,
          versionId: message.versionId,
        };
        setState({
          client,
          key: nextKey,
          preview: next,
          loading: false,
          error: null,
        });
      }
      if (message.type === "error" && message.requestId === requestId) {
        setState({
          client,
          key: nextKey,
          preview: null,
          loading: false,
          error: message.message,
        });
      }
    });
    client.send({
      type: "renderWorkspaceEmail",
      workspaceId,
      fileId: file.id,
      requestId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, file, status, workspaceId]);

  return active;
}

const preferencesCache = new Map<string, AgentPreference[]>();

export function useAgentPreferences(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [preferences, setPreferences] = useState<AgentPreference[]>(() =>
    workspaceId ? (preferencesCache.get(workspaceId) ?? []) : [],
  );
  const [loading, setLoading] = useState(
    () => !(workspaceId && preferencesCache.has(workspaceId)),
  );
  const preferencesWorkspaceRef = useRef<string | null>(workspaceId);
  const pendingSavesRef = useRef(new Set<string>());
  const [saveState, setSaveState] = useState<{
    saving: boolean;
    error: string | null;
  }>({ saving: false, error: null });

  useEffect(() => {
    if (preferencesWorkspaceRef.current !== workspaceId) {
      preferencesWorkspaceRef.current = workspaceId;
      pendingSavesRef.current.clear();
      setSaveState({ saving: false, error: null });
      const cached = workspaceId
        ? preferencesCache.get(workspaceId)
        : undefined;
      setPreferences(cached ?? []);
      setLoading(!cached);
    }
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "agentPreferences" &&
        message.workspaceId === workspaceId
      ) {
        if (
          message.requestId &&
          pendingSavesRef.current.delete(message.requestId)
        ) {
          setSaveState((current) => ({
            saving: pendingSavesRef.current.size > 0,
            error: current.error,
          }));
        }
        preferencesCache.set(workspaceId, message.preferences);
        setPreferences(message.preferences);
        setLoading(false);
      }
      if (
        message.type === "error" &&
        message.requestId &&
        pendingSavesRef.current.delete(message.requestId)
      ) {
        setSaveState({
          saving: pendingSavesRef.current.size > 0,
          error: message.message,
        });
        client.send({
          type: "listAgentPreferences",
          workspaceId,
          executorCapability: capability,
        });
      }
    });
    client.send({
      type: "listAgentPreferences",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  const save = (preference: AgentPreference) => {
    if (!workspaceId || workspaceId !== cloudOrganizationId || !capability) {
      return;
    }
    setPreferences((current) => {
      const next = [
        preference,
        ...current.filter((item) => item.agentId !== preference.agentId),
      ];
      preferencesCache.set(workspaceId, next);
      return next;
    });
    const requestId = crypto.randomUUID();
    pendingSavesRef.current.add(requestId);
    setSaveState({ saving: true, error: null });
    client.send({
      type: "saveAgentPreference",
      requestId,
      workspaceId,
      preference,
      executorCapability: capability,
    });
  };

  return { preferences, loading, save, ...saveState };
}
