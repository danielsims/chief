import type { BrowserBoundaryValue } from "@chief/browser/node";

export interface GeneratedCredentialBrowser {
  evaluate(expression: string): Promise<BrowserBoundaryValue>;
  getUrl(): Promise<string>;
  waitForFunction(expression: string, timeout?: number): Promise<void>;
}

interface GeneratedCredentialStoreResult {
  connectionName: string;
  integrationSlug: string;
}

function parseCredentialText(value: BrowserBoundaryValue): string | undefined {
  if (value instanceof Object) return undefined;
  const text = String(value);
  return text === value ? text : undefined;
}

interface GeneratedCredentialProvider {
  hosts: readonly string[];
  patterns: readonly string[];
}

const GENERATED_CREDENTIAL_PROVIDERS: Record<
  string,
  GeneratedCredentialProvider
> = {
  "github.com": {
    hosts: ["github.com"],
    patterns: ["github_pat_[A-Za-z0-9_]{20,}", "ghp_[A-Za-z0-9]{20,}"],
  },
  "vercel.com": {
    hosts: ["vercel.com"],
    patterns: ["vcp_[A-Za-z0-9_-]{20,}"],
  },
};

function providerFor(domain: string) {
  const provider = GENERATED_CREDENTIAL_PROVIDERS[domain.toLowerCase()];
  if (!provider) {
    throw new Error(
      `Secure generated-credential capture is not configured for ${domain}.`,
    );
  }
  return provider;
}

function captureExpression(patterns: readonly string[]) {
  return `(() => {
    const patterns = ${JSON.stringify(patterns)}.map((source) => new RegExp(source));
    const nodes = Array.from(document.querySelectorAll(
      'input:not([type="password"]), textarea, code, pre, [data-clipboard-text], [aria-label], [title]'
    ));
    for (const node of nodes) {
      const values = [
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : "",
        node.getAttribute("data-clipboard-text") || "",
        node.getAttribute("aria-label") || "",
        node.getAttribute("title") || "",
        node.textContent || "",
      ];
      for (const value of values) {
        for (const pattern of patterns) {
          const match = value.match(pattern);
          if (match?.[0]) return match[0];
        }
      }
    }
    return null;
  })()`;
}

/**
 * Reads a newly generated provider token inside Chief's trusted host boundary.
 * The value is returned only to the host caller and never to the browser agent.
 */
export async function captureGeneratedCredential(
  browser: GeneratedCredentialBrowser,
  domain: string,
) {
  const provider = providerFor(domain);
  const currentUrl = new URL(await browser.getUrl());
  if (
    currentUrl.protocol !== "https:" ||
    !provider.hosts.some(
      (host) =>
        currentUrl.hostname === host ||
        currentUrl.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new Error(
      `Open ${domain}'s newly generated credential before capturing it.`,
    );
  }

  const expression = captureExpression(provider.patterns);
  await browser.waitForFunction(expression, 15_000);
  const credential = parseCredentialText(await browser.evaluate(expression));
  if (!credential) {
    throw new Error(
      `${domain} is not displaying a newly generated credential to capture.`,
    );
  }
  return credential;
}

export async function captureAndStoreGeneratedCredential(input: {
  browser: GeneratedCredentialBrowser;
  domain: string;
  integrationSlug?: string;
  progress(phase: "save-client" | "verify", instruction: string): void;
  store(
    credential: string,
    integrationSlug: string,
  ): Promise<GeneratedCredentialStoreResult>;
}) {
  if (!input.integrationSlug) {
    throw new Error(
      "This setup attempt has no prepared credential connection.",
    );
  }
  input.progress(
    "save-client",
    `Saving the ${input.domain} credential securely…`,
  );
  const credential = await captureGeneratedCredential(
    input.browser,
    input.domain,
  );
  const stored = await input.store(credential, input.integrationSlug);
  input.progress(
    "verify",
    "The credential is stored. Verifying the connection…",
  );
  return { ...stored, status: "configured" as const };
}

export function supportsGeneratedCredentialCapture(domain: string) {
  return domain.toLowerCase() in GENERATED_CREDENTIAL_PROVIDERS;
}
