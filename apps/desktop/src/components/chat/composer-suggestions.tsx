const CHAT_SUGGESTIONS = [
  "What should we focus on this week?",
  "Review our current marketing plan",
  "Where are we losing momentum?",
];

export function ComposerSuggestions({
  onSelect,
}: {
  onSelect: (suggestion: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {CHAT_SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg border px-2.5 py-1.5 text-xs transition-colors"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
