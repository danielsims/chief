import { useEffect, useRef, useState } from "react";

import type {
  AgentPreference,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

const workspaceFilesCache = new Map<string, WorkspaceFileRecord[]>();
const workspaceFileCache = new Map<string, WorkspaceFileSnapshot>();

function workspaceFileCacheKey(workspaceId: string, fileId: string) {
  return `${workspaceId}\0${fileId}`;
}

export function useWorkspaceFiles(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [state, setState] = useState<{
    workspaceId: string | null;
    files: WorkspaceFileRecord[];
    loaded: boolean;
  }>(() => {
    const cached = workspaceId
      ? workspaceFilesCache.get(workspaceId)
      : undefined;
    return {
      workspaceId,
      files: cached ?? [],
      loaded: Boolean(cached),
    };
  });
  const cached = workspaceId ? workspaceFilesCache.get(workspaceId) : undefined;
  const active =
    state.workspaceId === workspaceId
      ? state
      : {
          workspaceId,
          files: cached ?? [],
          loaded: Boolean(cached),
        };

  useEffect(() => {
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
        message.type === "workspaceFiles" &&
        message.workspaceId === workspaceId
      ) {
        workspaceFilesCache.set(workspaceId, message.files);
        setState({ workspaceId, files: message.files, loaded: true });
      }
    });
    client.send({
      type: "listWorkspaceFiles",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  return {
    files: active.files,
    loading: Boolean(workspaceId && !active.loaded),
  };
}

export function useWorkspaceFile(
  workspaceId: string | null,
  fileId: string | null,
) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const key =
    workspaceId && fileId ? workspaceFileCacheKey(workspaceId, fileId) : null;
  interface WorkspaceFileState {
    key: string | null;
    file: WorkspaceFileSnapshot | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
  }
  const [state, setState] = useState<WorkspaceFileState>(() => {
    const cached = key ? workspaceFileCache.get(key) : undefined;
    return {
      key,
      file: cached ?? null,
      loading: Boolean(key && !cached),
      saving: false,
      error: null,
    };
  });
  const cached = key ? workspaceFileCache.get(key) : undefined;
  const active: WorkspaceFileState =
    state.key === key
      ? state
      : {
          key,
          file: cached ?? null,
          loading: Boolean(key && !cached),
          saving: false,
          error: null,
        };
  const pendingRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !workspaceId ||
      !fileId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    pendingRequestRef.current = requestId;
    const unsubscribe = client.subscribe((message) => {
      if (
        (message.type === "workspaceFile" ||
          message.type === "workspaceFileSaved") &&
        message.workspaceId === workspaceId &&
        message.file.id === fileId
      ) {
        const cacheKey = workspaceFileCacheKey(workspaceId, fileId);
        workspaceFileCache.set(cacheKey, message.file);
        setState({
          key: cacheKey,
          file: message.file,
          loading: false,
          saving: false,
          error: null,
        });
      }
      if (
        message.type === "error" &&
        message.requestId &&
        message.requestId === pendingRequestRef.current
      ) {
        const latestCached = key ? workspaceFileCache.get(key) : undefined;
        setState((current) => ({
          ...(current.key === key
            ? current
            : {
                key,
                file: latestCached ?? null,
                loading: false,
                saving: false,
                error: null,
              }),
          key,
          saving: false,
          loading: false,
          error:
            message.message === "FILE_VERSION_CONFLICT"
              ? "This file changed since you opened it. Reload before saving your edits."
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
      !capability
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    pendingRequestRef.current = requestId;
    setState({ ...active, key, saving: true, error: null });
    const requestedName = name?.trim();
    const nextName =
      requestedName && requestedName.length > 0
        ? requestedName
        : active.file.name;
    client.send({
      type: "saveWorkspaceFile",
      workspaceId,
      requestId,
      file: {
        id: active.file.id,
        name: nextName,
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

const emailPreviewCache = new Map<string, EmailPreview>();

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
    key: string | null;
    preview: EmailPreview | null;
    loading: boolean;
    error: string | null;
  }
  const [state, setState] = useState<EmailPreviewState>(() => {
    const cached = cacheKey ? emailPreviewCache.get(cacheKey) : undefined;
    return {
      key: cacheKey,
      preview: cached ?? null,
      loading: Boolean(cacheKey && !cached),
      error: null,
    };
  });
  const cached = cacheKey ? emailPreviewCache.get(cacheKey) : undefined;
  const active: EmailPreviewState =
    state.key === cacheKey
      ? state
      : {
          key: cacheKey,
          preview: cached ?? null,
          loading: Boolean(cacheKey && !cached),
          error: null,
        };

  useEffect(() => {
    const nextKey =
      workspaceId && file
        ? `${workspaceId}\0${file.id}\0${file.currentVersionId}`
        : null;
    const previewCached = nextKey ? emailPreviewCache.get(nextKey) : undefined;
    if (
      !nextKey ||
      !workspaceId ||
      file?.kind !== "email" ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected" ||
      previewCached
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
        emailPreviewCache.set(nextKey, next);
        setState({
          key: nextKey,
          preview: next,
          loading: false,
          error: null,
        });
      }
      if (message.type === "error" && message.requestId === requestId) {
        setState({
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

  useEffect(() => {
    if (preferencesWorkspaceRef.current !== workspaceId) {
      preferencesWorkspaceRef.current = workspaceId;
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
        preferencesCache.set(workspaceId, message.preferences);
        setPreferences(message.preferences);
        setLoading(false);
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
    client.send({
      type: "saveAgentPreference",
      workspaceId,
      preference,
      executorCapability: capability,
    });
  };

  return { preferences, loading, save };
}
