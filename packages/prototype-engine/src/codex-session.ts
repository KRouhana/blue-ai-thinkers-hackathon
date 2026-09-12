import { Codex } from '@openai/codex-sdk';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cleanEnv, profileOverride } from './runtime.js';
import { safeText, type RunnerRequest, type RunnerMessage } from './types.js';

const controller = new AbortController();
const send = (message: RunnerMessage) => { if (process.connected) process.send?.(message); };
process.on('message', async (input: RunnerRequest | { cancel: true }) => {
  if ('cancel' in input) { controller.abort(); return; }
  try {
    // Keep user credentials in Codex's own home. Ignore inherited tools, rules, and user configuration.
    const wrapper = path.join(input.runtimePath, 'codex-entry');
    await writeFile(wrapper, `#!${process.execPath}\nimport{spawn}from'node:child_process';\nconst args=process.argv.slice(2);if(args[0]==='exec')args.splice(1,0,'--ignore-user-config','--ignore-rules');const child=spawn(${JSON.stringify(input.codexPath)},args,{stdio:'inherit'});process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('error',()=>process.exit(1));child.on('exit',(code)=>process.exit(code??1));\n`, { mode: 0o700 });
    const cliEnv = { ...cleanEnv(input.runtimePath), HOME: os.homedir(), CODEX_HOME: input.codexHome };
    const codex = new Codex({
      codexPathOverride: wrapper,
      env: cliEnv,
      config: {
        default_permissions: 'fork_worker',
        permissions: { fork_worker: { network: { enabled: false } } },
        shell_environment_policy: { inherit: 'none', set: cleanEnv(path.join(input.sourcePath, '.fork-cache')) },
        features: { multi_agent: false },
      },
      configOverrides: [profileOverride(input.sourcePath, input.readablePaths)],
    });
    const options = { workingDirectory: input.sourcePath, skipGitRepoCheck: true, approvalPolicy: 'never' as const, webSearchMode: 'disabled' as const, model: input.model, modelReasoningEffort: 'low' as const };
    const thread = input.threadId ? codex.resumeThread(input.threadId, options) : codex.startThread(options);
    const { events } = await thread.runStreamed(input.prompt, { signal: controller.signal });
    let completed = false;
    for await (const event of events) {
      if (event.type === 'turn.failed') throw new Error(event.error.message);
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'turn.completed') completed = true;
      // Never send reasoning, raw MCP payloads, or credentials into the meeting activity feed.
      if (event.type.startsWith('item.') && 'item' in event && !['command_execution', 'file_change', 'agent_message', 'error'].includes(event.item.type)) continue;
      send({ kind: 'event', event });
    }
    if (!completed || controller.signal.aborted) throw new Error('Worker turn did not complete.');
    send({ kind: 'done', threadId: thread.id ?? undefined });
  } catch (e) { send({ kind: 'error', message: safeText(String(e)) }); }
  finally { process.disconnect?.(); }
});
process.on('disconnect', () => {
  controller.abort();
  // Detached group belongs to this runner, including Codex and any background shell descendants.
  setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); } }, 1000).unref();
});
