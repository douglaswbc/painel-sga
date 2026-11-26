import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { loadEnv } from '../config/env.js';
import { hashPassword } from '../utils/crypto.js';
import { initialSchemaSql } from './migrations/001_initial_schema.js';
import { applyMetaWebhookCredentialsMigration } from './migrations/002_meta_webhook_credentials.js';

type Migration = {
  id: string;
  sql?: string;
  up?: (db: DatabaseSync) => void;
};

const MIGRATIONS: Migration[] = [
  { id: '001_initial_schema', sql: initialSchemaSql },
  { id: '002_meta_webhook_credentials', up: applyMetaWebhookCredentialsMigration },
];

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const env = loadEnv();
  fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

  const db = new DatabaseSync(env.databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');

  runMigrations(db);
  dbInstance = db;
  return db;
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const selectApplied = db.prepare('SELECT 1 FROM _migrations WHERE id = ?');
  const insertApplied = db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    const alreadyApplied = selectApplied.get(migration.id);
    if (alreadyApplied) continue;

    db.exec('BEGIN');
    try {
      if (migration.sql) {
        db.exec(migration.sql);
      }
      if (migration.up) {
        migration.up(db);
      }
      insertApplied.run(migration.id, new Date().toISOString());
      db.exec('COMMIT');
      console.log(`[db] Migration aplicada: ${migration.id}`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function withTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function bootstrapAdmin(): Promise<void> {
  const db = getDb();
  const env = loadEnv();

  const existingCount = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get() as { total: number };
  if (existingCount.total > 0) return;

  const { email, password, name } = env.bootstrapAdmin;
  if (!email || !password) {
    console.warn(
      '[auth] Nenhum usuário encontrado no banco e ADMIN_EMAIL/ADMIN_PASSWORD não configurados no .env.',
    );
    return;
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  db.prepare(`
    INSERT INTO usuarios (id, email, nome_completo, password_hash, role, ativo)
    VALUES (?, ?, ?, ?, 'admin', 1)
  `).run(id, email.toLowerCase(), name, passwordHash);

  console.log(`[auth] Administrador inicial criado: ${email.toLowerCase()}`);
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
