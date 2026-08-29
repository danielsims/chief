import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

interface BrowserHistoryState {
  idx?: number;
  key?: string;
}

function historyState(): BrowserHistoryState {
  const state: unknown = window.history.state;
  if (!isJsonObject(state)) return {};
  const idx = state.idx;
  const key = state.key;
  if (isJsonNumber(idx) && isJsonString(key)) return { idx, key };
  if (isJsonNumber(idx)) return { idx };
  return isJsonString(key) ? { key } : {};
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

export function useNavigationHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const keysByIndex = useRef(new Map<number, string>());
  const currentIndex = historyState().idx ?? 0;
  const currentKey = historyState().key ?? location.key;
  const [maxIndex, setMaxIndex] = useState(currentIndex);

  useEffect(() => {
    const previousKey = keysByIndex.current.get(currentIndex);
    if (previousKey && previousKey !== currentKey) {
      for (const index of keysByIndex.current.keys()) {
        if (index >= currentIndex) keysByIndex.current.delete(index);
      }
    }
    keysByIndex.current.set(currentIndex, currentKey);
    setMaxIndex((value) =>
      previousKey && previousKey !== currentKey
        ? currentIndex
        : Math.max(value, currentIndex),
    );
  }, [currentIndex, currentKey]);

  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < maxIndex;
  const goBack = useCallback(() => {
    if (canGoBack) void navigate(-1);
  }, [canGoBack, navigate]);
  const goForward = useCallback(() => {
    if (canGoForward) void navigate(1);
  }, [canGoForward, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const back =
        (event.metaKey && event.key === "[") ||
        (event.altKey && event.key === "ArrowLeft");
      const forward =
        (event.metaKey && event.key === "]") ||
        (event.altKey && event.key === "ArrowRight");
      if (back) {
        event.preventDefault();
        goBack();
      } else if (forward) {
        event.preventDefault();
        goForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goBack, goForward]);

  return { canGoBack, canGoForward, goBack, goForward };
}
