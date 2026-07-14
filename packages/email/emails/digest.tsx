import {
  ChiefDigestEmail,
  digestPreviewProps,
} from "../src/templates/digest/chief-digest-email";

export function DigestPreview() {
  return (
    <ChiefDigestEmail
      {...digestPreviewProps}
      logoUrl="http://localhost:3001/static/chief-mark-white.png"
    />
  );
}

export default DigestPreview;
