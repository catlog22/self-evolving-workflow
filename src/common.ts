import { DatabaseSync } from 'node:sqlite';

export class InputError extends Error {}
export class NotFoundError extends Error {}

export function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InputError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function searchLimit(limit = 10): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InputError('limit must be an integer between 1 and 100');
  }
  return limit;
}

export function openDb(path: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (!readOnly) db.exec('PRAGMA journal_mode = WAL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
