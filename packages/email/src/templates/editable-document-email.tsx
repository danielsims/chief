import { Heading, Markdown } from "@react-email/components";

import { EmailShell } from "../components/email-shell";
import { emailStyles } from "../components/email-styles";

export interface EditableDocumentEmailProps {
  title: string;
  markdown: string;
  preview?: string;
}

export function EditableDocumentEmail({
  title,
  markdown,
  preview,
}: EditableDocumentEmailProps) {
  return (
    <EmailShell preview={preview ?? title}>
      <Heading style={emailStyles.heading}>{title}</Heading>
      <Markdown
        markdownCustomStyles={{
          p: emailStyles.copy,
          h1: emailStyles.sectionHeading,
          h2: emailStyles.sectionHeading,
          h3: emailStyles.sectionHeading,
          link: { color: "#ededeb", textDecoration: "underline" },
        }}
      >
        {markdown}
      </Markdown>
    </EmailShell>
  );
}
