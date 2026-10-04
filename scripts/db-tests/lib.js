// Harness: emulates the Supabase pieces the SAKAY migrations rely on, on top of PGlite.
// Nothing here touches the repository or any hosted database.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const MIG_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

const PREAMBLE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid, aud text DEFAULT 'authenticated', role text DEFAULT 'authenticated',
  email text, phone text, encrypted_password text,
  email_confirmed_at timestamptz, phone_confirmed_at timestamptz, confirmed_at timestamptz,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  is_sso_user boolean DEFAULT false, last_sign_in_at timestamptz,
  is_super_admin boolean, is_anonymous boolean DEFAULT false, deleted_at timestamptz, banned_until timestamptz,
  invited_at timestamptz, confirmation_token text, confirmation_sent_at timestamptz,
  recovery_token text, recovery_sent_at timestamptz,
  email_change text, email_change_token_new text, email_change_token_current text, email_change_sent_at timestamptz,
  phone_change text, phone_change_token text, phone_change_sent_at timestamptz,
  reauthentication_token text, reauthentication_sent_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL, provider text NOT NULL, provider_id text NOT NULL,
  last_sign_in_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(COALESCE(current_setting('request.jwt.claim.sub', true),
         (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub'), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true),
         (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb)->>'role') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
-- Same behaviour as Supabase's storage.foldername(): the folder parts WITHOUT the file name ('a/b/c.png' -> {a,b}; 'c.png' -> {}).
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
-- Supabase gives the API roles broad table privileges on storage; the row policies on storage.objects decide.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`;

async function newDb() {
  const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
  const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } });
  await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto');   // seed.sql uses crypt() / gen_salt()
  await db.exec(PREAMBLE);
  return db;
}

function listMigrations() {
  return fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
}

async function applyFile(db, file) {
  const sql = fs.readFileSync(path.join(MIG_DIR, file), 'utf8');
  await db.exec('BEGIN');
  try {
    await db.exec(sql);
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}

// Apply every migration whose name sorts <= `until` (inclusive). Returns list of results.
async function applyChain(db, until, { stopOnError = true } = {}) {
  const results = [];
  for (const f of listMigrations()) {
    if (until && f > until) break;
    try {
      await applyFile(db, f);
      results.push({ f, ok: true });
    } catch (e) {
      results.push({ f, ok: false, err: e.message });
      if (stopOnError) break;
    }
  }
  return results;
}

module.exports = { newDb, applyChain, applyFile, listMigrations, MIG_DIR };
