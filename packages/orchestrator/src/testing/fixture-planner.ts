import type { PlannerOutput } from '../planner/output-schema';
import type { Planner, PlanningContext } from '../planner/planner';

const NO_ENTRY: PlannerOutput = {
  kind: 'observe',
  summary: 'FIXTURE: no scripted output',
  reason: 'the fixture planner has no entry for this turn',
  currentTopic: null,
  resolvesClarification: false,
  patch: null,
  targetEvidence: null,
  clarify: null,
  prototype: null,
  undoExperimentId: null,
};

/**
 * FIXTURE planner: replays canned outputs keyed by the newest new turn's observation id.
 * It detects nothing. It exists so the pipeline can be verified without a model, and it
 * is labelled everywhere so a fixture run is never mistaken for a live one.
 */
export class FixturePlanner implements Planner {
  readonly label = 'fixture' as const;

  constructor(private readonly table: ReadonlyMap<string, PlannerOutput>) {}

  async plan(context: PlanningContext): Promise<PlannerOutput> {
    const key = context.newTurns.at(-1)?.id;
    return (key ? this.table.get(key) : undefined) ?? NO_ENTRY;
  }
}
