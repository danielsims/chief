import type { Metadata } from "next";
import {
  ContentRail,
  MarketingFooter,
  MarketingHeader,
} from "../marketing-chrome";
import { RailsLayout } from "../rails-layout";

export const metadata: Metadata = {
  title: "Privacy | Marketer",
  description: "Privacy Policy for Marketer by Latent Supply Pty Ltd.",
};

export default function PrivacyPage() {
  return (
    <main className="landing">
      <RailsLayout>
        <MarketingHeader />
        <ContentRail
          title="Privacy Policy"
          description="Last updated: 12 July 2026"
        >
          <h2>1. Who we are</h2>
          <p>
            Marketer is developed and operated by Latent Supply Pty Ltd (ABN 38
            694 551 490), Australia.
          </p>
          <h2>2. Information we collect</h2>
          <p>
            We collect the information needed to provide the service, including
            account details, workspace and company information, billing status,
            support correspondence, and technical information required to
            operate and secure Marketer.
          </p>
          <h2>3. Connected services</h2>
          <p>
            When you connect a service such as an analytics, advertising,
            social, communication, or storage provider, Marketer accesses the
            information you authorise for the work you request. The available
            data and permissions depend on that provider and your selected
            approval settings.
          </p>
          <h2>4. How we use information</h2>
          <ul>
            <li>
              Provide agent workspaces, schedules, reports, and integrations
            </li>
            <li>Authenticate accounts and process subscriptions</li>
            <li>Maintain security, reliability, and customer support</li>
            <li>Comply with legal obligations</li>
          </ul>
          <h2>5. Local and cloud processing</h2>
          <p>
            Marketer can run work locally on your device and, when enabled,
            through hosted infrastructure. Local credentials are stored using
            operating-system security facilities where supported. Information
            sent to a connected AI or third-party service is also governed by
            that provider&apos;s terms and privacy policy.
          </p>
          <h2>6. Service providers</h2>
          <p>
            We use service providers for hosting, authentication, payments,
            model access, error handling, and connected integrations. They
            receive only the information needed to perform their services.
          </p>
          <h2>7. Retention and security</h2>
          <p>
            We retain information for as long as needed to provide Marketer,
            meet legal obligations, resolve disputes, and protect the service.
            We use reasonable technical and organisational safeguards, but no
            system is completely secure.
          </p>
          <h2>8. Your choices and rights</h2>
          <p>
            You may disconnect integrations, change agent permissions, and
            request access, correction, or deletion of personal information.
            Australian Privacy Principles and other applicable laws may provide
            additional rights.
          </p>
          <h2>9. Changes</h2>
          <p>
            We may update this policy as Marketer changes. The current version
            and effective date will remain available on this page.
          </p>
          <h2>10. Contact</h2>
          <p>
            Questions or privacy requests can be sent to{" "}
            <a href="mailto:admin@latentsupply.com">admin@latentsupply.com</a>.
          </p>
        </ContentRail>
        <MarketingFooter />
      </RailsLayout>
    </main>
  );
}
