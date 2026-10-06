import { WorkspaceInvitationEmail } from "../src/templates/transactional/workspace-invitation-email";

export function WorkspaceInvitationPreview() {
  return (
    <WorkspaceInvitationEmail {...WorkspaceInvitationEmail.PreviewProps} />
  );
}

export default WorkspaceInvitationPreview;
