import { avatarUrl, fallbackColour, initials } from "@/app/lib/avatars";

// A person's picture, or their initials on a colour derived from their id.
// Decorative: the name is always shown next to it, so alt is empty.
export function Avatar({
  id,
  name,
  avatarPath,
  size = 32,
}: {
  id: string;
  name: string;
  avatarPath: string | null;
  size?: number;
}) {
  const style = { width: size, height: size };
  if (avatarPath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- already a 256px WebP; served by our own route behind the session
      <img src={avatarUrl(avatarPath)} alt="" width={size} height={size} style={style} className="shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...style, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${fallbackColour(id)}`}
    >
      {initials(name)}
    </span>
  );
}
