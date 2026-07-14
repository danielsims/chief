import { FounderWelcomeEmail } from "../src/templates/nurture/founder-welcome-email";

export function FounderWelcomePreview() {
  return (
    <FounderWelcomeEmail
      firstName="Alex"
      logoUrl="http://localhost:3001/static/chief-mark-white.png"
    />
  );
}

export default FounderWelcomePreview;
