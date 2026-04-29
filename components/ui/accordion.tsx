"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface AccordionItem {
  title: string;
  content: React.ReactNode;
}

interface AccordionProps {
  items: AccordionItem[];
  className?: string;
}

export function Accordion({ items, className }: AccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className={cn("divide-y divide-white/10", className)}>
      {items.map((item, index) => (
        <div key={index}>
          <button
            onClick={() =>
              setOpenIndex(openIndex === index ? null : index)
            }
            className="flex w-full items-center justify-between py-4 text-left transition-colors duration-200 hover:text-gold cursor-pointer"
          >
            <span className="text-lg font-medium">{item.title}</span>
            <svg
              className={cn(
                "h-5 w-5 shrink-0 text-text-muted transition-transform duration-200",
                openIndex === index && "rotate-180"
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <div
            className={cn(
              "overflow-hidden transition-all duration-300",
              openIndex === index ? "max-h-[2000px] pb-4" : "max-h-0"
            )}
          >
            <div className="text-text-secondary">{item.content}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
