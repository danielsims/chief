import type { BrowserWorker } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import { z } from "zod";

import type { AgentBrowser, AgentBrowserTarget } from "@chief/agent-computer";

export class CloudflareAgentBrowser implements AgentBrowser {
  private browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  private page:
    | Awaited<
        ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
      >
    | undefined;

  constructor(private readonly binding: BrowserWorker) {}

  async open(value: string, options?: { fresh?: boolean }) {
    if (options?.fresh) await this.close();
    const url = safeBrowserUrl(value);
    const page = await this.currentPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    return await browserSnapshot(page);
  }

  async snapshot() {
    return await browserSnapshot(await this.currentPage());
  }

  async click(target: AgentBrowserTarget) {
    const page = await this.currentPage();
    const selector = await this.selector(target);
    await page.waitForSelector(selector, { timeout: 15_000 });
    await page.click(selector);
    return await browserSnapshot(page);
  }

  async type(target: AgentBrowserTarget, text: string) {
    const page = await this.currentPage();
    const selector = await this.selector(target);
    await page.waitForSelector(selector, { timeout: 15_000 });
    await page.focus(selector);
    await page.keyboard.type(text);
    return await browserSnapshot(page);
  }

  async select(target: AgentBrowserTarget, values: readonly string[]) {
    const page = await this.currentPage();
    const selector = await this.selector(target);
    await page.waitForSelector(selector, { timeout: 15_000 });
    await page.select(selector, ...values);
    return await browserSnapshot(page);
  }

  async screenshot() {
    return await (await this.currentPage()).screenshot({ type: "png" });
  }

  async close() {
    try {
      await this.browser?.close();
    } finally {
      this.browser = undefined;
      this.page = undefined;
    }
  }

  private async currentPage() {
    if (!this.browser?.isConnected()) {
      this.browser = await launchBrowser(this.binding);
      this.page = undefined;
    }
    this.page ??= await this.browser.newPage();
    await this.page.setViewport({ width: 1_280, height: 900 });
    return this.page;
  }

  private async selector(target: AgentBrowserTarget) {
    const directRef = normalizeRef(target.ref);
    if (directRef) return `[data-chief-agent-ref="${directRef}"]`;
    const labels = target.labels?.map((label) => label.trim()).filter(Boolean);
    if (!labels?.length) throw new Error("A browser ref or label is required.");
    const snapshot = await this.snapshot();
    for (const label of labels) {
      const normalized = label.toLowerCase();
      const control = snapshot.controls.find((candidate) =>
        candidate.toLowerCase().includes(normalized),
      );
      const ref = normalizeRef(/^@([^\s]+)/u.exec(control ?? "")?.[1]);
      if (ref) return `[data-chief-agent-ref="${ref}"]`;
    }
    throw new Error("No visible browser control matched the supplied labels.");
  }
}

async function browserSnapshot(
  page: Awaited<
    ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
  >,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readBrowserSnapshot(page);
    } catch (error) {
      if (attempt >= 2 || !isTransientBrowserNavigationError(error)) {
        throw error;
      }
      await page
        .waitForSelector("body", { timeout: 10_000 })
        .catch(() => undefined);
    }
  }
}

async function readBrowserSnapshot(
  page: Awaited<
    ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
  >,
) {
  const result = z
    .object({ text: z.string(), controls: z.array(z.string()) })
    .parse(
      await page.evaluate(`(() => {
        const elements = [...document.querySelectorAll(
          'a,button,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"]'
        )].filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        }).slice(0, 300);
        const controls = elements.map((element, index) => {
          const ref = 'e' + String(index + 1);
          element.setAttribute('data-chief-agent-ref', ref);
          const label = (
            element.getAttribute('aria-label') ||
            element.getAttribute('placeholder') ||
            element.getAttribute('name') ||
            element.textContent ||
            element.getAttribute('value') ||
            ''
          ).replace(/\\s+/g, ' ').trim().slice(0, 180);
          const role = element.getAttribute('role') || element.tagName.toLowerCase();
          return '@' + ref + ' ' + role + (label ? ' "' + label + '"' : '');
        });
        return { text: document.body?.innerText ?? '', controls };
      })()`),
    );
  return {
    url: page.url(),
    title: await page.title(),
    text: result.text.slice(0, 40_000),
    controls: result.controls,
  };
}

async function launchBrowser(binding: BrowserWorker) {
  let rateLimit: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const limits = await puppeteer.limits(binding).catch(() => undefined);
    const waitMs = browserAcquisitionWait(limits);
    if (waitMs > 0) await wait(waitMs);
    try {
      return await puppeteer.launch(binding);
    } catch (error) {
      if (!isBrowserAcquisitionRateLimit(error)) throw error;
      rateLimit = error;
      if (attempt < 3) {
        await wait(
          Math.max(limits?.timeUntilNextAllowedBrowserAcquisition ?? 0, 1_000),
        );
      }
    }
  }
  throw rateLimit;
}

function browserAcquisitionWait(
  limits: Awaited<ReturnType<typeof puppeteer.limits>> | undefined,
) {
  if (!limits) return 0;
  if (limits.activeSessions.length >= limits.maxConcurrentSessions)
    return 5_000;
  if (limits.allowedBrowserAcquisitions > 0) return 0;
  return Math.max(limits.timeUntilNextAllowedBrowserAcquisition, 1_000);
}

function isBrowserAcquisitionRateLimit(error: unknown) {
  return (
    error instanceof Error && /(?:code:\s*429|rate limit)/iu.test(error.message)
  );
}

export function isTransientBrowserNavigationError(error: unknown) {
  return (
    error instanceof Error &&
    /(?:execution context was destroyed|cannot find context with specified id)/iu.test(
      error.message,
    )
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeRef(value: string | undefined) {
  const ref = value?.replace(/^@/u, "");
  return ref && /^e\d+$/u.test(ref) ? ref : undefined;
}

function safeBrowserUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Browser URLs must use HTTP or HTTPS.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Browser URLs must be public.");
  }
  return url.toString();
}
