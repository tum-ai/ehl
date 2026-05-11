"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";

export interface TurnstileRef {
  execute: () => Promise<string>;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: Record<string, unknown>
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
      execute: (container: HTMLElement | string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

export const Turnstile = forwardRef<TurnstileRef>(function Turnstile(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const scriptLoadedRef = useRef(false);
  const resolveRef = useRef<((token: string) => void) | null>(null);
  const rejectRef = useRef<((err: Error) => void) | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || !siteKey) return;
    if (widgetIdRef.current) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      execution: "execute",
      appearance: "execute",
      theme: "dark",
      callback: (token: string) => {
        resolveRef.current?.(token);
        resolveRef.current = null;
        rejectRef.current = null;
      },
      "error-callback": () => {
        rejectRef.current?.(new Error("Turnstile challenge failed"));
        resolveRef.current = null;
        rejectRef.current = null;
      },
      "timeout-callback": () => {
        rejectRef.current?.(new Error("Turnstile challenge timed out"));
        resolveRef.current = null;
        rejectRef.current = null;
      },
    });
  }, [siteKey]);

  useImperativeHandle(ref, () => ({
    execute: () => {
      return new Promise<string>((resolve, reject) => {
        if (!window.turnstile || !widgetIdRef.current) {
          reject(new Error("Turnstile not loaded"));
          return;
        }

        // Reset first to ensure a fresh challenge every time
        window.turnstile.reset(widgetIdRef.current);
        resolveRef.current = resolve;
        rejectRef.current = reject;
        window.turnstile.execute(containerRef.current!);
      });
    },
  }), []);

  useEffect(() => {
    if (!siteKey) return;

    if (window.turnstile) {
      renderWidget();
      return;
    }

    if (!scriptLoadedRef.current) {
      scriptLoadedRef.current = true;
      window.onTurnstileLoad = renderWidget;

      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      script.async = true;
      document.head.appendChild(script);
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, renderWidget]);

  if (!siteKey) return null;

  return <div ref={containerRef} />;
});
