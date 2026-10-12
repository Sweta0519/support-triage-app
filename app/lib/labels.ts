// Team labels (SUP-39): the colour palette and shared types. No server-only
// import -- client components (the label picker, card menu) use it. The
// database allows exactly these colour names (labels_color_check).

export const LABEL_COLORS = {
  gray: "bg-zinc-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
  teal: "bg-teal-500",
  sky: "bg-sky-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
} as const;

export type LabelColor = keyof typeof LABEL_COLORS;

export const LABEL_NAME_MAX_LENGTH = 40;

export type TeamLabel = { id: string; name: string; color: LabelColor };

export function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === "string" && Object.hasOwn(LABEL_COLORS, value);
}

export function labelDot(color: string): string {
  return isLabelColor(color) ? LABEL_COLORS[color] : LABEL_COLORS.gray;
}

// A new label's colour, cycling through the palette by name so labels made
// in a row don't all come out grey.
export function defaultLabelColor(name: string): LabelColor {
  const colors = Object.keys(LABEL_COLORS).filter((c) => c !== "gray") as LabelColor[];
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

// Trimmed; an error message, or null when the name is acceptable.
export function labelNameError(name: string): string | null {
  if (!name) return "Give the label a name.";
  if (Array.from(name).length > LABEL_NAME_MAX_LENGTH) return `Keep label names to ${LABEL_NAME_MAX_LENGTH} characters.`;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return "Label names can't contain line breaks.";
  return null;
}
