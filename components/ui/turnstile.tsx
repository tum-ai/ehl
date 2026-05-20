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

// Turnstile tokens expire after ~300s. Auto-refresh before that.
const TOKEN_MAX_AGE_MS = 250_000; // 4m10s, well before 5m expiry

export const Turnstile = forwardRef<TurnstileRef>(function Turnstile(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const scriptLoadedRef = useRef(false);
  const tokenRef = useRef<string>("");
  const tokenTimestampRef = useRef<number>(0);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // Cloudflare test keys always pass - skip in test/CI environments
  const isTestKey = siteKey?.startsWith("1x0000000000000000000");

  const resetWidget = useCallback(() => {
    tokenRef.current = "";
    tokenTimestampRef.current = 0;
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || !siteKey) return;
    if (widgetIdRef.current) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "dark",
      // "auto" refresh: Cloudflare will auto-refresh when possible,
      // but we also handle expiry manually below
      "refresh-expired": "auto",
      callback: (token: string) => {
        tokenRef.current = token;
        tokenTimestampRef.current = Date.now();
      },
      "expired-callback": () => {
        // Token expired, auto-reset for a fresh challenge
        console.warn("[Turnstile] Token expired, auto-refreshing");
        resetWidget();
      },
      "error-callback": () => {
        console.warn("[Turnstile] Challenge error, resetting");
        resetWidget();
      },
    });
  }, [siteKey, resetWidget]);

  useImperativeHandle(ref, () => ({
    getToken: () => {
      if (isTestKey || !siteKey) return "test-token";

      // Check if token is stale (older than ~4 minutes)
      if (tokenRef.current && tokenTimestampRef.current) {
        const age = Date.now() - tokenTimestampRef.current;
        if (age > TOKEN_MAX_AGE_MS) {
          console.warn("[Turnstile] Token too old, clearing");
          tokenRef.current = "";
          tokenTimestampRef.current = 0;
        }
      }

      // Always try getResponse as source of truth
      if (widgetIdRef.current && window.turnstile) {
        const fresh = window.turnstile.getResponse(widgetIdRef.current);
        if (fresh) {
          tokenRef.current = fresh;
          if (!tokenTimestampRef.current) tokenTimestampRef.current = Date.now();
        }
      }

      return tokenRef.current;
    },
    reset: resetWidget,
  }), [isTestKey, siteKey, resetWidget]);

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
