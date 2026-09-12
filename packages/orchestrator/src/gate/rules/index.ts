import type { Rule } from '../gate';
import { candidatesValid } from './candidates-valid';
import { dedupe } from './dedupe';
import { operationPermitted } from './operation-permitted';
import { pathsAllowed } from './paths-allowed';
import { revisionMatch } from './revision-match';
import { sessionEnabled } from './session-enabled';
import { sizeBounds } from './size-bounds';
import { sourcesFinalized } from './sources-finalized';
import { targetValid } from './target-valid';
import { undoApplicable } from './undo-applicable';

/** Order matters: authority, then evidence, then target, then bounds, then freshness. */
export const RULES: readonly Rule[] = [
  sessionEnabled,
  sourcesFinalized,
  targetValid,
  operationPermitted,
  pathsAllowed,
  sizeBounds,
  dedupe,
  revisionMatch,
  undoApplicable,
  candidatesValid,
];

export {
  candidatesValid, dedupe, operationPermitted, pathsAllowed, revisionMatch,
  sessionEnabled, sizeBounds, sourcesFinalized, targetValid, undoApplicable,
};
