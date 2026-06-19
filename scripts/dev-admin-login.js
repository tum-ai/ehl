/**
 * Generates a magic link for local admin login without Google OAuth.
 * Usage: dotenv -e .env.test -- node scripts/dev-admin-login.js
 *
 * Kept alongside /dev-login on purpose: this is a standalone admin bootstrap that
 * needs neither the app running, nor Docker, nor DEV_LOGIN_ENABLED. It creates the
 * admin auth.user inline (createUser) and prints a magic URL you can open against any
 * running instance. /dev-login is the in-app one-click flow for every role, but it
 * requires the personas to already exist in auth.users. The canonical seed that
 * creates auth.users for ALL personas is scripts/seed-test-via-api.ts; this script
 * is the admin-only fallback, not that seed path.
 */
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_ID = 'a0000000-0000-0000-0000-000000000001';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';

async function main() {
  // Create auth user if it doesn't exist yet (matches the seed profile row)
  const { error: createError } = await admin.auth.admin.createUser({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    email_confirm: true,
  });

  if (createError && !createError.message.toLowerCase().includes('already')) {
    console.error('Could not create user:', createError.message);
    process.exit(1);
  }

  // Generate magic link
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: ADMIN_EMAIL,
    options: { redirectTo: `${SITE_URL}/auth/callback?next=/dashboard` },
  });

  if (error) {
    console.error('Could not generate magic link:', error.message);
    process.exit(1);
  }

  const url = `${SITE_URL}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink&next=/dashboard`;
  console.log('\nOpen this URL in your browser:\n');
  console.log(url);
  console.log('');
}

main();
