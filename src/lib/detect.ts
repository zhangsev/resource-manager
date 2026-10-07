import type { ItemType } from './types';

/** Guess the item type from pasted / clipboard text. Pure, unit tested. */

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const WIN_PATH_RE = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\)[^<>"|?*\n]*$/;
const UNIX_PATH_RE = /^(?:~|\/)[^\s<>"|*\n]*$/;

const CMD_WORDS = new Set([
  'git', 'docker', 'docker-compose', 'kubectl', 'helm', 'npm', 'npx', 'pnpm', 'yarn', 'node',
  'pip', 'pip3', 'python', 'python3', 'conda', 'java', 'javac', 'mvn', 'gradle', 'go', 'cargo',
  'cd', 'ls', 'dir', 'cp', 'mv', 'rm', 'mkdir', 'cat', 'grep', 'find', 'tail', 'head', 'chmod',
  'chown', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'rsync', 'curl', 'wget', 'ping', 'telnet',
  'netstat', 'ipconfig', 'ifconfig', 'nslookup', 'tracert', 'traceroute', 'sudo', 'systemctl',
  'service', 'journalctl', 'ps', 'kill', 'taskkill', 'tasklist', 'top', 'df', 'du', 'free',
  'echo', 'set', 'export', 'setx', 'where', 'which', 'winget', 'choco', 'scoop', 'powershell',
  'pwsh', 'cmd', 'reg', 'sc', 'net', 'robocopy', 'xcopy', 'certutil', 'openssl', 'mysql',
  'psql', 'redis-cli', 'mongo', 'mongosh', 'nginx', 'jar', 'jps', 'jstack', 'jmap',
  'vim', 'code', 'apt', 'apt-get', 'yum', 'dnf', 'brew', 'awk', 'sed', 'xargs', 'nohup',
  'crontab', 'firewall-cmd', 'iptables', 'mount', 'umount', 'ln', 'touch', 'wsl', 'adb',
]);

const SQL_RE = /^\s*(select|insert|update|delete|create|alter|drop|show|desc|explain)\s/i;
const PS_RE = /^\s*(Get|Set|New|Remove|Start|Stop|Invoke|Test)-[A-Z]\w+/;

export function looksLikeCommand(text: string): boolean {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0 || lines.length > 15) return false;
  const first = lines[0].trim().replace(/^[$#>]\s*/, '');
  const word = first.split(/\s+/)[0].toLowerCase();
  if (CMD_WORDS.has(word)) return true;
  if (SQL_RE.test(first) || PS_RE.test(first)) return true;
  if (/^\.{0,2}[\\/][\w.\-\\/]+\.(sh|bat|cmd|ps1|py|exe)\b/.test(first)) return true;
  if (lines.length <= 3 && /\s--?[a-zA-Z]/.test(first) && !/[。，！？]/.test(first)) return true;
  return false;
}

export function detectType(text: string): ItemType {
  const t = text.trim();
  if (!t) return 'text';
  const single = !/\r?\n/.test(t);
  if (single && URL_RE.test(t)) return 'link';
  if (single && (WIN_PATH_RE.test(t) || UNIX_PATH_RE.test(t)) && !t.includes('  ')) return 'file';
  if (looksLikeCommand(t)) return 'command';
  return 'text';
}

export function basename(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

export function autoTitle(text: string, type: ItemType): string {
  const t = text.trim();
  if (!t) return '';
  if (type === 'link') {
    try {
      const u = new URL(/^www\./i.test(t) ? 'http://' + t : t);
      const path = u.pathname === '/' ? '' : u.pathname;
      return clip(u.hostname.replace(/^www\./, '') + path, 60);
    } catch {
      return clip(t, 60);
    }
  }
  if (type === 'file') return basename(t) || t;
  const firstLine = t.split(/\r?\n/)[0].trim().replace(/^[$#>]\s*/, '');
  return clip(firstLine, 48);
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const SOFTWARE_EXT = /\.(exe|msi|lnk|appx|msix)$/i;
const ARCHIVE_EXT = /\.(zip|7z|rar)$/i;

/** Decide what a dropped path should become. */
export function typeForDroppedPath(path: string, isDir: boolean): ItemType {
  if (isDir) return 'file';
  if (SOFTWARE_EXT.test(path)) return 'software';
  if (ARCHIVE_EXT.test(path) && /setup|install|portable|安装/i.test(basename(path))) return 'software';
  return 'file';
}
