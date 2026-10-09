import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage } from "../marketing-page";

export const metadata: Metadata = {
  title: "Support | Chief",
  description: "Get help with Chief on iPhone, Mac and the web.",
};

export default function SupportPage() {
  return (
    <LegalPage
      description="Help with Chief on iPhone, Mac and the web."
      title="Support"
    >
      <h2>Contact us</h2>
      <p>
        Email <a href="mailto:admin@latentsupply.com">admin@latentsupply.com</a>{" "}
        with what you were doing, what you expected, and any screenshots.
        Include the device and Chief version you’re using.
      </p>
      <h2>Your account</h2>
      <p>
        You can delete your account at any time in the iPhone app from Settings
        → Profile → Delete account, or by emailing us from the address you
        signed up with.
      </p>
      <h2>Joining a workspace</h2>
      <p>
        Open the invitation email on your iPhone or Mac and sign in with the
        address the invitation was sent to.
      </p>
      <h2>Privacy and terms</h2>
      <p>
        Read how we handle your data in our{" "}
        <Link href="/privacy">Privacy Policy</Link>, and the rules for using
        Chief in our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
