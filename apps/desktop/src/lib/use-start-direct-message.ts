import { useCallback } from "react";

import { useChiefNavigation } from "./chief-navigation-context";
import { useWorkspaceChannels } from "./workspace-channels-context";

/** Opens (or reuses) a DM with another workspace member and shows it. */
export function useStartDirectMessage() {
  const { startUserDirect } = useWorkspaceChannels();
  const navigation = useChiefNavigation();
  return useCallback(
    async (userId: string) => {
      const channelId = await startUserDirect(userId);
      if (!channelId) return false;
      navigation.open(
        { kind: "conversation", channelId },
        { state: { focusComposerFor: channelId } },
      );
      return true;
    },
    [navigation, startUserDirect],
  );
}
