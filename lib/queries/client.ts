import { createClient } from "@supabase/supabase-js";

/** Read-only client using anon key. Works at build time (no cookies needed). */
export function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
