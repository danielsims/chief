import { useState } from "react";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@chief/ui/components/dialog";

import { useAuth } from "../lib/auth/auth-context";
import { useStartDirectMessage } from "../lib/use-start-direct-message";
import { useWorkspaceUsers } from "./chat/mention-people-context";
import { UserAvatar } from "./user-avatar";

export function NewDirectMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const users = useWorkspaceUsers();
  const startDirectMessage = useStartDirectMessage();
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const people = [...users.values()]
    .filter((person) => person.id !== user?.id)
    .filter((person) =>
      `${person.name} ${person.email ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const close = () => {
    setQuery("");
    setPendingId(null);
    onOpenChange(false);
  };

  const start = async (userId: string) => {
    if (pendingId) return;
    setPendingId(userId);
    const opened = await startDirectMessage(userId);
    if (opened) close();
    else setPendingId(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="max-w-lg gap-0 overflow-hidden rounded-2xl p-0">
        <div className="flex h-[440px] max-h-[70vh] flex-col">
          <div className="px-5 pt-5 pb-4">
            <DialogTitle>New message</DialogTitle>
            <DialogDescription className="sr-only">
              Search workspace members to start a direct message.
            </DialogDescription>
            <label className="bg-muted/55 mt-4 flex h-11 items-center gap-2.5 rounded-xl px-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_24%,transparent)]">
              <Search className="text-muted-foreground size-4 shrink-0" />
              <input
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing)
                    return;
                  event.preventDefault();
                  if (people[0]) void start(people[0].id);
                }}
                placeholder="Search people"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {people.length > 0 ? (
              <div className="bg-muted/20 divide-border/60 divide-y overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
                {people.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => void start(person.id)}
                    className="hover:bg-muted/55 flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors disabled:opacity-60"
                  >
                    <UserAvatar
                      name={person.name}
                      image={person.image}
                      className="size-7"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {person.name}
                      </span>
                      {person.email ? (
                        <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                          {person.email}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground px-4 py-12 text-center text-xs">
                {normalizedQuery
                  ? "No one matches your search."
                  : "Invite people to this workspace to message them."}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
