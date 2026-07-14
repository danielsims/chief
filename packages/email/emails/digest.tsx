import { PREVIEW_EMAIL_LOGO_URL } from "../src/branding";
import {
  ChiefDigestEmail,
  digestPreviewProps,
} from "../src/templates/digest/chief-digest-email";

export function DigestPreview() {
  return (
    <ChiefDigestEmail
      {...digestPreviewProps}
      logoUrl={PREVIEW_EMAIL_LOGO_URL}
    />
  );
}

export default DigestPreview;
