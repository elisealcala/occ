import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SEED_CONTENT, type Checkpoint, type DocumentSnapshot, type ExperimentConfig, type ExperimentView, type Mutation, type MutationResult, type RichNode, type ServerEvent } from '../lib/contracts';

export class DatabaseError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
type DocumentRow = { id: string; content: string; revision: number; client_id: DocumentSnapshot['clientId']; mutation_id: string | null; updated_at: number; occ: number; checkpoints: number };
const snapshot = (row: DocumentRow): DocumentSnapshot => ({ experimentId: row.id, content: JSON.parse(row.content), revision: row.revision, clientId: row.client_id, mutationId: row.mutation_id, updatedAt: row.updated_at });

export function createRepository(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
      client_id TEXT NOT NULL, mutation_id TEXT, updated_at INTEGER NOT NULL,
      occ INTEGER NOT NULL, checkpoints INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT, experiment_id TEXT NOT NULL REFERENCES experiments(id),
      content TEXT NOT NULL, revision INTEGER NOT NULL, client_id TEXT NOT NULL,
      reason TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, experiment_id TEXT NOT NULL REFERENCES experiments(id),
      client_id TEXT NOT NULL, mutation_id TEXT NOT NULL, expected_revision INTEGER NOT NULL,
      revision INTEGER NOT NULL, outcome TEXT NOT NULL, operation TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      experiment_id TEXT NOT NULL REFERENCES experiments(id), mutation_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (experiment_id, mutation_id)
    );
    CREATE INDEX IF NOT EXISTS checkpoints_experiment ON checkpoints(experiment_id, id);
    CREATE INDEX IF NOT EXISTS events_experiment ON events(experiment_id, id);
  `);
  function row(id: string): DocumentRow {
    const result = db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as DocumentRow | undefined;
    if (!result) throw new DatabaseError('Experiment not found', 404);
    return result;
  }
  function view(id: string): ExperimentView {
    return db.transaction(() => {
      const current = row(id);
      const checkpoints = db.prepare('SELECT id, content, revision, client_id AS clientId, reason, created_at AS createdAt FROM checkpoints WHERE experiment_id = ? ORDER BY id DESC').all(id) as (Omit<Checkpoint, 'content'> & { content: string })[];
      const events = db.prepare('SELECT id, client_id AS clientId, mutation_id AS mutationId, expected_revision AS expectedRevision, revision, outcome, operation, created_at AS createdAt FROM events WHERE experiment_id = ? ORDER BY id DESC LIMIT 150').all(id) as ServerEvent[];
      return { config: { occEnabled: !!current.occ, checkpointsEnabled: !!current.checkpoints }, document: snapshot(current), checkpoints: checkpoints.map(checkpoint => ({ ...checkpoint, content: JSON.parse(checkpoint.content) as RichNode })), events };
    })();
  }
  function create(config: ExperimentConfig): ExperimentView {
    const id = randomUUID();
    db.prepare('INSERT INTO experiments (id, content, revision, client_id, updated_at, occ, checkpoints) VALUES (?, ?, 1, ?, ?, ?, ?)')
      .run(id, JSON.stringify(SEED_CONTENT), 'seed', Date.now(), Number(config.occEnabled), Number(config.checkpointsEnabled));
    return view(id);
  }
  function mutate(id: string, input: Mutation): MutationResult {
    // Immediate transactions serialize the read/checkpoint/CAS/receipt sequence
    // across connections. The UPDATE still enforces the expected revision itself.
    return db.transaction((): MutationResult => {
      const current = row(id);
      const { requestDelayMs: _requestDelay, responseDelayMs: _responseDelay, ...intent } = input;
      void _requestDelay; void _responseDelay;
      const fingerprint = JSON.stringify(intent);
      const receipt = db.prepare('SELECT fingerprint, result FROM receipts WHERE experiment_id = ? AND mutation_id = ?').get(id, input.mutationId) as { fingerprint: string; result: string } | undefined;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new DatabaseError('Mutation ID was already used for different content', 400);
        return JSON.parse(receipt.result) as MutationResult;
      }
      const operation = input.restoreCheckpointId !== undefined ? 'restore' : 'save';
      let content = input.content;
      if (input.restoreCheckpointId !== undefined) {
        const checkpoint = db.prepare('SELECT content FROM checkpoints WHERE id = ? AND experiment_id = ?').get(input.restoreCheckpointId, id) as { content: string } | undefined;
        if (!checkpoint) throw new DatabaseError('Checkpoint not found in this experiment', 404);
        content = JSON.parse(checkpoint.content) as RichNode;
      }
      if (!content) throw new DatabaseError('Missing content', 400);
      const now = Date.now();
      let result: MutationResult;
      let outcome: ServerEvent['outcome'];
      if (current.occ && current.revision !== input.expectedRevision) {
        result = { ok: false, reason: 'conflict', document: snapshot(current) };
        outcome = 'conflict';
      } else {
        if (current.checkpoints && (input.checkpoint || operation === 'restore')) {
          db.prepare('INSERT INTO checkpoints (experiment_id, content, revision, client_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, current.content, current.revision, input.clientId, operation === 'restore' ? 'restore' : 'burst', now);
        }
        const updated = db.prepare(`UPDATE experiments SET content = ?, revision = revision + 1, client_id = ?, mutation_id = ?, updated_at = ?
          WHERE id = ? AND (occ = 0 OR revision = ?) RETURNING *`)
          .get(JSON.stringify(content), input.clientId, input.mutationId, now, id, input.expectedRevision) as DocumentRow | undefined;
        if (!updated) throw new Error('Revision changed inside an immediate transaction');
        result = { ok: true, document: snapshot(updated) };
        outcome = current.revision === input.expectedRevision ? 'accepted' : 'overwritten';
      }
      db.prepare('INSERT INTO events (experiment_id, client_id, mutation_id, expected_revision, revision, outcome, operation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.clientId, input.mutationId, input.expectedRevision, result.document.revision, outcome, operation, now);
      db.prepare('INSERT INTO receipts (experiment_id, mutation_id, fingerprint, result) VALUES (?, ?, ?, ?)')
        .run(id, input.mutationId, fingerprint, JSON.stringify(result));
      return result;
    }).immediate();
  }
  return { create, view, mutate, close: () => db.close() };
}
export type Repository = ReturnType<typeof createRepository>;
const globalDatabase = globalThis as typeof globalThis & { occRepository?: Repository };
export function getRepository(): Repository {
  return globalDatabase.occRepository ??= createRepository(resolve(process.env.OCC_DB_PATH ?? '.data/occ.sqlite'));
}
