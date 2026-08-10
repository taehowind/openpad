// Board canvas themes. Solid themes only re-tint the surface variables; gradient themes also set
// --board-gradient, which .trello-shell paints as a background image. Both kinds are defined in
// globals.css (the [data-board-bg] rules), so each one's dark counterpart sits next to it.
export const BOARD_BACKGROUNDS = [
  { value: "default", label: "기본", kind: "solid" },
  { value: "cream", label: "크림", kind: "solid" },
  { value: "sky", label: "하늘", kind: "solid" },
  { value: "mint", label: "민트", kind: "solid" },
  { value: "lavender", label: "라벤더", kind: "solid" },
  { value: "peach", label: "피치", kind: "solid" },
  { value: "rose", label: "로즈", kind: "solid" },
  { value: "sand", label: "샌드", kind: "solid" },
  { value: "slate", label: "슬레이트", kind: "solid" },
  { value: "forest", label: "포레스트", kind: "solid" },

  { value: "sunrise", label: "일출", kind: "gradient" },
  { value: "dusk", label: "노을", kind: "gradient" },
  { value: "ocean", label: "바다", kind: "gradient" },
  { value: "meadow", label: "초원", kind: "gradient" },
  { value: "lilac", label: "라일락", kind: "gradient" },
  { value: "aurora", label: "오로라", kind: "gradient" },
  { value: "ember", label: "잔광", kind: "gradient" },
  { value: "glacier", label: "빙하", kind: "gradient" },
] as const;

export type BoardBackground = (typeof BOARD_BACKGROUNDS)[number]["value"];

const VALUES = new Set<string>(BOARD_BACKGROUNDS.map((item) => item.value));

export function isBoardBackground(value: string): value is BoardBackground {
  return VALUES.has(value);
}

export function normalizeBackground(value: string | null | undefined): BoardBackground {
  return value && isBoardBackground(value) ? value : "default";
}
