import { mutationSchema } from '@/lib/contracts';
import { getRepository } from '@/server/database';
import { checkOrigin, delay, errorResponse, json, readBody } from '@/server/http';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const input = mutationSchema.parse(await readBody(request));
    const { id } = await context.params;
    await delay(input.requestDelayMs);
    const result = getRepository().mutate(id, input);
    await delay(input.responseDelayMs);
    return json(result, result.ok ? 200 : 409);
  } catch (error) { return errorResponse(error); }
}
