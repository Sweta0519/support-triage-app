// A macOS window's close, minimise and zoom buttons (decoration only).
export function TrafficLights() {
  return (
    <span aria-hidden="true" className="flex gap-2">
      <span className="h-3 w-3 rounded-full bg-[#FF5F57] ring-1 ring-black/10" />
      <span className="h-3 w-3 rounded-full bg-[#FEBC2E] ring-1 ring-black/10" />
      <span className="h-3 w-3 rounded-full bg-[#28C840] ring-1 ring-black/10" />
    </span>
  );
}
