import data from "@emoji-mart/data";

export interface EmojiOption {
  emoji: string;
  shortcode: string;
  name?: string;
  keywords: string;
}

export const EMOJI_OPTIONS: readonly EmojiOption[] = [
  { emoji: "👍", shortcode: "thumbsup", keywords: "like yes approve +1" },
  { emoji: "❤️", shortcode: "heart", keywords: "love red" },
  { emoji: "😂", shortcode: "joy", keywords: "laugh tears funny" },
  { emoji: "🎉", shortcode: "tada", keywords: "celebrate party congrats" },
  { emoji: "🔥", shortcode: "fire", keywords: "hot excellent" },
  { emoji: "👏", shortcode: "clap", keywords: "applause well done" },
  { emoji: "✅", shortcode: "white_check_mark", keywords: "done complete yes" },
  { emoji: "👀", shortcode: "eyes", keywords: "looking review" },
  { emoji: "🚀", shortcode: "rocket", keywords: "launch ship" },
  { emoji: "💯", shortcode: "100", keywords: "perfect hundred" },
  { emoji: "🙏", shortcode: "pray", keywords: "thanks please" },
  { emoji: "💪", shortcode: "muscle", keywords: "strong flex" },
  { emoji: "🤔", shortcode: "thinking", keywords: "hmm consider" },
  { emoji: "😍", shortcode: "heart_eyes", keywords: "love excited" },
  { emoji: "😊", shortcode: "blush", keywords: "smile happy" },
  { emoji: "😄", shortcode: "smile", keywords: "happy grin" },
  { emoji: "🙌", shortcode: "raised_hands", keywords: "hooray celebrate" },
  { emoji: "🤝", shortcode: "handshake", keywords: "deal agreement" },
  { emoji: "💡", shortcode: "bulb", keywords: "idea insight" },
  { emoji: "⚡", shortcode: "zap", keywords: "fast energy" },
  { emoji: "📈", shortcode: "chart_up", keywords: "growth analytics" },
  { emoji: "🎯", shortcode: "dart", keywords: "target goal" },
  { emoji: "🫡", shortcode: "saluting_face", keywords: "acknowledge salute" },
  { emoji: "😅", shortcode: "sweat_smile", keywords: "relief nervous" },
  { emoji: "😮", shortcode: "open_mouth", keywords: "wow surprised" },
  { emoji: "😢", shortcode: "cry", keywords: "sad tear" },
  { emoji: "😬", shortcode: "grimacing", keywords: "awkward nervous" },
  { emoji: "👎", shortcode: "thumbsdown", keywords: "dislike no -1" },
  { emoji: "❌", shortcode: "x", keywords: "no remove cancel" },
  { emoji: "⚠️", shortcode: "warning", keywords: "alert caution" },
  { emoji: "🐛", shortcode: "bug", keywords: "issue fix" },
  { emoji: "✨", shortcode: "sparkles", keywords: "new magic polish" },
];

interface EmojiMartData {
  emojis?: Record<
    string,
    {
      id?: string;
      name?: string;
      keywords?: string[];
      skins?: { native?: string }[];
    }
  >;
}

let completeEmojiIndex: readonly EmojiOption[] | undefined;

function allEmoji() {
  if (completeEmojiIndex) return completeEmojiIndex;
  completeEmojiIndex = Object.entries(
    (data as EmojiMartData).emojis ?? {},
  ).flatMap(([fallbackShortcode, emoji]) => {
    const native = emoji.skins?.[0]?.native;
    if (!native) return [];
    const shortcode = emoji.id ?? fallbackShortcode;
    return [
      {
        emoji: native,
        shortcode,
        name: emoji.name ?? shortcode,
        keywords: (emoji.keywords ?? []).join(" "),
      },
    ];
  });
  return completeEmojiIndex;
}

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[:_\s-]/g, "");
}

function matchRank(option: EmojiOption, query: string) {
  const candidate = normalized(option.shortcode);
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1;
  if (candidate.includes(query)) return 2;
  const name = normalized(option.name ?? "");
  if (name.startsWith(query)) return 3;
  if (name.includes(query)) return 4;
  const keywords = normalized(option.keywords);
  if (keywords.includes(query)) return 5;
  return Number.POSITIVE_INFINITY;
}

export function matchingEmoji(query: string, limit = 8) {
  const normalizedQuery = normalized(query);
  if (normalizedQuery.length < 2) return [];
  return allEmoji()
    .map((option) => ({ option, rank: matchRank(option, normalizedQuery) }))
    .filter(({ rank }) => Number.isFinite(rank))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.option.shortcode.length - right.option.shortcode.length ||
        left.option.shortcode.localeCompare(right.option.shortcode),
    )
    .slice(0, limit)
    .map(({ option }) => option);
}

export function emojiForShortcode(shortcode: string) {
  const normalized = shortcode.toLocaleLowerCase();
  return allEmoji().find((option) => option.shortcode === normalized);
}
