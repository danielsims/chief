/** Everyone's Welcome has the same name; each is its own private channel. */
export const WELCOME_CHANNEL_NAME = "Welcome";

/** Each person's private Welcome channel with Chief, one per member. */
export function welcomeChannelId(userId: string) {
  return `welcome-${userId.replace(/[^A-Za-z0-9._-]/gu, "-")}`.slice(0, 128);
}
