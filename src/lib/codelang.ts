/**
 * Languages offered for highlighting, and auto-detection for command items. Pure.
 * The ids must match the highlight.js grammars registered in highlight.ts.
 */

export interface LangDef {
  id: string;
  label: string;
}

export const LANGS: LangDef[] = [
  { id: 'bash', label: 'Shell (bash)' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'dos', label: 'CMD / 批处理' },
  { id: 'sql', label: 'SQL' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'xml', label: 'XML / HTML' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'nginx', label: 'Nginx' },
  { id: 'ini', label: 'INI / TOML / properties' },
  { id: 'go', label: 'Go' },
  { id: 'plaintext', label: '纯文本（不高亮）' },
];

const IDS = new Set(LANGS.map((l) => l.id));

const ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  cmd: 'dos',
  bat: 'dos',
  batch: 'dos',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  yml: 'yaml',
  html: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  toml: 'ini',
  properties: 'ini',
  conf: 'ini',
  golang: 'go',
  docker: 'dockerfile',
  text: 'plaintext',
  txt: 'plaintext',
  mysql: 'sql',
  postgresql: 'sql',
  pgsql: 'sql',
};

/** Normalise a fence label (```Bash, ```ps1 ...) to a registered id, or null if unknown / absent. */
export function normalizeLang(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim().toLowerCase().split(/\s+/)[0];
  if (!s) return null;
  if (IDS.has(s)) return s;
  return ALIASES[s] ?? null;
}

const PS_RE = /(^|\n)\s*(\$\w+\s*=|(Get|Set|New|Remove|Start|Stop|Invoke|Test|Import|Export|Select|Where|ForEach|Write|Out|Restart|Add)-[A-Z]\w+)/;
const SQL_RE = /^\s*(select|insert|update|delete|create|alter|drop|show|desc|explain|with|truncate|grant)\s/i;
const CMD_WORDS = /^\s*(@?echo\s+off|dir|findstr|setx?|robocopy|xcopy|copy|del|ren|move|taskkill|tasklist|ipconfig|netstat|tracert|nslookup|reg|sc|net|where|start|cls|type|attrib|icacls|mklink|chcp|wmic|shutdown|systeminfo)\b/i;

/** Guess the language of a command item. Defaults to bash. */
export function detectLang(command: string): string {
  const t = command.trim();
  if (!t) return 'bash';
  const first = t.split(/\r?\n/)[0].replace(/^[$#>]\s*/, '');
  if (PS_RE.test(t)) return 'powershell';
  if (SQL_RE.test(first)) return 'sql';
  if (/%[A-Za-z_][\w]*%/.test(t) || /\|\s*findstr\b/i.test(t) || CMD_WORDS.test(first)) return 'dos';
  return 'bash';
}

/** The language to use for a command: explicit choice wins, otherwise detected. */
export function commandLang(command: string, chosen?: string): string {
  return (chosen && IDS.has(chosen) && chosen) || detectLang(command);
}
