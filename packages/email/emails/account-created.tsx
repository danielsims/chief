import { PREVIEW_EMAIL_LOGO_URL } from "../src/branding";
import { AccountCreatedEmail } from "../src/templates/transactional/account-created-email";

export function AccountCreatedPreview() {
  return (
    <AccountCreatedEmail firstName="Alex" logoUrl={PREVIEW_EMAIL_LOGO_URL} />
  );
}

export default AccountCreatedPreview;
