import type { ReactElement } from "react";
import { createElement } from "react";
import { render } from "@react-email/render";

import type { WorkspaceInvitationEmailProps } from "./templates/transactional/workspace-invitation-email";
import { EditableDocumentEmail } from "./templates/editable-document-email";
import { WorkspaceInvitationEmail } from "./templates/transactional/workspace-invitation-email";

export async function renderEmail(template: ReactElement) {
  const [html, text] = await Promise.all([
    render(template),
    render(template, { plainText: true }),
  ]);
  return { html, text };
}

export function renderEmailDocument(input: {
  title: string;
  markdown: string;
  preview?: string;
}) {
  return renderEmail(createElement(EditableDocumentEmail, input));
}

export function renderWorkspaceInvitationEmail(
  input: WorkspaceInvitationEmailProps,
) {
  return renderEmail(createElement(WorkspaceInvitationEmail, input));
}
