"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAdminAction } from "@/lib/admin-auth";
import { isAdminEmail } from "@/lib/admin-allowlist";
import { logEvent } from "@/lib/event-log";

// Local (chapter) admins are managed exclusively by GLOBAL admins, so a local
// admin can never invite or escalate another. Every action here guards with
// requireAdminAction() (global-admin only).

// ─── List local admins for a chapter ─────────────────────────────────────

export async function getChapterAdmins(chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const adminClient = createAdminClient();

  const { data: rows } = await adminClient
    .from("chapter_admins")
    .select("user_id, created_at")
    .eq("chapter_id", chapterId)
    .order("created_at", { ascending: true });

  if (!rows || rows.length === 0) return { admins: [] };

  const userIds = rows.map((r) => r.user_id as string);
  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id, name, email")
    .in("id", userIds);

  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id as string, p])
  );

  const admins = rows.map((r) => {
    const profile = profileById.get(r.user_id as string);
    return {
      userId: r.user_id as string,
      name: (profile?.name as string) ?? null,
      email: (profile?.email as string) ?? null,
      createdAt: r.created_at as string,
    };
  });

  return { admins };
}

// ─── Invite a local admin to a chapter ───────────────────────────────────

export async function inviteChapterAdmin(
  email: string,
  name: string,
  chapterId: string
) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = name.trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    return { error: "Enter a valid email address." };
  }
  if (!normalizedName) {
    return { error: "Name is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const adminClient = createAdminClient();

  // Verify the chapter exists.
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("id")
    .eq("id", chapterId)
    .single();
  if (!chapter) return { error: "Chapter not found." };

  // Find or create the auth user. Supabase signups are disabled, so we
  // pre-provision the account here (mirrors addAdminEmail); without this, the
  // person's first Google OAuth login would fail with signup_disabled.
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  let userId: string;
  if (existingProfile) {
    userId = existingProfile.id as string;
  } else {
    const { data: authUser, error: createErr } =
      await adminClient.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: { name: normalizedName },
      });
    if (createErr || !authUser?.user) {
      // The auth user may already exist without a profile row — e.g. a prior
      // invite that failed AFTER createUser but before the profile write (such
      // as when the chapter_admin enum/table migration was missing). createUser
      // then returns "already been registered". Recover the existing user's id
      // via generateLink (which resolves an existing user even though signups
      // are disabled) instead of failing, so re-inviting is never permanently
      // blocked by a half-finished earlier attempt.
      const { data: link } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: normalizedEmail,
      });
      if (!link?.user) {
        return { error: createErr?.message ?? "Failed to create user account." };
      }
      userId = link.user.id;
    } else {
      userId = authUser.user.id;
    }
  }

  // Global admins outrank chapter admins; don't downgrade their role.
  if (!(await isAdminEmail(normalizedEmail))) {
    await adminClient.from("profiles").upsert({
      id: userId,
      email: normalizedEmail,
      name: normalizedName,
      role: "chapter_admin",
    });
  } else {
    // Ensure the profile exists, but keep their global admin role.
    await adminClient.from("profiles").upsert({
      id: userId,
      email: normalizedEmail,
      name: normalizedName,
      role: "admin",
    });
  }

  // Chapter admins are single-chapter. Reject if this person already admins any chapter.
  const { data: existingAny } = await adminClient
    .from("chapter_admins")
    .select("chapter_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingAny) {
    if (existingAny.chapter_id === chapterId) {
      return { error: "This person is already a local admin for this chapter." };
    }
    return { error: "This person is already a local admin for another chapter. Remove them from that chapter first." };
  }

  const { error: insertErr } = await adminClient
    .from("chapter_admins")
    .insert({ user_id: userId, chapter_id: chapterId, invited_by: user.id });
  if (insertErr) return { error: insertErr.message };

  logEvent({
    action: "chapter_admin.added",
    entityType: "chapter_admins",
    entityId: chapterId,
    actorId: user.id,
    actorType: "admin",
    delta: { created: { email: normalizedEmail, chapter_id: chapterId } },
  });

  return { success: true };
}

// ─── Remove a local admin from a chapter ─────────────────────────────────

export async function removeChapterAdmin(userId: string, chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const adminClient = createAdminClient();

  const { error: delErr } = await adminClient
    .from("chapter_admins")
    .delete()
    .eq("user_id", userId)
    .eq("chapter_id", chapterId);
  if (delErr) return { error: delErr.message };

  // If they no longer administer any chapter and aren't a global admin,
  // downgrade their profile role back to participant (mirrors removeAdminEmail).
  const { data: profile } = await adminClient
    .from("profiles")
    .select("email, role")
    .eq("id", userId)
    .maybeSingle();

  if (profile && profile.role === "chapter_admin") {
    const { count } = await adminClient
      .from("chapter_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId);

    const stillGlobalAdmin = profile.email
      ? await isAdminEmail(profile.email as string)
      : false;

    if ((count ?? 0) === 0 && !stillGlobalAdmin) {
      await adminClient
        .from("profiles")
        .update({ role: "participant" })
        .eq("id", userId);
    }
  }

  logEvent({
    action: "chapter_admin.removed",
    entityType: "chapter_admins",
    entityId: chapterId,
    actorId: user.id,
    actorType: "admin",
    delta: { deleted: { user_id: userId, chapter_id: chapterId } },
  });

  return { success: true };
}
