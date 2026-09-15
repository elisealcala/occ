import { experimentConfigSchema } from '@/lib/contracts';
import { getRepository } from '@/server/database';
import { checkOrigin, errorResponse, json, readBody } from '@/server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    return json(getRepository().create(experimentConfigSchema.parse(await readBody(request))), 201);
  } catch (error) { return errorResponse(error); }
}
