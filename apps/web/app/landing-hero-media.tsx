"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

const DESKTOP_SIZES =
  "(max-width: 767px) calc(95vw - 35px), (max-width: 1023px) calc(93vw - 65px), calc(min(1380px, 92vw) - 88px)";

const PHONE_SIZES = "(max-width: 767px) 23vw, (max-width: 1023px) 22vw, 320px";

// Steps 4 and 5 of the hero cascade, measured from navigation start so the
// sequence stays in time with the copy even if hydration is slow. The 70ms gap
// matches the `data-rise` rhythm the headline, copy and buttons use.
const DESKTOP_AT_MS = 200;
const PHONE_AT_MS = 270;

// Last resort so a stalled request can never leave the hero blank.
const FALLBACK_MS = 3000;

function hasDecoded(ref: RefObject<HTMLImageElement | null>) {
  const image = ref.current;
  return Boolean(image?.complete && image.naturalWidth > 0);
}

/**
 * Reveals once the image has decoded, at a fixed point in the page cascade.
 * A slow image pushes its own reveal back rather than shifting the sequence.
 */
function useCascadeReveal(
  ref: RefObject<HTMLImageElement | null>,
  atMs: number,
) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const image = ref.current;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (done) return;
      done = true;
      timer = setTimeout(
        () => setRevealed(true),
        Math.max(0, atMs - performance.now()),
      );
    };

    image?.addEventListener("load", schedule, { once: true });
    image?.addEventListener("error", schedule, { once: true });
    // The image may have finished before hydration ran this effect.
    if (hasDecoded(ref)) schedule();

    const fallback = setTimeout(schedule, FALLBACK_MS);

    return () => {
      image?.removeEventListener("load", schedule);
      image?.removeEventListener("error", schedule);
      clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, [atMs, ref]);

  return revealed;
}

export function LandingHeroMedia() {
  const desktopRef = useRef<HTMLImageElement>(null);
  const phoneRef = useRef<HTMLImageElement>(null);
  const desktopReady = useCascadeReveal(desktopRef, DESKTOP_AT_MS);
  const phoneReady = useCascadeReveal(phoneRef, PHONE_AT_MS);

  return (
    <div className="relative mx-auto w-[min(1380px,92%)] pr-[88px] pb-[35px] max-lg:w-[93%] max-lg:pr-[65px] max-md:w-[95%] max-md:pr-[35px] max-md:pb-7">
      <div className="hero-reveal" data-revealed={desktopReady}>
        <Image
          alt="Chief desktop: Mission Control with the Engineer thread open"
          className="h-auto w-full drop-shadow-[0_24px_35px_#0003]"
          height={1094}
          priority
          ref={desktopRef}
          sizes={DESKTOP_SIZES}
          src="/landing/mission-control.png"
          width={1838}
        />
      </div>
      <div
        className="hero-reveal absolute right-0 bottom-0 w-[23.5%] max-md:w-[25%]"
        data-revealed={phoneReady}
      >
        <div className="overflow-hidden rounded-[40px] border border-[#777] bg-[#141416] p-[7px] shadow-[0_20px_55px_#0005] max-md:rounded-[15px] max-md:p-[3px]">
          <Image
            alt="Chief for iPhone running the built-in demo workspace"
            className="h-auto w-full rounded-[33px] max-md:rounded-[11px]"
            height={2868}
            loading="eager"
            ref={phoneRef}
            sizes={PHONE_SIZES}
            src="/landing/iphone.png"
            width={1320}
          />
        </div>
      </div>
    </div>
  );
}
