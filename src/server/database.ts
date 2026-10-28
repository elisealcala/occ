import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createRepositoryWithDatabase, type SyncDatabase } from './repository';

export { DatabaseError } from './repository';

export function createRepository(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const repository = createRepositoryWithDatabase(db as unknown as SyncDatabase);
  return { ...repository, close: () => db.close() };
}
export type Repository = ReturnType<typeof createRepository>;
const globalDatabase = globalThis as typeof globalThis & { occRepository?: Repository };
export function getRepository(): Repository {
  globalDatabase.occRepository ??= createRepository(
    resolve(process.env.OCC_DB_PATH ?? '.data/occ.sqlite'),
  );
  return globalDatabase.occRepository;
}
