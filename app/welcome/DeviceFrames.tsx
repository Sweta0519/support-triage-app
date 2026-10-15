import Image from "next/image";

// Device frames for the homepage's product screenshots (SUP-49), drawn in
// CSS rather than taken from Apple's device artwork: a macOS window and an
// iPhone 16-proportioned phone. The screenshots inside are real captures of
// the app (scripts/capture-marketing.mjs).

// A macOS window: traffic lights and a title bar over a 1440x900 capture.
// `sizes` is the window's rendered width, so the browser picks the right file.
export function MacWindow({ src, alt, title, sizes }: { src: string; alt: string; title: string; sizes: string }) {
  return (
    // Shown on the homepage's dark band (SUP-60): a light hairline and a deep
    // shadow keep the window's edge readable against the indigo.
    <div className="overflow-hidden rounded-xl bg-white shadow-[0_30px_70px_-24px_rgba(0,0,0,0.7)] ring-1 ring-white/15">
      <div className="relative flex h-9 items-center border-b border-black/[.08] bg-[#F3F4F6] px-3.5">
        <TrafficLights />
        <span className="absolute inset-x-0 text-center text-[12px] font-medium text-[#5B606B]">{title}</span>
      </div>
      <Image src={src} alt={alt} width={2400} height={1500} sizes={sizes} className="block h-auto w-full" />
    </div>
  );
}

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

// An iPhone 16-proportioned phone (393x852 points): a dark band, rounded
// corners and the Dynamic Island over a 3x capture.
export function Phone({ src, alt }: { src: string; alt: string }) {
  return (
    // The bezel's light hairline separates it from the dark band behind it.
    <div className="relative w-[230px] rounded-[44px] bg-[#1C1D21] p-[9px] shadow-[0_30px_70px_-20px_rgba(0,0,0,0.75)] ring-1 ring-white/20 sm:w-[260px] sm:rounded-[50px] sm:p-[10px]">
      <div className="relative overflow-hidden rounded-[35px] bg-white sm:rounded-[40px]">
        <span aria-hidden="true" className="absolute left-1/2 top-2.5 z-10 h-[22px] w-[74px] -translate-x-1/2 rounded-full bg-black sm:h-[25px] sm:w-[84px]" />
        {/* The status bar the screenshot lacks, so the island doesn't sit on the app's header. */}
        <div aria-hidden="true" className="h-[38px] bg-white sm:h-[44px]" />
        <Image src={src} alt={alt} width={1179} height={2556} sizes="(min-width: 640px) 240px, 212px" className="block h-auto w-full" />
      </div>
    </div>
  );
}
