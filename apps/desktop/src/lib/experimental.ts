import { useSyncExternalStore } from "react";

const machinesKey = "chief:experimental:machines";
const changeEvent = "chief:experimental-change";

function readMachines(): boolean {
  try {
    return window.localStorage.getItem(machinesKey) === "true";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Machines are an unfinished, opt-in experiment, hidden unless enabled. */
export function useMachinesEnabled(): boolean {
  return useSyncExternalStore(subscribe, readMachines, () => false);
}

export function setMachinesEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(machinesKey, String(enabled));
  } catch {
    // Without storage the experiment simply stays off.
  }
  window.dispatchEvent(new Event(changeEvent));
}
