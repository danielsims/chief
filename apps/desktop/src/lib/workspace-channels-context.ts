import type { ReactNode } from "react";
import { createContext, createElement, useContext } from "react";

import { useWorkspaceChannelsState } from "./runtime-channels";

type WorkspaceChannelsValue = ReturnType<typeof useWorkspaceChannelsState>;

const WorkspaceChannelsContext = createContext<WorkspaceChannelsValue | null>(
  null,
);

/** Owns one relay roster subscription for the entire desktop surface. */
export function WorkspaceChannelsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useWorkspaceChannelsState();
  return createElement(WorkspaceChannelsContext.Provider, { value }, children);
}

export function useWorkspaceChannels() {
  const value = useContext(WorkspaceChannelsContext);
  if (!value) {
    throw new Error(
      "useWorkspaceChannels must be used inside WorkspaceChannelsProvider",
    );
  }
  return value;
}
