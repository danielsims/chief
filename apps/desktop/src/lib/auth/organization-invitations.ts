import { authClient } from "./better-auth-client";

export async function inviteAuthOrganizationMember(input: {
  email: string;
  organizationId: string;
}) {
  const result = await authClient.organization.inviteMember({
    email: input.email.trim().toLowerCase(),
    organizationId: input.organizationId,
    resend: true,
    role: "member",
  });
  if (result.error) {
    throw new Error(
      result.error.message ?? "Chief couldn’t send this invitation.",
    );
  }
}
