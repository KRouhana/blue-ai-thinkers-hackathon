// Minimal live-demo bridge: public sample preview + signed Recall audio → OpenRouter transcription.
// The control API and credentials stay on loopback. Start before the tunnel;
// then run this script with join, the public URL, and meeting URL.
import { createServer, request } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { verifyRecallSignature, extractRecallPcm16 } from '@fork/perception/node';
const { sessionId } = JSON.parse(await readFile('.data/local-session.json', 'utf8'));
const headers = { Authorization: `Bearer ${process.env.FORK_API_TOKEN}`, 'Content-Type': 'application/json' };
async function api(path, body) {
  const r = await fetch(`${process.env.FORK_API_BASE}/api/sessions/${sessionId}${path}`, { headers, ...(body ? {method:'POST',body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(15000) });
  const j = await r.json(); if (!r.ok || !j.ok) throw new Error(`Control API ${r.status}`); return j.data;
}
let { snapshot } = await api('');
if(snapshot.capture !== 'listening' || !snapshot.prototypeAutonomyEnabled) ({snapshot} = await api('/capture', {action:'start',prototypeAutonomyEnabled:true}));
const captureEpoch = snapshot.captureEpoch;
let botId;
const recallBase = `https://${process.env.RECALL_REGION || 'us-west-2'}.recall.ai/api/v1`;
async function recall(path, body) {
  const r = await fetch(recallBase+path, {headers:{Authorization:`Token ${process.env.RECALL_API_KEY}`,'Content-Type':'application/json'}, ...(body ? {method:'POST',body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(30000)});
  if (!r.ok) throw new Error(`Recall ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
// Joining is a local CLI action, never a public HTTP route.
if(process.argv[2] === 'join') {
  const publicUrl = process.argv[3], meetingUrl = process.argv[4];
  if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(publicUrl) || !/^https:\/\/meet\.google\.com\/[a-z-]+$/.test(meetingUrl)) throw new Error('Expected public tunnel and Google Meet URLs');
  const bot = await recall('/bot/', {meeting_url:meetingUrl,bot_name:'Fork — live prototype',output_media:{camera:{kind:'webpage',config:{url:publicUrl+'/presenter'}}},recording_config:{retention:null,video_mixed_mp4:null,audio_mixed_raw:{},realtime_endpoints:[{type:'websocket',url:publicUrl.replace('https:','wss:')+'/recall/audio/',events:['audio_mixed_raw.data']}]}});
  await writeFile('.data/meet-bot.json',JSON.stringify({id:bot.id,sessionId,publicUrl}),{mode:0o600});
  console.log('Bot created:',bot.id); process.exit(0);
}
const sockets = new WebSocketServer({noServer:true,maxPayload:1024*1024});
let chain = Promise.resolve(), pending = 0, sequence = 0;
let chunks = [], samples = 0, silence = 0, hasSpeech = false, capturedAt = null;
function flush() {
  const pcm=Buffer.concat(chunks), startedAt=capturedAt, voiced=hasSpeech;
  chunks=[];samples=0;silence=0;hasSpeech=false;capturedAt=null;
  if(!voiced || !pcm.length)return;
  if(pending>=4){console.error('Transcription overloaded: audio segment dropped');return;}
  const seq=++sequence;pending++;
  chain=chain.then(async()=>{
    const {snapshot: current} = await api('');
    if(current.capture !== 'listening' || (current.resumedAt && Date.parse(startedAt)<Date.parse(current.resumedAt)))return;
    const captureEpoch = current.captureEpoch;
    const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
    const r=await fetch('https://openrouter.ai/api/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENROUTER_TRANSCRIPTION_MODEL || 'openai/gpt-transcribe',input_audio:{data:Buffer.concat([header,pcm]).toString('base64'),format:'wav'},language:'en'}),signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error(`OpenRouter transcription HTTP ${r.status}`);
    const result=await r.json(), text=result.text?.trim();if(!text)return;
    const id=createHash('sha256').update(`${sessionId}:${startedAt}:${seq}`).digest('hex');
    const accepted=await api('/observations',{observations:[{id,sessionId,captureEpoch,capturedAt:startedAt,version:1,kind:'transcript',phase:'final',providerItemId:id,audioTurnSequence:seq,orderReliable:true,streamId:'recall-openrouter',text,speaker:{label:null,verified:false}}]});
    console.log(`OpenRouter transcript → planner: accepted ${accepted.accepted}`);
  }).catch(e=>console.error('Transcription failed:',e.message)).finally(()=>pending--);
}
sockets.on('connection', ws => {
  console.log('Recall audio connected: signature verified');
  ws.on('error',()=>console.error('Recall socket error'));
  ws.on('close',()=>flush());
  ws.on('message', (raw,binary) => {
    if(binary)return;
    try {
      const event=JSON.parse(raw.toString());
      const audio=extractRecallPcm16(raw.toString());if(!audio)return;
      const stamp=event.data?.data?.timestamp?.absolute;
      if(!capturedAt)capturedAt=stamp || new Date().toISOString();
      let energy=0;for(const v of audio)energy+=v*v;
      const voiced=Math.sqrt(energy/audio.length)>220;
      if(voiced){hasSpeech=true;silence=0;}else silence+=audio.length;
      chunks.push(Buffer.from(audio.buffer,audio.byteOffset,audio.byteLength));samples+=audio.length;
      if(samples>=16000*12 || (hasSpeech && silence>=16000*0.8) || (!hasSpeech && samples>=16000*2))flush();
    }catch{console.error('Invalid Recall audio packet');}
  });
});
const server=createServer(async(req,res)=>{
  if(req.method!=='GET' || req.url?.startsWith('/recall/') || req.url?.startsWith('/api/') || req.url?.includes('__open-in-editor')){res.writeHead(404);res.end();return;}
  if(req.url==='/preview-version') {
    try { const {snapshot}=await api('');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(snapshot.revision)); }
    catch {res.writeHead(503);res.end();}return;
  }
  if(req.url==='/presenter') {res.setHeader('Content-Type','text/html');res.end('<html><body style="margin:0;background:#fff"><iframe id="p" src="/" style="border:0;width:100vw;height:100vh"></iframe><script>let revision;setInterval(async()=>{try{const r=await fetch("/preview-version",{cache:"no-store"});if(!r.ok)return;const next=JSON.stringify(await r.json());if(revision && next!==revision)document.getElementById("p").src="/?refresh="+Date.now();revision=next}catch{}},2000)</script></body></html>');return;}
  const upstream=request({hostname:'127.0.0.1',port:4173,path:req.url,method:'GET',headers:{...req.headers,host:'127.0.0.1:4173'}},r=>{
    const h={...r.headers}; delete h['content-security-policy']; // Sample page is framed by this same-origin presenter.
    h['content-security-policy']="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:4173; frame-ancestors 'self'";
    res.writeHead(r.statusCode||502,h);r.pipe(res);
  });upstream.on('error',()=>{res.writeHead(502);res.end('Preview unavailable');});upstream.end();
});
server.on('upgrade',(req,socket,head)=>{
  const stamp=Number(req.headers['webhook-timestamp']);
  if(req.url!=='/recall/audio/' || !Number.isFinite(stamp) || Math.abs(Date.now()/1000-stamp)>300 || !verifyRecallSignature({secret:process.env.RECALL_WORKSPACE_VERIFICATION_SECRET||'',headers:req.headers,payload:null})) {socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws,req));
});
server.listen(4320,'127.0.0.1',()=>console.log('Demo bridge on 127.0.0.1:4320; sample preview + signed transcription only'));
