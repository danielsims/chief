import { AccountCreatedEmail } from "../src/templates/transactional/account-created-email";

export function AccountCreatedPreview() {
  return (
    <AccountCreatedEmail
      firstName="Alex"
      logoUrl="http://localhost:3001/static/chief-mark-white.png"
    />
  );
}

export default AccountCreatedPreview;
