import { AuthenticationError } from "../auth";

export async function verifyRelayAccountCredential(env: Env, token: string) {
  const [{ verifyChiefAccountCredential }, { createRelayAuth }] =
    await Promise.all([import("@chief/auth/credential"), import("./server")]);
  const auth = await createRelayAuth(env);
  const subject = await verifyChiefAccountCredential(
    auth,
    token,
    env.AUTH_BASE_URL,
  );
  if (subject) return accountIdentity(env, subject);

  throw new AuthenticationError(
    "The account credential is invalid or expired.",
  );
}

function accountIdentity(env: Env, subject: string) {
  return {
    accountSubject: `${env.AUTH_BASE_URL}/api/auth#${subject}`,
    relayAuthUserId: subject,
  };
}
