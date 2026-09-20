import type { Metadata } from "next";

import { LegalPage } from "../marketing-page";

export const metadata: Metadata = {
  title: "Terms | Chief",
  description: "Terms of Service for Chief by Latent Supply Pty Ltd.",
};

export default function TermsPage() {
  return (
    <LegalPage
      description="Last updated: 12 July 2026"
      title="Terms of Service"
    >
      <h2>1. Agreement</h2>
      <p>
        By downloading, accessing, or using Chief, you agree to these terms.
        Chief is operated by Latent Supply Pty Ltd (ABN 38 694 551 490).
      </p>
      <h2>2. The service</h2>
      <p>
        Chief provides AI-assisted marketing agents, integrations, schedules,
        reports, content drafts, and related workspace tools. Features may run
        locally or through hosted services depending on your configuration.
      </p>
      <h2>3. Your account and integrations</h2>
      <p>
        You are responsible for your account, connected services, instructions,
        approval settings, and the legality of the data and access you provide.
        You must review agent output before relying on it where errors could
        cause harm.
      </p>
      <h2>4. Billing</h2>
      <p>
        Paid plans renew automatically for the selected billing period until
        cancelled. Prices, trial terms, taxes, and renewal details are shown at
        checkout. Except where required by law, charges already paid are
        non-refundable.
      </p>
      <h2>5. Acceptable use</h2>
      <p>
        You must not use Chief to break the law, violate third-party rights or
        platform rules, send unlawful or deceptive communications, gain
        unauthorised access, or interfere with the service.
      </p>
      <h2>6. Your content</h2>
      <p>
        You retain ownership of content and data you provide. You grant us the
        limited rights necessary to process that material and operate Chief. You
        are responsible for reviewing and approving anything published or sent
        through your connected services.
      </p>
      <h2>7. Intellectual property</h2>
      <p>
        Chief, its software, design, and branding are owned by Latent Supply Pty
        Ltd and its licensors. These terms grant a limited, non-exclusive,
        non-transferable right to use the service.
      </p>
      <h2>8. Third-party services</h2>
      <p>
        Models, integrations, hosting providers, and other third-party services
        have their own terms. We are not responsible for changes, outages, or
        decisions made by those providers.
      </p>
      <h2>9. Disclaimers and liability</h2>
      <p>
        Chief is provided on an &quot;as is&quot; and &quot;as available&quot;
        basis. To the maximum extent permitted by law, Latent Supply Pty Ltd
        excludes implied warranties and is not liable for indirect, incidental,
        special, consequential, or lost-profit damages.
      </p>
      <h2>10. Termination</h2>
      <p>
        You may stop using Chief at any time. We may suspend or terminate access
        when necessary to protect the service, comply with law, or address a
        material breach of these terms.
      </p>
      <h2>11. Governing law</h2>
      <p>
        These terms are governed by the laws of Australia. Mandatory consumer
        rights that cannot legally be excluded continue to apply.
      </p>
      <h2>12. Contact</h2>
      <p>
        Questions about these terms can be sent to{" "}
        <a href="mailto:admin@latentsupply.com">admin@latentsupply.com</a>.
      </p>
    </LegalPage>
  );
}
