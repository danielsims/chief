import { useEffect } from "react";
import { useSearchParams } from "react-router";

import { useExitWorkspaceSetup } from "../components/workspace-setup-chrome";
import { useAuth } from "../lib/auth/auth-context";
import { RELAY_URL } from "../lib/config";
import {
  clearWorkspaceEntrySession,
  resumeWorkspaceSetup,
  workspaceEntryIntent,
} from "../lib/workspace-entry";
import { WorkspaceSetupWizard } from "./onboarding/wizard";
import { WorkspaceNewView } from "./workspace-new-chrome";
import { useWorkspaceNewPage } from "./workspace-new-state";

export function CreateWorkspacePage() {
  const [search] = useSearchParams();
  const { user } = useAuth();
  const exit = useExitWorkspaceSetup();
  const joining = workspaceEntryIntent(search.toString()) === "join";
  useEffect(() => {
    clearWorkspaceEntrySession(sessionStorage);
    if (user?.id) resumeWorkspaceSetup(sessionStorage, RELAY_URL, user.id);
  }, [search, user?.id]);
  return joining ? (
    <JoinWorkspacePage />
  ) : (
    <WorkspaceSetupWizard onCancel={exit} />
  );
}

function JoinWorkspacePage() {
  const page = useWorkspaceNewPage();
  return <WorkspaceNewView page={page} />;
}
