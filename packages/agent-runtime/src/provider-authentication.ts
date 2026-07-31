import type { ActiveIntegrationSetup } from "./integration-setup-state.js";
import type { ExecutorCapability, IntegrationSetupProgress } from "./types.js";
import { browserCredentialSetupRecipe } from "./integration-setup-recipes.js";

interface BrowserSession {
  getUrl(): Promise<string>;
}

interface PendingAuthentication {
  attemptId: string;
  capability: ExecutorCapability;
  domain: string;
  opening: boolean;
  resuming: boolean;
  recipeId: string;
  sessionId: string;
  targetUrl: string;
  workspaceId: string;
}

interface ProviderAuthenticationOptions {
  browserKey(workspaceId: string, sessionId: string): string;
  continueSession(
    workspaceId: string,
    sessionId: string,
    message: string,
    capability: ExecutorCapability,
  ): Promise<void>;
  openBrowser(
    workspaceId: string,
    sessionId: string,
    url: string,
  ): Promise<BrowserSession>;
  progress(
    workspaceId: string,
    sessionId: string,
    progress: IntegrationSetupProgress,
  ): void;
  pollIntervalMs?: number;
}

function targetMatches(rawUrl: string, targetUrl: string) {
  try {
    const current = new URL(rawUrl);
    const target = new URL(targetUrl);
    return (
      current.protocol === "https:" &&
      current.hostname === target.hostname &&
      current.pathname.replace(/\/$/, "") === target.pathname.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}

export class ProviderAuthentication {
  private readonly pending = new Map<string, PendingAuthentication>();
  private readonly pollTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(private readonly options: ProviderAuthenticationOptions) {}

  clear(workspaceId: string, sessionId: string) {
    const key = this.options.browserKey(workspaceId, sessionId);
    this.pending.delete(key);
    const timer = this.pollTimers.get(key);
    if (timer) clearTimeout(timer);
    this.pollTimers.delete(key);
  }

  async open(input: {
    workspaceId: string;
    sessionId: string;
    attemptId: string;
    rawTargetUrl: string;
    capability: ExecutorCapability;
    setup: ActiveIntegrationSetup;
  }) {
    const { workspaceId, sessionId, setup } = input;
    const target = new URL(input.rawTargetUrl);
    const domain = setup.domain.toLowerCase();
    const recipe = browserCredentialSetupRecipe(domain);
    if (
      target.protocol !== "https:" ||
      (target.hostname !== domain && !target.hostname.endsWith(`.${domain}`))
    ) {
      throw new Error(
        "The provider page does not belong to the active integration.",
      );
    }
    if (recipe && target.toString() !== recipe.providerPage) {
      throw new Error(
        "Open the credential page prepared for this integration.",
      );
    }
    const key = this.options.browserKey(workspaceId, sessionId);
    const pending: PendingAuthentication = {
      attemptId: input.attemptId,
      capability: input.capability,
      domain: setup.domain,
      opening: true,
      resuming: false,
      recipeId: setup.recipeId,
      sessionId,
      targetUrl: target.toString(),
      workspaceId,
    };
    this.pending.set(key, pending);
    this.options.progress(workspaceId, sessionId, {
      recipeId: setup.recipeId,
      phase: "authenticated-session",
      instruction: `Sign in to ${setup.domain}. Chief will continue automatically.`,
      status: "active",
    });
    const browser = await this.options.openBrowser(
      workspaceId,
      sessionId,
      target.toString(),
    );
    pending.opening = false;
    if (targetMatches(await browser.getUrl(), pending.targetUrl)) {
      this.pending.delete(key);
      this.progressCredential(workspaceId, sessionId, setup);
      return { status: "ready" as const };
    }
    this.watch(key, browser);
    return {
      status: "authentication-required" as const,
      instruction:
        "The user only needs to complete provider sign-in. Chief will resume this same agent automatically.",
    };
  }

  async resume(workspaceId: string, sessionId: string, rawUrl: string) {
    const key = this.options.browserKey(workspaceId, sessionId);
    const pending = this.pending.get(key);
    if (
      !pending ||
      pending.opening ||
      pending.resuming ||
      !targetMatches(rawUrl, pending.targetUrl)
    ) {
      return;
    }
    pending.resuming = true;
    const recipe = browserCredentialSetupRecipe(pending.domain);
    this.options.progress(workspaceId, sessionId, {
      recipeId: pending.recipeId,
      phase: "create-credential",
      instruction: `Sign-in is complete. Chief is creating the dedicated ${recipe?.credentialLabel ?? "credential"}…`,
      status: "active",
    });
    try {
      await this.options.continueSession(
        workspaceId,
        sessionId,
        `${pending.domain} authentication finished and browser control is now yours. Continue immediately from the visible provider page. Do not ask the user to tell you they are ready and do not call integration.openProviderPage again. Follow the active integration's browser credential recipe exactly. Operate every post-login provider control yourself and never tell the user to create, configure, copy, or paste a credential. Pause only for password, passkey, MFA, account sign-in, or an explicit provider confirmation that only the human can complete. If a passkey or biometric sheet cannot complete inside the streamed browser, keep the same account and ask the human to choose the provider's password or other sign-in method; never launch an external browser. When the newly generated credential is visible, call integration.captureGeneratedCredential with only the current session and attempt IDs.`,
        pending.capability,
      );
      this.pending.delete(key);
      const timer = this.pollTimers.get(key);
      if (timer) clearTimeout(timer);
      this.pollTimers.delete(key);
    } catch (error) {
      pending.resuming = false;
      throw error;
    }
  }

  private watch(key: string, browser: BrowserSession) {
    if (this.pollTimers.has(key) || !this.pending.has(key)) return;
    const timer = setTimeout(() => {
      this.pollTimers.delete(key);
      const pending = this.pending.get(key);
      if (!pending) return;
      void browser
        .getUrl()
        .then((url) => this.resume(pending.workspaceId, pending.sessionId, url))
        .catch(() => undefined)
        .finally(() => {
          if (this.pending.has(key)) this.watch(key, browser);
        });
    }, this.options.pollIntervalMs ?? 1_000);
    timer.unref();
    this.pollTimers.set(key, timer);
  }

  private progressCredential(
    workspaceId: string,
    sessionId: string,
    setup: ActiveIntegrationSetup,
  ) {
    const recipe = browserCredentialSetupRecipe(setup.domain);
    this.options.progress(workspaceId, sessionId, {
      recipeId: setup.recipeId,
      phase: "create-credential",
      instruction: `Chief is creating the dedicated ${recipe?.credentialLabel ?? "credential"}…`,
      status: "active",
    });
  }
}
