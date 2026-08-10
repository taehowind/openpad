export const PROFILE_EMOJIS = [
  "😀", "😎", "🤖", "🐱", "🐶", "🦊", "🐼", "🐯", "🐸", "🐧",
  "🦄", "🚀", "🌟", "💡", "🎓", "🎨", "🧠", "☕", "🌱", "🔥",
] as const;

export function isProfileEmoji(value: string): value is (typeof PROFILE_EMOJIS)[number] {
  return PROFILE_EMOJIS.includes(value as (typeof PROFILE_EMOJIS)[number]);
}
