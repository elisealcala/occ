import handler from 'vinext/server/app-router-entry';
import { experimentConfigSchema, mutationSchema } from '../src/lib/contracts';
import { checkOrigin, delay, errorResponse, json, readBody } from '../src/server/http';
import { DatabaseError } from '../src/server/repository';
import { Experiment } from './experiment';

function unwrap<T>(result: { value: T } | { error: string; status: number }): T {
  if ('error' in result) throw new DatabaseError(result.error, result.status);
  return result.value;
}

export { Experiment };

interface Env {
  EXPERIMENTS: DurableObjectNamespace<Experiment>;
  ASSETS: Fetcher;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const match = /^\/api\/experiments\/([^/]+)(\/mutations)?$/i.exec(path);
    if (path !== '/api/experiments' && !match) return handler.fetch(request, env, ctx);
    try {
      if (path === '/api/experiments' && request.method === 'POST') {
        checkOrigin(request);
        const config = experimentConfigSchema.parse(await readBody(request));
        const id = crypto.randomUUID();
        return json(unwrap(await env.EXPERIMENTS.getByName(id).create(id, config)), 201);
      }
      if (!match) return json({ error: 'Method not allowed' }, 405);
      const [, id, mutation] = match;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        return json({ error: 'Experiment not found' }, 404);
      const object = env.EXPERIMENTS.getByName(id);
      if (!mutation && request.method === 'GET') return json(unwrap(await object.view(id)));
      if (mutation && request.method === 'POST') {
        checkOrigin(request);
        const input = mutationSchema.parse(await readBody(request));
        await delay(input.requestDelayMs);
        const result = unwrap(await object.mutate(id, input));
        await delay(input.responseDelayMs);
        return json(result, result.ok ? 200 : 409);
      }
      return json({ error: 'Method not allowed' }, 405);
    } catch (error) {
      return errorResponse(error);
    }
  },
};

export default worker;
