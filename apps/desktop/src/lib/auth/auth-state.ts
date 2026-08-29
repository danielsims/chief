import type { StoredRelayConnection } from "../relay-connection";
import type { OrganizationRole } from "./organization-role";

export interface AuthState {
  isLoading: boolean;
  isSigningIn: boolean;
  isAuthenticated: boolean;
  sessionToken: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
  } | null;
  cloudOrganizationId: string | null;
  organizationRole: OrganizationRole | null;
  authError: string | null;
  signIn: () => void;
  connectRelay: (connection: StoredRelayConnection) => Promise<void>;
  signOut: (relayUrl?: string) => void;
  invalidateSession: () => void;
  updateProfileImage: (image: string | null) => Promise<void>;
}
