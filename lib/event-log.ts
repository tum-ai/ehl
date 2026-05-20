/**
 * Event Log: Append-only audit trail with hash-chain integrity.
 *
 * Two variants:
 * - logEvent(): fire-and-forget for non-critical actions
 * - logEventStrict(): synchronous, throws on failure (for score/financial actions)
 *
 * Convention for action names: "{entity}.{verb}"
 *   e.g. "application.submitted", "score.published", "chapter.status_changed"
 *
 * Convention for delta (what changed):
 *   Status: { "status": { "from": "pending", "to": "accepted" } }
 *   Create: { "created": { "name": "...", "email": "..." } }
 *   Delete: { "deleted": { "name": "..." } }
 *   Update: { "field": { "from": oldValue, "to": newValue } }
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface EventLogOpts {
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  actorType?: "admin" | "participant" | "jury" | "system";
  delta: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Compute SHA-256 hash for chain integrity.
 * Uses Web Crypto API (available in Node.js 18+ and Edge).
 */
async function computeHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Internal: insert event into the log with hash-chain.
 */
async function insertEvent(opts: EventLogOpts): Promise<void> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  // Get previous hash for chain
  const { data: prevEntry } = await adminClient
    .from("event_log")
    .select("entry_hash")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const prevHash = (prevEntry?.entry_hash as string) ?? "genesis";

  // Compute entry hash
  const hashInput = JSON.stringify({
    action: opts.action,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    delta: opts.delta,
    prev_hash: prevHash,
    created_at: now,
  });
  const entryHash = await computeHash(hashInput);

  const { error } = await adminClient.from("event_log").insert({
    action: opts.action,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    actor_id: opts.actorId ?? null,
    actor_type: opts.actorType ?? "system",
    delta: opts.delta,
    prev_hash: prevHash,
    entry_hash: entryHash,
    metadata: opts.metadata ?? {},
    created_at: now,
  });

  if (error) {
    throw new Error(`Event log insert failed: ${error.message}`);
  }
}

/**
 * Fire-and-forget event logging for non-critical actions.
 * Does not await, does not throw. Failures are silently logged to console.
 * Use for: registrations, team updates, invites, flag operations, etc.
 */
export function logEvent(opts: EventLogOpts): void {
  insertEvent(opts).catch((err) => {
    console.error("[EventLog] Non-critical log failed:", err.message, opts.action);
  });
}

/**
 * Strict event logging for financial/score-critical actions.
 * Awaited. Throws on failure so the calling action can rollback.
 * Use for: score publishing, jury rankings, submission locks, score overrides.
 */
export async function logEventStrict(opts: EventLogOpts): Promise<void> {
  await insertEvent(opts);
}

/**
 * Verify the hash-chain integrity of the event log.
 * Returns the first broken entry, or null if the chain is intact.
 */
export async function verifyHashChain(): Promise<{
  intact: boolean;
  brokenAt?: string;
  totalEntries: number;
}> {
  const adminClient = createAdminClient();
  const { data: entries } = await adminClient
    .from("event_log")
    .select("id, action, entity_type, entity_id, delta, prev_hash, entry_hash, created_at")
    .order("created_at", { ascending: true });

  if (!entries || entries.length === 0) {
    return { intact: true, totalEntries: 0 };
  }

  let expectedPrevHash = "genesis";

  for (const entry of entries) {
    // Verify prev_hash links correctly
    if (entry.prev_hash !== expectedPrevHash) {
      return { intact: false, brokenAt: entry.id as string, totalEntries: entries.length };
    }

    // Verify entry_hash is correct
    const hashInput = JSON.stringify({
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      delta: entry.delta,
      prev_hash: entry.prev_hash,
      created_at: entry.created_at,
    });
    const computed = await computeHash(hashInput);
    if (computed !== entry.entry_hash) {
      return { intact: false, brokenAt: entry.id as string, totalEntries: entries.length };
    }

    expectedPrevHash = entry.entry_hash as string;
  }

  return { intact: true, totalEntries: entries.length };
}
