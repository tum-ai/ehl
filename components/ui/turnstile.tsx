"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";

export interface TurnstileRef {
  /** Returns the current token, or empty string if not yet solved */
  getToken: () => string;
  /** Resets the widget for a fresh challenge (call after form error) */
  reset: () => void;
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
      getResponse: (widgetId: string) => string | undefined;
    };
    onTurnstileLoad?: () => void;
  }
}

export const Turnstile = forwardRef<TurnstileRef>(function Turnstile(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const scriptLoadedRef = useRef(false);
  const tokenRef = useRef<string>("");

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // Cloudflare test keys always pass - skip in test/CI environments
  const isTestKey = siteKey?.startsWith("1x0000000000000000000");

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || !siteKey) return;
    if (widgetIdRef.current) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "dark",
      callback: (token: string) => {
        tokenRef.current = token;
      },
      "expired-callback": () => {
        tokenRef.current = "";
      },
      "error-callback": () => {
        console.warn("[Turnstile] Challenge error, token cleared");
        tokenRef.current = "";
      },
    });
  }, [siteKey]);

  useImperativeHandle(ref, () => ({
    getToken: () => {
      if (isTestKey || !siteKey) return "test-token";
      // Also try getResponse as fallback
      if (!tokenRef.current && widgetIdRef.current && window.turnstile) {
        tokenRef.current = window.turnstile.getResponse(widgetIdRef.current) ?? "";
      }
      return tokenRef.current;
    },
    reset: () => {
      tokenRef.current = "";
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    },
  }), [isTestKey, siteKey]);

  useEffect(() => {
    if (!siteKey || isTestKey) return;

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
  }, [siteKey, isTestKey, renderWidget]);

  if (!siteKey || isTestKey) return null;

  return <div ref={containerRef} />;
});
