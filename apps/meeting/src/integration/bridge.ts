import { z } from 'zod';
import type { Revision } from './types';
// Envelope shape matches C's actual preview runtime (apps/preview/src/bridge.js,
// apps/preview/src/host.ts): context/rendered/error fields are nested under `payload`,
// alongside `version`, `operationId`, and `instanceId`. D flattens `payload` back out
// below so the rest of D's code can keep working with a flat shape.
const revision = z.object({ source: z.number().int().nonnegative(), config: z.number().int().nonnegative() });
const base = { version: z.literal(1), workspaceId: z.string().max(200), revision, operationId: z.string().max(128), instanceId: z.string().max(128) };
const element = z.object({ id: z.string().max(200), role: z.string().max(100), label: z.string().max(500), section: z.string().max(200).optional(), visible: z.boolean(), box: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative() }), editable: z.array(z.enum(['size','background','label','radius','visible'])).max(5) });
const contextPayload = z.object({ route: z.string().max(1000), viewport: z.object({ width: z.number().positive(), height: z.number().positive() }), elements: z.array(element).max(200), focusId: z.string().nullable(), hover: z.object({ elementId: z.string(), at: z.string() }).nullable(), selection: z.object({ elementId: z.string(), at: z.string() }).nullable() });
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fork.preview.rendered'), ...base, payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('fork.preview.error'), ...base, payload: z.object({ message: z.string().max(1000) }) }),
  z.object({ type: z.literal('fork.preview.context'), ...base, payload: contextPayload }),
]);
export function previewUrl(value: string | null, allowedOrigin: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && url.origin === allowedOrigin && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function decodePreview(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, frame: MessageEventSource | null, origin: string, workspaceId: string | null, expected: Revision) {
  if (!frame || event.source !== frame || event.origin !== origin) return null;
  try { if (typeof event.data !== 'object' || event.data === null || JSON.stringify(event.data).length > 64_000) return null; } catch { return null; }
  const result = schema.safeParse(event.data);
  if (!result.success) return null;
  const data = result.data;
  if (data.workspaceId !== workspaceId || data.revision.source !== expected.source || data.revision.config !== expected.config) return null;
  if (data.type === 'fork.preview.rendered') return { type: data.type, workspaceId: data.workspaceId, revision: data.revision };
  if (data.type === 'fork.preview.error') return { type: data.type, workspaceId: data.workspaceId, revision: data.revision, message: data.payload.message };
  return { type: data.type, workspaceId: data.workspaceId, revision: data.revision, ...data.payload };
}
