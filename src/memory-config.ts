import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { InputError } from './common.js';

const hosts = {
  codex: { label: 'Codex', file: ['.codex', 'hooks.json'] },
  claude: { label: 'Claude Code', file: ['.claude', 'settings.local.json'] },
  agy: { label: 'Antigravity CLI', file: ['.agents', 'hooks.json'] },
} as const;

export type MemoryHost = keyof typeof hosts;
export const memoryHosts = Object.keys(hosts) as MemoryHost[];
const agyHookName = 'evolve-agent-memory';
const codexStatus = 'Extracting Agent Memory from Codex';

type JsonObject = Record<string, unknown>;
interface JsonFile { path: string; previous?: string; content: JsonObject }

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function readJson(path: string): JsonFile {
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  if (previous === undefined) return { path, content: {} };
  let content: JsonObject | undefined;
  try {
    content = object(JSON.parse(previous.replace(/^\uFEFF/, '')));
  } catch {
    throw new InputError(`Invalid JSON in ${path}`);
  }
  if (!content) throw new InputError(`Expected a JSON object in ${path}`);
  return { path, previous, content };
}

function replaceJson({ path, previous, content }: JsonFile) {
  const result = JSON.stringify(content, null, 2) + '\n';
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, result, { flag: 'wx' });
    if ((existsSync(path) ? readFileSync(path, 'utf8') : undefined) !== previous) {
      throw new InputError(`Configuration changed while saving ${path}`);
    }
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function quoteCommand(args: string[]): string {
  if (process.platform === 'win32') {
    return '& ' + args.map(arg => `'${arg.replaceAll("'", "''")}'`).join(' ');
  }
  return args.map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}

const agyWindowsHook = ' memory host-hook --host agy';

function agyWindowsCommand(entry: string, root: string) {
  // Agy 在 Windows 启动 Hook 时直接保留 Node 的标准输入，路径以 base64url 跨过宿主命令解析。
  const script = "const entry = Buffer.from(process.argv[1], 'base64url').toString(); " +
    "const root = Buffer.from(process.argv[2], 'base64url').toString(); " +
    "process.argv.splice(1, 2, entry); process.argv.push('--root', root); import(require('node:url').pathToFileURL(entry));";
  return `node --input-type=commonjs -e "${script}" ${Buffer.from(entry).toString('base64url')} ${Buffer.from(root).toString('base64url')}${agyWindowsHook}`;
}

function memoryHandler(host: MemoryHost, root: string) {
  const args = host === 'codex' ? ['codex-hook'] : ['host-hook', '--host', host];
  const entry = fileURLToPath(new URL('./cli.js', import.meta.url));
  const command = host === 'agy' && process.platform === 'win32' ? agyWindowsCommand(entry, root)
    : quoteCommand([process.execPath, entry, 'memory', ...args, '--root', root]);
  return { type: 'command', command, timeout: 150,
    ...(host === 'codex' ? { statusMessage: codexStatus } : {}),
    ...(host === 'claude' && process.platform === 'win32' ? { shell: 'powershell' } : {}),
  };
}

function ownsHandler(host: MemoryHost, value: unknown): boolean {
  const hook = object(value);
  if (typeof hook?.command !== 'string') return false;
  if (host === 'codex') return hook.statusMessage === codexStatus && hook.command.includes('codex-hook');
  if (host === 'agy' && hook.command.startsWith('node --input-type=commonjs -e ') && hook.command.endsWith(agyWindowsHook)) return true;
  return hook.command.includes(`'memory' 'host-hook' '--host' '${host}' '--root'`);
}

function hookFile(root: string, host: MemoryHost) {
  const file = readJson(join(root, ...hosts[host].file));
  if (host === 'agy') {
    const own = object(file.content[agyHookName]);
    if (file.content[agyHookName] !== undefined &&
        (!Array.isArray(own?.Stop) || own.Stop.length !== 1 || !ownsHandler(host, own.Stop[0]))) {
      throw new InputError(`Conflicting hook ${agyHookName} in ${file.path}`);
    }
    return { file, configured: !!own && own.enabled !== false, update(enable: boolean) {
      if (!enable && !own) return;
      const { [agyHookName]: previousHook, ...other } = file.content;
      const next = enable ? { ...own, enabled: true, Stop: [memoryHandler(host, root)] } : undefined;
      if (JSON.stringify(next) === JSON.stringify(previousHook)) return;
      return { ...file, content: next ? { ...other, [agyHookName]: next } : other };
    } };
  }
  const hooks = file.content.hooks === undefined ? {} : object(file.content.hooks);
  const stop = hooks?.Stop ?? [];
  if (!hooks || !Array.isArray(stop)) throw new InputError(`Invalid Stop hooks in ${file.path}`);
  const own = stop.flatMap(group => Array.isArray(group?.hooks) ? group.hooks.filter((hook: unknown) => ownsHandler(host, hook)) : []);
  return { file, configured: own.length > 0, update(enable: boolean) {
    if (!enable && !own.length) return;
    const entry = memoryHandler(host, root);
    if (enable && own.length === 1 && JSON.stringify(own[0]) === JSON.stringify(entry)) return;
    const otherGroups = stop.flatMap(group => {
      if (!Array.isArray(group?.hooks) || !group.hooks.some((hook: unknown) => ownsHandler(host, hook))) return [group];
      const remaining = group.hooks.filter((hook: unknown) => !ownsHandler(host, hook));
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
    const content = { ...file.content, hooks: { ...hooks, Stop: enable ? [...otherGroups, { hooks: [entry] }] : otherGroups } };
    return { ...file, content };
  } };
}

export function installCodexMemoryHook(root: string) {
  const hook = hookFile(root, 'codex');
  const updated = hook.update(true);
  if (updated) replaceJson(updated);
  return { path: hook.file.path, changed: !!updated };
}

function settingsFile(root: string) {
  return readJson(join(root, '.agent-memory', 'config.json'));
}

function setting(file: JsonFile, field: string) {
  const value = file.content[field];
  if (value !== undefined && typeof value !== 'string') throw new InputError(`Invalid ${field} in ${file.path}`);
  return value;
}

export function memoryModelSettings(root: string) {
  const { AGENT_MEMORY_LLM_BASE_URL: baseUrl, AGENT_MEMORY_LLM_MODEL: model } = process.env;
  if (baseUrl && model) return { baseUrl, model };
  const file = settingsFile(root);
  return {
    baseUrl: baseUrl || setting(file, 'baseUrl'),
    model: model || setting(file, 'model'),
  };
}

export function parseMemoryHosts(value: string, allowNone = false): MemoryHost[] {
  if (value.toLowerCase() === 'all') return memoryHosts;
  if (allowNone && value.toLowerCase() === 'off') return [];
  const selected = value.toLowerCase().split(',').map(item => item.trim());
  if (selected.some(host => !memoryHosts.includes(host as MemoryHost))) {
    throw new InputError(`Choose ${memoryHosts.join(', ')} or all${allowNone ? ' or off' : ''}`);
  }
  return memoryHosts.filter(host => selected.includes(host));
}

interface ConfigOptions { host?: string; baseUrl?: string; model?: string; yes?: boolean }

export async function configureMemory(root: string, options: ConfigOptions) {
  const file = settingsFile(root);
  const hooks = memoryHosts.map(host => ({ host, ...hookFile(root, host) }));
  const currentHosts = hooks.filter(hook => hook.configured).map(hook => hook.host);
  let selected = options.host;
  let baseUrl = options.baseUrl ?? setting(file, 'baseUrl');
  let model = options.model ?? setting(file, 'model');
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new InputError('Use an interactive terminal or pass --yes');
    const ui = createInterface({ input: process.stdin, output: process.stdout });
    try {
      process.stdout.write(`\nAgent Memory\n${root}\n\nAutomatic extraction\n`);
      for (const { host, configured } of hooks) {
        process.stdout.write(`  ${configured ? '[x]' : '[ ]'} ${host.padEnd(7)} ${hosts[host].label}\n`);
      }
      selected ??= (await ui.question('Host names, all, or off [keep current]: ')).trim() || undefined;
      if (selected !== undefined) parseMemoryHosts(selected, true);
      process.stdout.write('\nExtraction model (AGENT_MEMORY_LLM_* environment variables take precedence)\n');
      baseUrl = (await ui.question(`Base URL${baseUrl ? ` [${baseUrl}]` : ' [environment]'}: `)).trim() || baseUrl;
      model = (await ui.question(`Model${model ? ` [${model}]` : ' [environment]'}: `)).trim() || model;
      if (!/^y(?:es)?$/i.test((await ui.question('Save project settings? [y/N] ')).trim())) return { status: 'cancelled' };
    } finally {
      ui.close();
    }
  }

  if (baseUrl !== undefined) {
    if (!URL.canParse(baseUrl) || !['http:', 'https:'].includes(new URL(baseUrl).protocol)) {
      throw new InputError('Base URL must start with http:// or https://');
    }
  }
  const enabled = selected === undefined ? currentHosts : parseMemoryHosts(selected, true);
  const updates = hooks.map(hook => hook.update(enabled.includes(hook.host)));
  const content = { ...file.content, ...(baseUrl === undefined ? {} : { baseUrl }), ...(model === undefined ? {} : { model }) };
  if (JSON.stringify(content) !== JSON.stringify(file.content)) replaceJson({ ...file, content });
  for (const update of updates) if (update) replaceJson(update);
  return { status: 'configured', hosts: hooks.map(({ host, file }) => ({ host, configured: enabled.includes(host), path: file.path })),
    model_configured: !!(process.env.AGENT_MEMORY_LLM_MODEL || model) && !!(process.env.AGENT_MEMORY_LLM_BASE_URL || baseUrl),
    ...(enabled.includes('codex') ? { codex: 'Review and trust the hook in Codex with /hooks.' } : {}),
  };
}
