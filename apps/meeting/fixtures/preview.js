// A prepared D integration fixture, never the live C prototype engine.
const parentOrigin = 'http://127.0.0.1:3000';
const workspaceId = 'fixture-workspace';
let revision = { source: 0, config: 0 };
let config = { buttonSize: 'md', buttonColor: 'blue', overdueEnabled: false };
let filtered = false, hover = null, selection = null;
const tasks = [
  { title: 'Explore the onboarding flow', column: 'To do', tag: 'Design', color: '', initials: 'AL', due: 'Overdue', overdue: true },
  { title: 'Collect early customer feedback', column: 'To do', tag: 'Research', color: 'green', initials: 'JK', due: 'Tomorrow' },
  { title: 'Map out the product experience', column: 'In progress', tag: 'Design', color: '', initials: 'MR', due: 'Today' },
  { title: 'Polish the landing page', column: 'In progress', tag: 'Product', color: 'blue', initials: 'AL', due: 'Overdue', overdue: true },
  { title: 'Set the project direction', column: 'Done', tag: 'Product', color: 'blue', initials: 'JK', due: 'Completed' },
];
const $ = id => document.getElementById(id);
function post(type, extra = {}) { if (window.parent !== window) window.parent.postMessage({ type, workspaceId, revision, ...extra }, parentOrigin); }
function context() {
  const elements = [...document.querySelectorAll('[data-preview-id]')].map(element => {
    const box = element.getBoundingClientRect();
    return { id: element.dataset.previewId, role: 'button', label: element.textContent.trim(), section: 'Team board', visible: !element.hidden && box.width > 0 && box.height > 0, box: { x: box.x, y: box.y, width: box.width, height: box.height }, editable: ['size', 'background', 'label', 'radius', 'visible'] };
  });
  post('fork.preview.context', { route: '/', viewport: { width: Math.max(1, innerWidth), height: Math.max(1, innerHeight) }, elements, focusId: document.activeElement?.dataset?.previewId || null, hover, selection });
}
function render() {
  $('trial').style.padding = config.buttonSize === 'xl' ? '17px 25px' : '10px 16px';
  $('trial').style.background = config.buttonColor === 'red' ? '#cc646c' : '#5a6bd7';
  $('overdue').hidden = !config.overdueEnabled;
  if (!config.overdueEnabled) filtered = false;
  $('all').classList.toggle('selected', !filtered);
  $('overdue').classList.toggle('selected', filtered);
  const visible = tasks.filter(task => !filtered || task.overdue);
  $('count').textContent = `${visible.length} mock tasks`;
  $('board').replaceChildren(...['To do', 'In progress', 'Done'].map(column => {
    const section = document.createElement('section'); section.className = 'column';
    const heading = document.createElement('h2'); heading.textContent = column; section.append(heading);
    const items = visible.filter(task => task.column === column);
    for (const task of items) {
      const card = document.createElement('article'); card.className = 'task';
      const tag = document.createElement('span'); tag.className = `tag ${task.color}`; tag.textContent = task.tag;
      const title = document.createElement('h3'); title.textContent = task.title;
      const meta = document.createElement('div'); meta.className = 'meta';
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = task.initials;
      const due = document.createElement('span'); due.className = task.overdue ? 'overdue' : ''; due.textContent = task.due;
      meta.append(avatar, due); card.append(tag, title, meta); section.append(card);
    }
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No matching tasks'; section.append(empty); }
    return section;
  }));
  requestAnimationFrame(() => { post('fork.preview.rendered'); context(); });
}
function validRevision(value) { return value && Number.isSafeInteger(value.source) && value.source >= 0 && Number.isSafeInteger(value.config) && value.config >= 0; }
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  const data = event.data;
  if (!data || data.type !== 'fork.preview.load-config' || data.workspaceId !== workspaceId || !validRevision(data.revision)) return;
  if (data.revision.source < revision.source || (data.revision.source === revision.source && data.revision.config < revision.config)) return;
  const next = data.config;
  if (!next || !['md', 'xl'].includes(next.buttonSize) || !['blue', 'red'].includes(next.buttonColor) || typeof next.overdueEnabled !== 'boolean') return;
  revision = { source: data.revision.source, config: data.revision.config };
  config = { buttonSize: next.buttonSize, buttonColor: next.buttonColor, overdueEnabled: next.overdueEnabled };
  render();
});
$('all').addEventListener('click', () => { filtered = false; render(); });
$('overdue').addEventListener('click', () => { filtered = true; render(); });
$('trial').addEventListener('click', () => { $('notice').textContent = 'Mock trial started. This fixture does not create an account or contact a service.'; });
$('invite').addEventListener('click', () => { $('notice').textContent = 'Mock invitation preview. No invitation or message was sent.'; });
document.addEventListener('pointerover', event => { const elementId = event.target.closest?.('[data-preview-id]')?.dataset.previewId; if (elementId) { hover = { elementId, at: new Date().toISOString() }; context(); } });
document.addEventListener('click', event => { const elementId = event.target.closest?.('[data-preview-id]')?.dataset.previewId; if (elementId) { selection = { elementId, at: new Date().toISOString() }; context(); } });
document.addEventListener('focusin', context);
window.addEventListener('resize', context);
render();
