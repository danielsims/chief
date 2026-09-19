"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export interface FaqItem {
  answer: ReactNode;
  question: string;
}

export function FaqList({
  items,
  className,
}: {
  items: readonly FaqItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(0);

  return (
    <div className={className}>
      {items.map((item, index) => {
        const isOpen = open === index;
        return (
          <div className="shadow-[0_1px_0_var(--border)]" key={item.question}>
            <h3 className="m-0">
              <button
                aria-expanded={isOpen}
                className="text-foreground flex w-full items-center justify-between gap-6 py-[22px] text-left text-base leading-[1.4] tracking-[-0.02em]"
                onClick={() => setOpen(isOpen ? -1 : index)}
                type="button"
              >
                {item.question}
                <span
                  aria-hidden="true"
                  className="text-muted-foreground grid size-[22px] shrink-0 place-items-center text-[22px] leading-none"
                >
                  {isOpen ? "×" : "+"}
                </span>
              </button>
            </h3>
            {isOpen ? (
              <div className="pb-[22px]">
                <p className="text-muted-foreground m-0 max-w-[36em] text-[15px] leading-[1.65] [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[3px]">
                  {item.answer}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
