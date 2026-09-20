"use client";

import { useSyncExternalStore } from "react";

export type PlatformOs = "macos" | "windows" | "ios" | "other";

export interface DevicePlatform {
  desktopHref: string;
  desktopHint: string;
  iosHint: string | null;
  os: PlatformOs;
  preferred: "desktop" | "ios" | null;
}

const MACOS_HREF = "/api/download/macos";
const WINDOWS_HREF = "/api/download/windows";

const serverPlatform: DevicePlatform = {
  desktopHref: "/download",
  desktopHint: "macOS & Windows",
  iosHint: null,
  os: "other",
  preferred: null,
};

let clientPlatform: DevicePlatform | null = null;

function detectPlatform(): DevicePlatform {
  const ua = window.navigator.userAgent;
  const isIos =
    ua.includes("iPad") ||
    ua.includes("iPhone") ||
    ua.includes("iPod") ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMac = (navigator.platform + ua).includes("Mac") && !isIos;
  const isWindows = (navigator.platform + ua).includes("Win");

  if (isMac || isWindows) {
    return {
      desktopHref: isWindows ? WINDOWS_HREF : MACOS_HREF,
      desktopHint: "For your device",
      iosHint: null,
      os: isWindows ? "windows" : "macos",
      preferred: "desktop",
    };
  }

  if (isIos) {
    return {
      desktopHref: "/download",
      desktopHint: "macOS & Windows",
      iosHint: "For your device",
      os: "ios",
      preferred: "ios",
    };
  }

  return serverPlatform;
}

function readPlatform(): DevicePlatform {
  clientPlatform ??= detectPlatform();
  return clientPlatform;
}

export function usePlatform(): DevicePlatform {
  return useSyncExternalStore(
    () => () => undefined,
    readPlatform,
    () => serverPlatform,
  );
}
