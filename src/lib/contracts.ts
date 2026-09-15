import { z } from 'zod';

export type RichNode = {
  type: string;
  text?: string;
  attrs?: { level?: number; start?: number; type?: string | null; language?: string | null };
  marks?: { type: 'bold' | 'italic' | 'strike' | 'code' | 'underline' }[];
  content?: RichNode[];
};

const nodeSchema: z.ZodType<RichNode> = z.lazy(() => z.object({
  type: z.enum(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak']),
  text: z.string().optional(),
  attrs: z.object({ level: z.number().int().min(1).max(6).optional(), start: z.number().int().min(1).optional(), type: z.enum(['1', 'a', 'A', 'i', 'I']).nullable().optional(), language: z.string().max(40).nullable().optional() }).strict().optional(),
  marks: z.array(z.object({ type: z.enum(['bold', 'italic', 'strike', 'code', 'underline']) }).strict()).max(5).optional(),
  content: z.array(nodeSchema).optional(),
}).strict());

// Bound recursion before the recursive schema runs, including for API callers.
function bounded(value: unknown, depth = 0, budget = { remaining: 3000 }): boolean {
  if (depth > 30 || --budget.remaining < 0 || !value || typeof value !== 'object') return false;
  const content = (value as { content?: unknown }).content;
  return content === undefined || (Array.isArray(content) && content.every(child => bounded(child, depth + 1, budget)));
}
function validStructure(node: RichNode): boolean {
  const children = node.content ?? [];
  const inline = (child: RichNode) => child.type === 'text' || child.type === 'hardBreak';
  const block = (child: RichNode) => ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule'].includes(child.type);
  if (node.type === 'text') return typeof node.text === 'string' && node.text.length > 0 && node.content === undefined && node.attrs === undefined;
  if (node.text !== undefined || node.marks !== undefined) return false;
  if (!children.every(validStructure)) return false;
  switch (node.type) {
    case 'doc': return children.length > 0 && children.every(block) && !node.attrs;
    case 'paragraph': return children.every(inline) && !node.attrs;
    case 'heading': return children.every(inline) && typeof node.attrs?.level === 'number' && Object.keys(node.attrs).every(key => key === 'level');
    case 'bulletList': return children.length > 0 && children.every(child => child.type === 'listItem') && !node.attrs;
    case 'orderedList': return children.length > 0 && children.every(child => child.type === 'listItem') && (!node.attrs || Object.keys(node.attrs).every(key => key === 'start' || key === 'type'));
    case 'listItem': return children[0]?.type === 'paragraph' && children.every(block) && !node.attrs;
    case 'blockquote': return children.length > 0 && children.every(block) && !node.attrs;
    case 'codeBlock': return children.every(child => child.type === 'text' && !child.marks?.length) && (!node.attrs || Object.keys(node.attrs).every(key => key === 'language'));
    case 'horizontalRule': case 'hardBreak': return children.length === 0 && !node.attrs;
    default: return false;
  }
}
export const contentSchema = z.unknown()
  .refine(value => bounded(value), 'Document is too deeply nested or too large')
  .pipe(nodeSchema)
  .refine(node => node.type === 'doc' && Array.isArray(node.content), 'Expected a document')
  .refine(validStructure, 'Invalid rich-text document structure')
  .refine(node => JSON.stringify(node).length <= 100_000, 'Document exceeds 100 KB');

export const experimentConfigSchema = z.object({
  occEnabled: z.boolean().default(true),
  checkpointsEnabled: z.boolean().default(true),
}).strict();
export type ExperimentConfig = z.infer<typeof experimentConfigSchema>;
export const mutationSchema = z.object({
  clientId: z.enum(['A', 'B', 'external']),
  mutationId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  content: contentSchema.optional(),
  restoreCheckpointId: z.number().int().positive().optional(),
  checkpoint: z.boolean().default(false),
  requestDelayMs: z.number().int().min(0).max(5000).default(0),
  responseDelayMs: z.number().int().min(0).max(5000).default(0),
}).strict().refine(input => (input.content !== undefined) !== (input.restoreCheckpointId !== undefined), 'Supply content or a restore checkpoint');
export type Mutation = z.infer<typeof mutationSchema>;
export type ClientId = Mutation['clientId'];
export type DocumentSnapshot = {
  experimentId: string;
  content: RichNode;
  revision: number;
  clientId: ClientId | 'seed';
  mutationId: string | null;
  updatedAt: number;
};
export type Checkpoint = { id: number; revision: number; content: RichNode; createdAt: number; clientId: ClientId; reason: 'burst' | 'restore' };
export type ServerEvent = {
  id: number;
  clientId: ClientId;
  mutationId: string;
  expectedRevision: number;
  revision: number;
  outcome: 'accepted' | 'conflict' | 'overwritten';
  operation: 'save' | 'restore';
  createdAt: number;
};
export type ExperimentView = { config: ExperimentConfig; document: DocumentSnapshot; checkpoints: Checkpoint[]; events: ServerEvent[] };
export type MutationResult = { ok: true; document: DocumentSnapshot } | { ok: false; reason: 'conflict'; document: DocumentSnapshot };

export function textDocument(text: string): RichNode {
  return { type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] };
}
export const SEED_CONTENT: RichNode = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A shared starting point' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Two clients. One document. What happens when they both save?' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Edit this text, or run an experiment below. Watch the revision travel from your editor to the database.' }] },
  ],
};
export const sameContent = (a: RichNode, b: RichNode) => JSON.stringify(a) === JSON.stringify(b);
export function plainText(node: RichNode): string {
  return node.text ?? (node.content ?? []).map(plainText).join(['doc', 'bulletList', 'orderedList'].includes(node.type) ? '\n' : '');
}
