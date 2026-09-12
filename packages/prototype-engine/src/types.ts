import type { PreparedWorkspace, PrototypeJob, PrototypeResult, Revision, WorkerProgress, PreviewPatch, SourceRef } from '../../../contracts.v2.js';
export type { PrototypeEngine, PrepareRequest, PreparedWorkspace, PatchRequest, PatchResult, PrototypeJob, PrototypeResult, Revision, WorkerProgress, RepoMap, PreviewPatch } from '../../../contracts.v2.js';

export interface ProjectConfig {
  id: string;
  /** Host configuration only. Never accept a path from meeting text or browser requests. */
  sourcePath?: string;
  /** Existing projects must already have compatible dependencies installed. No install scripts run. */
  dependencyPath?: string;
  route?: string;
  registeredElements?: Record<string, { sourcePath: string; properties: Array<'size' | 'background' | 'label' | 'radius' | 'visible'> }>;
}
export interface EngineOptions {
  runtimeRoot: string;
  projects: ProjectConfig[];
  hostOrigin: string;
  codexPath?: string;
  codexHome?: string;
  model?: string;
  browserExecutable?: string;
  /** A's bundled, browser-safe collector module. Host-configured; never a meeting-supplied path. */
  collectorScriptPath?: string;
  jobTimeoutMs?: number;
  renderTimeoutMs?: number;
  /** B can fence obsolete attempts before C declares success. B still owns scheduling. */
  isCurrent?: (job: PrototypeJob) => boolean | Promise<boolean>;
  onEvent?: (event: EngineEvent) => void;
}
export interface EngineEvent {
  workspaceId: string;
  operationId: string;
  sequence: number;
  at: string;
  kind: 'phase' | 'command' | 'output' | 'files' | 'preview' | 'error';
  message: string;
  state?: WorkerProgress['state'];
  files?: string[];
  revision?: Revision;
}
export interface WorkspaceDetails extends PreparedWorkspace {
  /** Private local path, for the host only. Do not put it in iframe messages. */
  sourcePath: string;
  startupCommand: string;
  lastCheckpointId: string | null;
  blocked: string | null;
  check: PrototypeResult['check'];
  registeredElements: Array<{ id: string; editable: string[]; source: SourceRef }>;
}
export interface PreviewMetadata {
  workspaceId: string;
  revision: Revision;
  operationId: string;
  instanceId: string;
  hostOrigin: string;
}
export interface FileEntry { hash: string; mode: number; }
export type Manifest = Record<string, FileEntry>;
export interface WorkspaceState {
  id: string;
  sessionId: string;
  project: ProjectConfig;
  mode: 'blank_template' | 'existing_repo';
  revision: Revision;
  manifest: Manifest;
  fingerprint: string;
  lastCheckpointId: string | null;
  blocked: string | null;
  pending: { id: string; checkpointId: string; kind: string } | null;
  threadId?: string;
  operations: Record<string, { digest: string; result: unknown }>;
}
export interface RunnerRequest {
  sourcePath: string;
  codexPath: string;
  codexHome: string;
  runtimePath: string;
  readablePaths: string[];
  model?: string;
  threadId?: string;
  prompt: string;
}
export interface RunnerMessage { kind: 'event' | 'done' | 'error'; event?: unknown; threadId?: string; message?: string; }
export interface BrowserEvidence { compile: 'passed' | 'failed'; page: 'rendered' | 'failed'; diagnostics: string[]; }
export function error(code: string, message: string): Error & { code: string } { return Object.assign(new Error(`${code}: ${message}`), { code }); }
export function sameRevision(a: Revision, b: Revision): boolean { return a.source === b.source && a.config === b.config; }
export function safeText(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+|\bsk-[A-Za-z0-9._-]{20,}/gi, '[redacted]')
    .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\/Users\/[^/\s]+/g, '~').slice(0, 4000);
}
export function validatePatch(patch: PreviewPatch): void {
  const allowed: Record<string, readonly unknown[]> = {
    set_size: ['sm', 'md', 'lg', 'xl'], set_background: ['neutral', 'blue', 'red', 'green', 'amber'],
    set_radius: ['none', 'sm', 'md', 'pill'], set_visibility: [true, false],
  };
  if (!patch || typeof patch.elementId !== 'string' || !/^[\w-]{1,80}$/.test(patch.elementId)) throw error('INVALID_PATCH', 'Invalid element ID.');
  if (patch.kind === 'set_label') {
    if (typeof patch.value !== 'string' || patch.value.length > 200 || /[\x00-\x1f]/.test(patch.value)) throw error('INVALID_PATCH', 'Label must be plain text up to 200 characters.');
  } else if (!allowed[patch.kind]?.includes(patch.value)) throw error('INVALID_PATCH', 'Unsupported patch value.');
}
export function verifySourceRef(ref: SourceRef): boolean { return ref.kind === 'repo' && typeof ref.path === 'string' && typeof ref.fingerprint === 'string'; }
