import { after } from "next/server";

// Transactional emails that must not block the response (application
// confirmations, team invites, welcome mails) cannot be sent as floating
// promises: on Vercel the function instance is frozen the moment the action
// returns, so an un-awaited promise is silently dropped. after() keeps the
// instance alive until the callback settles while the user already has
// their response.
//
// Kept separate from lib/email.ts because that module is also imported by
// standalone scripts, where next/server's request scope does not exist.
export function sendEmailAfterResponse(label: string, task: () => Promise<unknown>) {
  after(async () => {
    try {
      await task();
      console.log(`[Email] Deferred send completed (${label})`);
    } catch (err) {
      console.error(`[Email] Deferred send failed (${label}):`, err);
    }
  });
}
