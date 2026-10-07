import { useState } from 'react';
import { toast, toastError, useApp } from '../lib/app';
import { fmtDate, mergeImport, parseImport, stamp, toExportJson, toMarkdown } from '../lib/exporter';
import { isTauri, joinPath, openPath, pickFile, pickSavePath, readTextFile, writeTextFile } from '../lib/platform';
import { backupNow } from '../lib/services';
import type { Settings } from '../lib/types';
import { Modal } from './common';

type Tab = 'general' | 'clip' | 'data' | 'ai';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [s, setS] = useState<Settings>(app.settings);
  const [tab, setTab] = useState<Tab>('general');
  const [mdSecrets, setMdSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Settings>) => setS((cur) => ({ ...cur, ...p }));

  const save = async () => {
    try {
      await app.updateSettings({
        ...s,
        clipMaxCount: clampInt(s.clipMaxCount, 10, 5000, 200),
        clipMaxDays: clampInt(s.clipMaxDays, 1, 365, 7),
        backupKeep: clampInt(s.backupKeep, 1, 365, 14),
        // not editable here; don't clobber values changed elsewhere meanwhile
        lastBackupAt: app.settings.lastBackupAt,
        seeded: app.settings.seeded,
      });
      toast('设置已保存');
      onClose();
    } catch (e) {
      toastError(e);
    }
  };

  const doExport = async (kind: 'json' | 'md') => {
    try {
      const name = `resmanager-${stamp()}.${kind}`;
      const def = app.paths && isTauri ? joinPath(app.paths.exports, name) : name;
      const path = await pickSavePath(def, kind);
      if (!path) return;
      const text = kind === 'json' ? toExportJson(app.items, app.folders) : toMarkdown(app.items, app.folders, mdSecrets);
      await writeTextFile(path, text);
      toast(`已导出 ${app.items.length} 条`);
    } catch (e) {
      toastError(e);
    }
  };

  const doImport = async () => {
    try {
      const path = await pickFile({ filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!path) return;
      setBusy(true);
      const data = parseImport(await readTextFile(path));
      const r = mergeImport({ items: app.items, folders: app.folders }, data);
      for (const f of r.folders) await app.store!.saveFolder(f);
      await app.store!.saveItems(r.items);
      await app.updateSettings({}); // triggers reload + broadcast
      toast(`导入完成：新增 ${r.added} 条，更新 ${r.updated} 条`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const doBackup = async () => {
    try {
      setBusy(true);
      const file = await backupNow(app);
      toast('已备份到 ' + file);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="设置"
      width={640}
      onClose={onClose}
      footer={
        <div className="row end gap-s">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </div>
      }
    >
      <div className="tabs">
        {(
          [
            ['general', '常规'],
            ['clip', '剪贴板'],
            ['data', '数据与备份'],
            ['ai', 'AI（可选）'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="form-grid">
          <label className="field">
            <span>呼出搜索快捷键</span>
            <input value={s.hotkeyLauncher} onChange={(e) => set({ hotkeyLauncher: e.target.value })} />
          </label>
          <label className="field">
            <span>快速添加快捷键</span>
            <input value={s.hotkeyQuickAdd} onChange={(e) => set({ hotkeyQuickAdd: e.target.value })} />
          </label>
          <small className="hint span2">
            格式如 Alt+Space、Ctrl+Shift+K、Alt+Q。留空表示不启用。注册失败通常是被其他软件占用。
          </small>
          <label className="field">
            <span>命令执行使用的终端</span>
            <select value={s.terminal} onChange={(e) => set({ terminal: e.target.value as Settings['terminal'] })}>
              <option value="cmd">命令提示符 (cmd)</option>
              <option value="powershell">PowerShell</option>
            </select>
          </label>
          <label className="field">
            <span>主题</span>
            <select value={s.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </div>
      )}

      {tab === 'clip' && (
        <div className="form-grid">
          <label className="check span2">
            <input type="checkbox" checked={s.clipEnabled} onChange={(e) => set({ clipEnabled: e.target.checked })} />
            记录剪贴板历史（只保存在本机数据目录，临时保留）
          </label>
          <label className="field">
            <span>最多保留条数</span>
            <input type="number" value={s.clipMaxCount} onChange={(e) => set({ clipMaxCount: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>最多保留天数</span>
            <input type="number" value={s.clipMaxDays} onChange={(e) => set({ clipMaxDays: Number(e.target.value) })} />
          </label>
          <label className="field span2">
            <span>忽略规则（每行一个正则，匹配的内容不记录）</span>
            <textarea
              className="mono"
              rows={4}
              value={s.clipIgnorePatterns}
              placeholder={'例如：\n^sk-[A-Za-z0-9]+\ninternal\\.company\\.com'}
              onChange={(e) => set({ clipIgnorePatterns: e.target.value })}
            />
          </label>
          <small className="hint span2">
            形似密码的内容（12 位以上、同时含大小写字母、数字和符号、无空格）会自动跳过。
          </small>
          <div className="span2">
            <button className="btn danger" onClick={() => app.clearClips().then(() => toast('已清空剪贴板历史'))}>
              清空剪贴板历史（{app.clips.length} 条）
            </button>
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="form-grid">
          <div className="field span2">
            <span>数据目录</span>
            <div className="row gap-s">
              <code className="grow ellipsis">{app.paths?.data ?? '-'}</code>
              {isTauri && app.paths && (
                <button className="btn" onClick={() => openPath(app.paths!.base).catch(toastError)}>
                  打开
                </button>
              )}
            </div>
            {app.paths && !app.paths.portable && isTauri && (
              <small className="hint warn-text">
                程序所在目录不可写，数据已改存到用户目录。把程序放到可写的文件夹（如 D:\tools\ResManager）可恢复便携模式。
              </small>
            )}
          </div>
          <label className="field">
            <span>自动备份保留份数（每天一次）</span>
            <input type="number" value={s.backupKeep} onChange={(e) => set({ backupKeep: Number(e.target.value) })} />
          </label>
          <div className="field">
            <span>上次备份：{app.settings.lastBackupAt ? fmtDate(app.settings.lastBackupAt) : '从未'}</span>
            <button className="btn" disabled={busy || !isTauri} onClick={doBackup}>
              立即备份
            </button>
          </div>
          <div className="field span2">
            <span>导出 / 导入</span>
            <div className="row gap-s wrap">
              <button className="btn" onClick={() => doExport('json')}>
                导出 JSON（完整，可再导入）
              </button>
              <button className="btn" onClick={() => doExport('md')}>
                导出 Markdown（便于阅读）
              </button>
              <button className="btn" disabled={busy || !isTauri} onClick={doImport}>
                从 JSON 导入
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={mdSecrets} onChange={(e) => setMdSecrets(e.target.checked)} />
              Markdown 中包含注册码等敏感信息
            </label>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="form-grid">
          <label className="check span2">
            <input type="checkbox" checked={s.aiEnabled} onChange={(e) => set({ aiEnabled: e.target.checked })} />
            启用 AI 生成标题和标签（编辑条目时出现按钮，只在点击时发送该条内容）
          </label>
          <label className="field span2">
            <span>接口地址（OpenAI 兼容）</span>
            <input value={s.aiBaseUrl} onChange={(e) => set({ aiBaseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
          </label>
          <label className="field">
            <span>API Key</span>
            <input type="password" autoComplete="off" value={s.aiApiKey} onChange={(e) => set({ aiApiKey: e.target.value })} />
          </label>
          <label className="field">
            <span>模型</span>
            <input value={s.aiModel} onChange={(e) => set({ aiModel: e.target.value })} />
          </label>
          <small className="hint span2">
            可用 OpenAI、DeepSeek（https://api.deepseek.com/v1）、通义千问兼容模式、本地 Ollama（http://localhost:11434/v1）等。Key
            保存在本机数据库中。公司电脑请先确认是否允许把内容发送到外部服务。
          </small>
        </div>
      )}
    </Modal>
  );
}

function clampInt(v: number, min: number, max: number, def: number): number {
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
}
