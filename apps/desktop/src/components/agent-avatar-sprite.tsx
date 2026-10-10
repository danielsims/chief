import { useEffect, useState } from "react";

import type { AgentAvatar } from "@chief/relay-contracts";

type Sprite = Extract<AgentAvatar, { kind: "sprite" }>;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Loops a sprite sheet's first frames, row by row, as an idle animation.
 * With reduced motion it holds the first frame. */
export function AgentAvatarSprite({ sprite }: { sprite: Sprite }) {
  const { url, columns, rows, frames, fps } = sprite;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (frames < 2 || prefersReducedMotion()) return;
    const timer = window.setInterval(
      () => setFrame((current) => (current + 1) % frames),
      1_000 / fps,
    );
    return () => window.clearInterval(timer);
  }, [fps, frames]);
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  return (
    <span
      aria-hidden
      className="size-full bg-no-repeat [image-rendering:pixelated]"
      style={{
        backgroundImage: `url(${JSON.stringify(url)})`,
        backgroundSize: `${columns * 100}% ${rows * 100}%`,
        backgroundPosition: `${columns > 1 ? (column / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
      }}
    />
  );
}
