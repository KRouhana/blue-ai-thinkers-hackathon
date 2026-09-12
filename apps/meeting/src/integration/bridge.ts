import { z } from 'zod';
import type { Revision } from './types';
const revision = z.object({ source: z.number().int().nonnegative(), config: z.number().int().nonnegative() });
const base = { workspaceId: z.string().max(200), revision };
const element = z.object({ id: z.string().max(200), role: z.string().max(100), label: z.string().max(500), section: z.string().max(200).optional(), visible: z.boolean(), box: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative() }), editable: z.array(z.enum(['size','background','label','radius','visible'])).max(5) });
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fork.preview.rendered'), ...base }),
  z.object({ type: z.literal('fork.preview.error'), ...base, message: z.string().max(1000) }),
  z.object({ type: z.literal('fork.preview.context'), ...base, route: z.string().max(1000), viewport: z.object({ width: z.number().positive(), height: z.number().positive() }), elements: z.array(element).max(200), focusId: z.string().nullable(), hover: z.object({ elementId: z.string(), at: z.string() }).nullable(), selection: z.object({ elementId: z.string(), at: z.string() }).nullable() }),
]);
export function previewUrl(value: string | null, allowedOrigin: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && url.origin === allowedOrigin && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function decodePreview(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, frame: MessageEventSource | null, origin: string, workspaceId: string | null, expected: Revision) {
  if (!frame || event.source !== frame || event.origin !== origin) return null;
  const result = schema.safeParse(event.data);
  if (!result.success) return null;
  const data = result.data;
  if (data.workspaceId !== workspaceId || data.revision.source !== expected.source || data.revision.config !== expected.config) return null;
  return data;
}
