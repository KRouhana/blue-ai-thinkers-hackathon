import type { PreviewElement, RepoMap } from '@fork/contracts';

const button = (id: string, label: string, x: number): PreviewElement => ({
  id, role: 'button', label, section: 'Signup', visible: true,
  box: { x, y: 500, width: 150, height: 40 }, editable: ['size', 'background', 'label', 'radius'],
});

const taskTable: PreviewElement = {
  id: 'task-table', role: 'table', label: 'Sample tasks', section: 'Workspace', visible: true,
  box: { x: 40, y: 120, width: 1200, height: 500 }, editable: [],
};

/** Synthetic registry for the labeled fake engine. No real files exist behind these paths. */
export const DEMO_WORKSPACE = {
  workspaceId: 'demo-1',
  previewUrl: 'http://localhost:4173',
  routes: {
    '/signup': [button('start-trial', 'Start trial', 440), button('explore-sample', 'Explore sample', 620)],
    '/tasks': [taskTable, { ...button('add-task', 'Add task', 40), section: 'Workspace' }],
    '/': [],
  } as Record<string, PreviewElement[]>,
  repoMap: {
    workspaceId: 'demo-1',
    origin: 'existing_repo',
    fingerprint: 'fixture-sha-0000',
    framework: { name: 'react-vite (FIXTURE)', verified: false },
    routes: [
      { route: '/signup', sources: [{ kind: 'repo', path: 'src/pages/Signup.tsx', fingerprint: 'fixture' }] },
      { route: '/tasks', sources: [{ kind: 'repo', path: 'src/pages/Tasks.tsx', fingerprint: 'fixture' }] },
    ],
    relevantSources: [],
    mockCapabilities: ['synthetic task records with due dates', 'client-side filters'],
    limitations: ['FIXTURE engine: no real files are edited; results are simulated for pipeline verification'],
  } satisfies RepoMap,
};
