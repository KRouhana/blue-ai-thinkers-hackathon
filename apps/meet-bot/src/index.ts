// Joins a Google Meet call via the Recall.ai meeting-bot API and shows the Fork
// meeting workspace (apps/meeting has no dashboard, no controls — just the live
// prototype, full-bleed) as the bot's camera output. Recall's cloud infrastructure
// runs the join and renders the given webpage into the call — no local browser
// automation needed. The URL must be publicly reachable (Recall's servers fetch
// it), so a local dev server needs a tunnel (ngrok/cloudflared) in front of it.
//
// API shape verified against https://docs.recall.ai (stream-media, bot_retrieve,
// bot_leave_call_create) on 2026-09-12. Recall's dashboard/reference is the source
// of truth if this drifts.

interface Options { url: string; presenterUrl: string; name: string; region: string; }

function parseArgs(argv: string[]): Options {
  const get = (flag: string) => { const i = argv.indexOf(flag); return i === -1 ? undefined : argv[i + 1]; };
  const url = get('--url');
  const presenterUrl = get('--presenter-url');
  if (!url || !presenterUrl) {
    throw new Error('Usage: npm run meetbot -- --url https://meet.google.com/xxx-yyyy-zzz --presenter-url https://<public-tunnel>/[?session=<id>] [--name "Fork"] [--region us-east-1]');
  }
  if (!/^https:\/\//.test(presenterUrl) || presenterUrl.includes('127.0.0.1') || presenterUrl.includes('localhost')) {
    throw new Error('--presenter-url must be a public HTTPS URL. Recall\'s cloud bot cannot reach 127.0.0.1/localhost on this Mac; put a tunnel (ngrok, cloudflared) in front of the meeting dev server first.');
  }
  return { url, presenterUrl, name: get('--name') || 'Fork', region: get('--region') || process.env.RECALL_REGION || 'us-east-1' };
}

function client(region: string, apiKey: string) {
  const base = `https://${region}.recall.ai/api/v1`;
  const headers = { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' };
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    if (!response.ok) throw new Error(`Recall API ${init?.method || 'GET'} ${path} -> HTTP ${response.status}: ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  }
  return {
    createBot: (options: Options) => request('/bot/', {
      method: 'POST',
      body: JSON.stringify({
        meeting_url: options.url,
        bot_name: options.name,
        output_media: { camera: { kind: 'webpage', config: { url: options.presenterUrl } } },
      }),
    }) as Promise<{ id: string; status_changes: { code: string; created_at: string }[] }>,
    getBot: (id: string) => request(`/bot/${id}/`) as Promise<{ id: string; status_changes: { code: string; created_at: string }[] }>,
    leaveCall: (id: string) => request(`/bot/${id}/leave_call/`, { method: 'POST' }),
    setCamera: (id: string, presenterUrl: string) => request(`/bot/${id}/output_media/`, {
      method: 'POST',
      body: JSON.stringify({ camera: { kind: 'webpage', config: { url: presenterUrl } } }),
    }),
  };
}

async function main() {
  const apiKey = process.env.RECALL_API_KEY;
  if (!apiKey) throw new Error('Set RECALL_API_KEY in .env (from the Recall.ai dashboard) before running the meet bot.');
  const options = parseArgs(process.argv.slice(2));
  const recall = client(options.region, apiKey);

  console.log(`Joining ${options.url} as "${options.name}" (region ${options.region})...`);
  console.log(`Camera output: ${options.presenterUrl}`);
  const bot = await recall.createBot(options);
  console.log(`Bot created: ${bot.id}`);
  console.log('Note: some meetings still require the host to admit an unrecognized guest.');

  let lastStatus = '';
  const poll = setInterval(async () => {
    try {
      const current = await recall.getBot(bot.id);
      const status = current.status_changes.at(-1)?.code || 'unknown';
      if (status !== lastStatus) { console.log(`[${new Date().toLocaleTimeString()}] status: ${status}`); lastStatus = status; }
      if (['call_ended', 'done', 'fatal'].includes(status)) { clearInterval(poll); process.exit(status === 'fatal' ? 1 : 0); }
    } catch (error) { console.error('Status check failed:', error); }
  }, 4000);

  const leave = async () => {
    clearInterval(poll);
    console.log('\nLeaving the call...');
    try { await recall.leaveCall(bot.id); } catch (error) { console.error('leave_call failed:', error); }
    process.exit(0);
  };
  process.on('SIGINT', leave);
  process.on('SIGTERM', leave);
}

void main().catch(error => { console.error(error); process.exit(1); });
