import type { WorkspaceNewPageModel } from "./workspace-new-state";
import { ChiefMark } from "../components/chief-mark";
import { WorkspaceSetupChrome } from "../components/workspace-setup-chrome";
import { Field, SetupHeading } from "./onboarding/elements";

import "./onboarding/onboarding.css";

/**
 * Joining a workspace with an invitation, drawn like the rest of setup: the
 * link first, then the workspace it opens before joining it.
 */
export function JoinWorkspaceScreen({
  page,
  onExit,
}: {
  page: WorkspaceNewPageModel;
  onExit: () => void;
}) {
  const preview = page.invitePreview;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (preview) void page.joinWorkspace();
    else void page.prepareInvite();
  };
  return (
    <div className="ob-shell">
      <div data-tauri-drag-region className="ob-drag" />
      <WorkspaceSetupChrome onExit={onExit} />
      <div className="ob-scroll">
        <form className="ob-screen" onSubmit={submit}>
          <header className="ob-top">
            <ChiefMark className="size-6" />
          </header>
          <div className="ob-body">
            {preview ? (
              <>
                <SetupHeading title={`Join ${preview.workspaceName}`}>
                  {preview.conversationName
                    ? `You’ll start in #${preview.conversationName}, alongside the team and its agents.`
                    : "You’ll work alongside the team and its agents."}
                </SetupHeading>
                <div className="border-border/60 bg-card/30 flex items-center gap-3 rounded-xl border px-4 py-3.5">
                  <div className="bg-foreground text-background flex size-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-semibold">
                    {preview.workspaceName.trim().charAt(0).toUpperCase()}
                  </div>
                  <span className="min-w-0 truncate text-sm font-medium">
                    {preview.workspaceName}
                  </span>
                </div>
              </>
            ) : (
              <>
                <SetupHeading title="Join a workspace">
                  Paste the invitation link someone shared with you.
                </SetupHeading>
                <div className="ob-fields">
                  <Field label="Invitation link">
                    <input
                      className="ob-input"
                      autoFocus
                      value={page.invite}
                      placeholder="https://…/invite/…"
                      disabled={page.isWorking}
                      spellCheck={false}
                      autoCapitalize="none"
                      onChange={(event) => {
                        page.setInvite(event.target.value);
                        page.setInvitePreview(null);
                        page.setForeignRelay(null);
                      }}
                    />
                  </Field>
                </div>
              </>
            )}
            {page.actionError ? (
              <p className="ob-error" role="alert">
                {page.actionError}
              </p>
            ) : null}
            <button
              type="submit"
              className="ob-primary"
              disabled={
                !page.invite.trim() || page.isWorking || !page.connected
              }
            >
              {preview ? "Join workspace" : "Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
