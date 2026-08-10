import type { ReactElement } from "react";
import { createElement } from "react";
import { render } from "@react-email/render";

import { EditableDocumentEmail } from "./templates/editable-document-email";

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
