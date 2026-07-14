import { PREVIEW_EMAIL_LOGO_URL } from "../src/branding";
import { FounderWelcomeEmail } from "../src/templates/nurture/founder-welcome-email";

export function FounderWelcomePreview() {
  return (
    <FounderWelcomeEmail firstName="Alex" logoUrl={PREVIEW_EMAIL_LOGO_URL} />
  );
}

export default FounderWelcomePreview;
