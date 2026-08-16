import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ProjectCommitDetail,
  ProjectRecord,
  ProjectRepositoryBrowserSnapshot,
  ProjectRepositorySnapshot,
  ServerMessage,
} from "@chief/agent-runtime/types";

import { useRuntime, useWorkspaceCapability } from "./runtime";

const cache = new Map<string, ProjectRepositorySnapshot[]>();
const browserCache = new Map<string, ProjectRepositoryBrowserSnapshot>();
const commitCache = new Map<string, ProjectCommitDetail>();

function browserCacheKey(
  workspaceId: string,
  projectId: string,
  ref: string,
  path: string,
) {
  return `${workspaceId}\0${projectId}\0${ref}\0${path}`;
}

function commitCacheKey(
  workspaceId: string,
  projectId: string,
  ref: string,
  commit: string,
) {
  return `${workspaceId}\0${projectId}\0${ref}\0${commit}`;
}

export function useProjects() {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [received, setReceived] = useState<{
    workspaceId: string;
    projects: ProjectRepositorySnapshot[];
  } | null>(null);
  const projects = cloudOrganizationId
    ? received?.workspaceId === cloudOrganizationId
      ? received.projects
      : (cache.get(cloudOrganizationId) ?? null)
    : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (!cloudOrganizationId) return;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type !== "projects" ||
        message.workspaceId !== cloudOrganizationId
      ) {
        return;
      }
      cache.set(cloudOrganizationId, message.projects);
      setReceived({
        workspaceId: cloudOrganizationId,
        projects: message.projects,
      });
    });
    return () => {
      unsubscribe();
    };
  }, [client, cloudOrganizationId]);

  const refresh = useCallback(() => {
    if (!cloudOrganizationId || !capability) return;
    client.send({
      type: "listProjects",
      workspaceId: cloudOrganizationId,
      executorCapability: capability,
    });
  }, [capability, client, cloudOrganizationId]);

  useEffect(() => {
    if (status === "connected" && capability && !projects) refresh();
  }, [capability, projects, refresh, status]);

  const waitForSave = useCallback(
    (requestId: string) =>
      new Promise<ProjectRecord>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          unsubscribe();
          reject(new Error("Chief did not finish adding the project in time."));
        }, 120_000);
        const unsubscribe = client.subscribe((message: ServerMessage) => {
          if (
            message.type === "projectSaved" &&
            message.requestId === requestId &&
            message.workspaceId === cloudOrganizationId
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            resolve(message.project);
          } else if (
            message.type === "error" &&
            message.requestId === requestId
          ) {
            window.clearTimeout(timer);
            unsubscribe();
            reject(new Error(message.message));
          }
        });
      }),
    [client, cloudOrganizationId],
  );

  const attach = useCallback(
    async (path: string, name?: string) => {
      if (!cloudOrganizationId || !capability) return undefined;
      const requestId = crypto.randomUUID();
      setBusy(true);
      setError(null);
      try {
        const saved = waitForSave(requestId);
        client.send({
          type: "attachProject",
          workspaceId: cloudOrganizationId,
          requestId,
          path,
          ...(name?.trim() ? { name: name.trim() } : {}),
          executorCapability: capability,
        });
        return await saved;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [capability, client, cloudOrganizationId, waitForSave],
  );

  const clone = useCallback(
    async (remoteUrl: string, name?: string) => {
      if (!cloudOrganizationId || !capability) return undefined;
      const requestId = crypto.randomUUID();
      setBusy(true);
      setError(null);
      try {
        const saved = waitForSave(requestId);
        client.send({
          type: "cloneProject",
          workspaceId: cloudOrganizationId,
          requestId,
          remoteUrl,
          ...(name?.trim() ? { name: name.trim() } : {}),
          executorCapability: capability,
        });
        return await saved;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [capability, client, cloudOrganizationId, waitForSave],
  );

  return {
    projects: projects ?? [],
    loading: projects === null,
    busy,
    error,
    clearError,
    refresh,
    attach,
    clone,
  };
}

export function useProjectBrowser(
  projectId: string | undefined,
  ref: string | undefined,
  path: string,
) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const key =
    cloudOrganizationId && projectId && ref
      ? browserCacheKey(cloudOrganizationId, projectId, ref, path)
      : undefined;
  const [received, setReceived] = useState<{
    key: string;
    browser: ProjectRepositoryBrowserSnapshot;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<string | null>(null);
  const cached = key ? browserCache.get(key) : undefined;
  const browser = received && received.key === key ? received.browser : cached;

  useEffect(() => {
    if (!key) return;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "projectBrowser" &&
        message.workspaceId === cloudOrganizationId &&
        message.requestId === activeRequest.current
      ) {
        browserCache.set(key, message.browser);
        setReceived({ key, browser: message.browser });
        setError(null);
      } else if (
        message.type === "error" &&
        message.requestId === activeRequest.current
      ) {
        setError(message.message);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [client, cloudOrganizationId, key]);

  const refresh = useCallback(() => {
    if (!cloudOrganizationId || !capability || !projectId || !ref || !key) {
      return;
    }
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    client.send({
      type: "browseProject",
      workspaceId: cloudOrganizationId,
      requestId,
      projectId,
      ref,
      ...(path ? { path } : {}),
      executorCapability: capability,
    });
  }, [capability, client, cloudOrganizationId, key, path, projectId, ref]);

  useEffect(() => {
    if (status === "connected" && capability && key && !cached) refresh();
  }, [cached, capability, key, refresh, status]);

  return {
    browser,
    loading: Boolean(key && !browser && !error),
    error,
    refresh,
  };
}

export function useProjectCommit(
  projectId: string | undefined,
  ref: string | undefined,
  commit: string | undefined,
) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const key =
    cloudOrganizationId && projectId && ref && commit
      ? commitCacheKey(cloudOrganizationId, projectId, ref, commit)
      : undefined;
  const [received, setReceived] = useState<{
    key: string;
    detail: ProjectCommitDetail;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<string | null>(null);
  const cached = key ? commitCache.get(key) : undefined;
  const detail = received && received.key === key ? received.detail : cached;

  useEffect(() => {
    if (!key) return;
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "projectCommit" &&
        message.workspaceId === cloudOrganizationId &&
        message.requestId === activeRequest.current
      ) {
        commitCache.set(key, message.detail);
        setReceived({ key, detail: message.detail });
        setError(null);
      } else if (
        message.type === "error" &&
        message.requestId === activeRequest.current
      ) {
        setError(message.message);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [client, cloudOrganizationId, key]);

  const refresh = useCallback(() => {
    if (
      !cloudOrganizationId ||
      !capability ||
      !projectId ||
      !ref ||
      !commit ||
      !key
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    client.send({
      type: "inspectProjectCommit",
      workspaceId: cloudOrganizationId,
      requestId,
      projectId,
      ref,
      commit,
      executorCapability: capability,
    });
  }, [capability, client, cloudOrganizationId, commit, key, projectId, ref]);

  useEffect(() => {
    if (status === "connected" && capability && key && !cached) refresh();
  }, [cached, capability, key, refresh, status]);

  return {
    detail,
    loading: Boolean(key && !detail && !error),
    error,
    refresh,
  };
}
