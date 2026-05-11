"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

interface MobileNavProps {
  links: { href: string; label: string }[];
  isLoggedIn?: boolean;
  userName?: string | null;
}

export function MobileNav({ links, isLoggedIn, userName }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="relative z-[60] p-2 text-text-secondary hover:text-text-primary cursor-pointer"
        aria-label="Toggle menu"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[55] flex flex-col items-center justify-center bg-surface-deep md:hidden">
          {/* Close button in top-right corner */}
          <button
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 z-10 p-2 text-text-secondary hover:text-text-primary cursor-pointer"
            aria-label="Close menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex flex-col items-center gap-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="px-8 py-4 text-2xl font-bold font-hero-body text-text-secondary transition-colors duration-200 hover:text-ci-jasmine"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-8 flex flex-col items-center gap-4">
              {isLoggedIn ? (
                <>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center rounded-full bg-ci-platinum px-8 py-3 text-base font-bold font-hero-heading uppercase tracking-[0.05em] text-ci-dark-amethyst"
                    onClick={() => setOpen(false)}
                  >
                    Dashboard
                  </Link>
                  <span className="text-sm text-text-muted">
                    {userName || "Logged in"}
                  </span>
                </>
              ) : (
                <>
                  <Link
                    href="/register"
                    className="inline-flex items-center rounded-full bg-ci-platinum px-8 py-3 text-base font-bold font-hero-heading uppercase tracking-[0.05em] text-ci-dark-amethyst"
                    onClick={() => setOpen(false)}
                  >
                    Register Now
                  </Link>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="text-sm text-text-muted transition-colors hover:text-text-primary"
                  >
                    Login
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
