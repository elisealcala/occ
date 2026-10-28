import { DurableObject } from 'cloudflare:workers';
import type { ExperimentConfig, Mutation } from '../src/lib/contracts';
import {
  createRepositoryWithDatabase,
  DatabaseError,
  type SyncDatabase,
} from '../src/server/repository';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type Bindings = (string | number | null)[];

export class Experiment extends DurableObject {
  private repository = createRepositoryWithDatabase(this.database());

  private database(): SyncDatabase {
    const sql = this.ctx.storage.sql;
    return {
      exec: (query) => {
        for (const statement of query.split(';')) if (statement.trim()) sql.exec(statement);
      },
      prepare: (query) => ({
        run: (...params: Bindings) => {
          sql.exec(query, ...params).toArray();
        },
        get: (...params: Bindings) => sql.exec(query, ...params).toArray()[0],
        all: (...params: Bindings) => sql.exec(query, ...params).toArray(),
      }),
      transaction: <T>(fn: () => T) => {
        const run = () => this.ctx.storage.transactionSync(fn);
        return Object.assign(run, { immediate: run });
      },
    };
  }

  private async current(id: string) {
    const view = this.repository.view(id);
    if (Date.now() >= view.document.updatedAt + RETENTION_MS) {
      await this.clear();
      throw new DatabaseError('Experiment not found', 404);
    }
    return view;
  }

  private async clear() {
    await this.ctx.storage.deleteAll();
    this.repository = createRepositoryWithDatabase(this.database());
  }

  private async result<T>(
    operation: () => Promise<T>,
  ): Promise<{ value: T } | { error: string; status: number }> {
    try {
      return { value: await operation() };
    } catch (error) {
      if (error instanceof DatabaseError) return { error: error.message, status: error.status };
      throw error;
    }
  }

  async create(id: string, config: ExperimentConfig) {
    return this.result(async () => {
      const view = this.repository.create(config, id);
      await this.ctx.storage.setAlarm(view.document.updatedAt + RETENTION_MS);
      return view;
    });
  }

  async view(id: string) {
    return this.result(() => this.current(id));
  }

  async mutate(id: string, input: Mutation) {
    return this.result(async () => {
      await this.current(id);
      const result = this.repository.mutate(id, input);
      if (result.ok) await this.ctx.storage.setAlarm(result.document.updatedAt + RETENTION_MS);
      return result;
    });
  }

  async alarm() {
    const row = this.ctx.storage.sql
      .exec<{ updated_at: number }>('SELECT updated_at FROM experiments LIMIT 1')
      .toArray()[0];
    if (!row) return;
    const expires = row.updated_at + RETENTION_MS;
    if (Date.now() >= expires) await this.clear();
    else await this.ctx.storage.setAlarm(expires);
  }
}
