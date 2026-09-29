import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import type { ComposerImageAttachment } from "../components/chat/composer-image-attachments";
import type { WorkspaceAgentId } from "../lib/workspace-channels";
import { ChatComposer } from "../components/chat/chat-composer";
import { createComposerHandoff } from "../components/chat/composer-handoff";
import { ComposerRecipient } from "../components/chat/composer-recipient";
import { PageTitle } from "../components/page-title";
import { useAuth } from "../lib/auth/auth-context";
import { useRuntime } from "../lib/runtime";
import {
  directMessageIdsForAgents,
  workspaceAgentIdentity,
} from "../lib/workspace-channels";
import { DASHBOARD_MENTION_CANDIDATES } from "./dashboard-constants";

function greeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The overview is a place to start: a greeting and a composer that opens a
 * direct conversation with the chosen agent.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { agents } = useRuntime();
  const [ask, setAsk] = useState("");
  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>([]);
  const [recipientId, setRecipientId] = useState<WorkspaceAgentId>("chief");
  const recipients = useMemo(
    () =>
      directMessageIdsForAgents(agents).map((id) => ({
        id,
        name: workspaceAgentIdentity(id, agents).name,
      })),
    [agents],
  );
  const [openedAt] = useState(() => Date.now());
  const firstName = user?.name.trim().split(/\s+/)[0] ?? "there";

  const submit = () => {
    const text = ask.trim();
    if (!text && attachments.length === 0) return;
    const params = new URLSearchParams({
      dm: recipientId,
      handoff: createComposerHandoff({ text, attachments }),
    });
    void navigate(`/conversations?${params.toString()}`);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center px-4 pb-[8vh]">
      <div className="w-full max-w-[680px]">
        <PageTitle size="overview">
          {greeting(openedAt)}, {firstName}
        </PageTitle>
        <ChatComposer
          className="mt-6 w-full"
          autoFocus
          value={ask}
          onValueChange={setAsk}
          onSubmit={submit}
          imageAttachments={attachments}
          onImageAttachmentsChange={setAttachments}
          mentionCandidates={DASHBOARD_MENTION_CANDIDATES}
          showExecutionControls={false}
          showSuggestions={false}
          placeholder={`Message ${
            recipients.find(({ id }) => id === recipientId)?.name ?? "Chief"
          }…`}
          recipient={
            recipients.length > 0 ? (
              <ComposerRecipient
                options={recipients}
                value={recipientId}
                onChange={setRecipientId}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}
