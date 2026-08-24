import type { GoogleOAuthClientIdentity } from "./types.js";
import { createGoogleDesktopOAuthIdentity } from "./credentials.js";

type BrowserBoundaryValue =
  | boolean
  | BrowserBoundaryRecord
  | BrowserBoundaryValue[]
  | null
  | number
  | string;

interface BrowserBoundaryRecord {
  readonly [key: string]: BrowserBoundaryValue;
}

export interface GoogleOAuthCaptureBrowser {
  click(labels: string[]): Promise<boolean | void>;
  evaluate(expression: string): Promise<BrowserBoundaryValue>;
  getUrl(): Promise<string>;
  open(url: string): Promise<BrowserOpenResult | void>;
  waitForFunction(expression: string, timeout?: number): Promise<void>;
}

interface BrowserOpenResult {
  connected: boolean;
  enabled: boolean;
  port: number;
  screencasting: boolean;
  url: string;
}

function parseGoogleOAuthText(value: BrowserBoundaryValue): string | undefined {
  if (value instanceof Object) return undefined;
  const text = String(value);
  return text === value ? text : undefined;
}

const CLIENT_ID_EXPRESSION = `(() => {
  const prefix = "Copy to clipboard:";
  return Array.from(document.querySelectorAll("button[aria-label]"))
    .map((button) => button.getAttribute("aria-label") || "")
    .filter((label) => label.startsWith(prefix))
    .map((label) => label.slice(prefix.length).trim())
    .find((value) => value.endsWith(".apps.googleusercontent.com")) || null;
})()`;

const CLIENT_SECRET_EXPRESSION = `(() => {
  const prefix = "Copy to clipboard:";
  return Array.from(document.querySelectorAll("button[aria-label]"))
    .map((button) => button.getAttribute("aria-label") || "")
    .filter((label) => label.startsWith(prefix))
    .map((label) => label.slice(prefix.length).trim())
    .find((value) => value && !value.endsWith(".apps.googleusercontent.com")) || null;
})()`;

const INFORMATION_READY_EXPRESSION =
  `Array.from(document.querySelectorAll("button"))` +
  `.some((button) => (button.getAttribute("aria-label") || ` +
  `button.textContent?.trim() || "") === "Information and summary")`;

const SUMMARY_READY_EXPRESSION =
  `Array.from(document.querySelectorAll("button"))` +
  `.some((button) => ["add client secret", "add secret"].includes((` +
  `button.getAttribute("aria-label") || button.textContent?.trim() || "").toLowerCase()))`;

const CLIENT_SECRET_READY_EXPRESSION =
  `Array.from(document.querySelectorAll("button[aria-label]"))` +
  `.map((button) => button.getAttribute("aria-label") || "")` +
  `.some((label) => label.startsWith("Copy to clipboard:") && ` +
  `!label.endsWith(".apps.googleusercontent.com"))`;

/**
 * Captures a Google Desktop OAuth client inside the trusted host. Google masks
 * existing secrets in the client summary, so the host creates a fresh secret
 * when the original one-time value is no longer present. Credential values are
 * never returned to the browser-driving agent.
 */
export async function captureGoogleDesktopOAuthClient(
  browser: GoogleOAuthCaptureBrowser,
): Promise<GoogleOAuthClientIdentity> {
  const currentUrl = new URL(await browser.getUrl());
  if (currentUrl.hostname !== "console.cloud.google.com") {
    throw new Error(
      "Open the newly created Google OAuth client before capturing it.",
    );
  }
  const modalClientId = parseGoogleOAuthText(
    await browser.evaluate(CLIENT_ID_EXPRESSION),
  );
  const pathValue = /^\/auth\/clients\/([^/]+)\/?$/.exec(
    currentUrl.pathname,
  )?.[1];
  const pathClientId = pathValue?.endsWith(".apps.googleusercontent.com")
    ? pathValue
    : undefined;
  const clientId =
    modalClientId ??
    (pathClientId ? decodeURIComponent(pathClientId) : undefined);
  if (!clientId?.endsWith(".apps.googleusercontent.com")) {
    throw new Error(
      "Leave Google's OAuth client-created dialog open, or open that client's edit page, then capture it again.",
    );
  }
  const projectId = currentUrl.searchParams.get("project") ?? undefined;
  const detailsUrl = new URL(
    `/auth/clients/${encodeURIComponent(clientId)}`,
    "https://console.cloud.google.com",
  );
  if (projectId) detailsUrl.searchParams.set("project", projectId);
  if (!pathClientId) await browser.open(detailsUrl.toString());

  await browser.waitForFunction(INFORMATION_READY_EXPRESSION, 15_000);
  let clientSecret = parseGoogleOAuthText(
    await browser.evaluate(CLIENT_SECRET_EXPRESSION),
  );
  if (!clientSecret) {
    await browser.click(["Information and summary"]);
    await browser.waitForFunction(SUMMARY_READY_EXPRESSION, 15_000);
    clientSecret = parseGoogleOAuthText(
      await browser.evaluate(CLIENT_SECRET_EXPRESSION),
    );
  }
  if (!clientSecret) {
    await browser.click([
      "Add client secret",
      "Add Client secret",
      "Add secret",
    ]);
    await browser.waitForFunction(CLIENT_SECRET_READY_EXPRESSION, 15_000);
    clientSecret = parseGoogleOAuthText(
      await browser.evaluate(CLIENT_SECRET_EXPRESSION),
    );
  }
  return createGoogleDesktopOAuthIdentity({
    clientId,
    clientSecret,
    projectId,
  });
}
