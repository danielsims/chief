import { WorkspaceNewView } from "./workspace-new-chrome";
import { useWorkspaceNewPage } from "./workspace-new-state";

export function CreateWorkspacePage() {
  const page = useWorkspaceNewPage();
  return <WorkspaceNewView page={page} />;
}
