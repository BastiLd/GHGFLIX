export function migrateAccounts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
    server_token_hash TEXT NOT NULL, profile_id INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS account_sessions_owner ON account_sessions(account_id);
  CREATE TABLE IF NOT EXISTS deleted_cloud_profiles (supabase_id TEXT PRIMARY KEY);`);
  if (!db.prepare('PRAGMA table_info(profiles)').all().some(c => c.name === 'account_id')) {
    // Preserve numeric IDs and all referencing progress/favorite rows. Names
    // belong to an account; two families can both have a profile called "Anna".
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE profiles_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, avatar TEXT, supabase_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0,
        account_id INTEGER REFERENCES accounts(id), is_child INTEGER NOT NULL DEFAULT 0,
        max_age INTEGER NOT NULL DEFAULT 12, UNIQUE(account_id,name)
      );
      INSERT INTO profiles_accounts(id,name,avatar,supabase_id,created_at,updated_at)
        SELECT id,name,avatar,supabase_id,created_at,updated_at FROM profiles;
      DROP TABLE profiles;
      ALTER TABLE profiles_accounts RENAME TO profiles;
      COMMIT;`);
  }
  if (!db.prepare('PRAGMA table_info(profiles)').all().some(c=>c.name==='pin_hash')) db.exec('ALTER TABLE profiles ADD COLUMN pin_hash TEXT');
  if (!db.prepare('PRAGMA table_info(accounts)').all().some(c=>c.name==='google_sub')) db.exec('ALTER TABLE accounts ADD COLUMN google_sub TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS account_google_subject ON accounts(google_sub) WHERE google_sub IS NOT NULL');
}
