import { useEffect, useMemo, useRef, useState } from 'react';
import { aiReady, suggestTitleAndTags } from '../lib/ai';
import { toast, toastError, useApp } from '../lib/app';
import { autoTitle, basename } from '../lib/detect';
import { buildTree, flattenTree } from '../lib/folders';
import { parseParams } from '../lib/params';
import { httpFetch, pickFile } from '../lib/platform';
import { ITEM_TYPES, TYPE_LABEL, type Item, type ItemType } from '../lib/types';
import { TagInput, TypeBadge } from './common';
import { MarkdownField } from './rich';
import { LANGS, detectLang } from '../lib/codelang';
import { PRIORITY_LABEL, REMIND_OPTIONS, fromLocalInput, toLocalInput } from '../lib/todo';

const CONTENT_LABEL: Record<ItemType, string> = {
  command: '命令',
  text: '内容',
  link: '网址',
  software: '说明 / 用途',
  file: '文件路径',
  todo: '子任务 / 备注',
};

const CONTENT_PLACEHOLDER: Record<ItemType, string> = {
  command: '例如：docker logs -f --tail 200 {{容器名}}',
  text: '任意文本、笔记、配置片段……',
  link: 'https://',
  software: '这个软件是干什么的、怎么配置……',
  file: 'D:\\docs\\周报模板.docx',
  todo: '- [ ] 第一步\n- [ ] 第二步\n\n其他备注……',
};

export function ItemEditor({
  initial,
  onSave,
  onCancel,
  compact = false,
  autoFocus = true,
}: {
  initial: Item;
  onSave: (item: Item) => Promise<void> | void;
  onCancel: () => void;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const { folders, allTags, settings } = useApp();
  const [it, setIt] = useState<Item>(initial);
  const [showSecret, setShowSecret] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleTouched = useRef(!!initial.title);
  const firstRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    setIt(initial);
    titleTouched.current = !!initial.title;
  }, [initial]);

  useEffect(() => {
    if (autoFocus) setTimeout(() => firstRef.current?.focus(), 30);
  }, [autoFocus, initial.id]);

  const folderOptions = useMemo(() => flattenTree(buildTree(folders)), [folders]);

  const set = (patch: Partial<Item>) => setIt((cur) => ({ ...cur, ...patch }));
  const setMeta = (patch: Partial<Item['meta']>) => setIt((cur) => ({ ...cur, meta: { ...cur.meta, ...patch } }));

  const setContent = (content: string) => {
    setIt((cur) => {
      const next = { ...cur, content };
      if (!titleTouched.current && cur.type !== 'todo') next.title = autoTitle(content, cur.type);
      return next;
    });
  };

  const submit = async () => {
    if (it.type === 'todo' && !it.title.trim()) {
      toast('请填写待办事项', 'error');
      return;
    }
    const title = it.title.trim() || autoTitle(it.content, it.type) || (it.type === 'software' ? '未命名软件' : '');
    if (!title && !it.content.trim()) {
      toast('内容不能为空', 'error');
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...it, title: title || '(无标题)' });
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const runAi = async () => {
    setAiBusy(true);
    try {
      const text = [it.title, it.content, it.meta.notes, it.meta.website].filter(Boolean).join('\n');
      const r = await suggestTitleAndTags(settings, it.type, text, allTags, httpFetch);
      titleTouched.current = true;
      setIt((cur) => ({
        ...cur,
        title: r.title || cur.title,
        tags: [...new Set([...cur.tags, ...r.tags])],
      }));
    } catch (e) {
      toastError(e);
    } finally {
      setAiBusy(false);
    }
  };

  const browse = async (dir: boolean, target: 'content' | 'installer') => {
    const p = await pickFile({ directory: dir });
    if (!p) return;
    if (target === 'content') {
      setContent(p);
      if (!titleTouched.current) set({ title: basename(p) });
      setMeta({ isDir: dir });
    } else setMeta({ installerPath: p });
  };

  const params = it.type === 'command' ? parseParams(it.content) : [];

  return (
    <form
      className={'editor' + (compact ? ' compact' : '')}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="type-switch" role="tablist">
        {ITEM_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={it.type === t}
            className={it.type === t ? 'on' : ''}
            onClick={() => set({ type: t })}
          >
            <TypeBadge type={t} size="sm" /> {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {it.type === 'todo' && (
        <>
          <label className="field">
            <span>待办事项</span>
            <input
              ref={(el) => {
                firstRef.current = el;
              }}
              className="todo-title-input"
              value={it.title}
              placeholder="要做什么？"
              onChange={(e) => {
                titleTouched.current = true;
                set({ title: e.target.value });
              }}
            />
          </label>
          <div className="row gap todo-fields">
            <label className="field">
              <span>截止时间</span>
              <div className="row gap-s">
                <input
                  type="datetime-local"
                  value={toLocalInput(it.meta.due)}
                  onChange={(e) => {
                    const due = fromLocalInput(e.target.value);
                    setMeta({ due, notifiedAt: null, snoozeUntil: null, remindBefore: due && it.meta.remindBefore === undefined ? 0 : it.meta.remindBefore });
                  }}
                />
                {it.meta.due && (
                  <button type="button" className="btn small" onClick={() => setMeta({ due: null, notifiedAt: null })}>
                    清除
                  </button>
                )}
              </div>
            </label>
            <label className="field">
              <span>优先级</span>
              <select value={it.meta.priority ?? ''} onChange={(e) => setMeta({ priority: (e.target.value || undefined) as Item['meta']['priority'] })}>
                <option value="">无</option>
                {(['high', 'mid', 'low'] as const).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>提醒</span>
              <select
                disabled={!it.meta.due}
                value={it.meta.remindBefore === null || it.meta.remindBefore === undefined ? '' : String(it.meta.remindBefore)}
                onChange={(e) => setMeta({ remindBefore: e.target.value === '' ? null : Number(e.target.value), notifiedAt: null })}
              >
                {REMIND_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value === null ? '' : String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}

      {(it.type === 'text' || it.type === 'software' || it.type === 'todo') && (
        <div className="field">
          <span>{CONTENT_LABEL[it.type]}</span>
          <MarkdownField
            inputRef={
              it.type === 'todo'
                ? undefined
                : (el) => {
                    firstRef.current = el;
                  }
            }
            rows={it.type === 'text' ? (compact ? 6 : 10) : it.type === 'todo' ? 5 : 3}
            value={it.content}
            placeholder={CONTENT_PLACEHOLDER[it.type]}
            onChange={setContent}
          />
        </div>
      )}

      {it.type !== 'text' && it.type !== 'software' && it.type !== 'todo' && (
      <label className="field">
        <span>{CONTENT_LABEL[it.type]}</span>
        {it.type === 'command' ? (
          <textarea
            ref={(el) => {
              firstRef.current = el;
            }}
            className="mono"
            rows={4}
            value={it.content}
            placeholder={CONTENT_PLACEHOLDER[it.type]}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className="row">
            <input
              ref={(el) => {
                firstRef.current = el;
              }}
              className="mono grow"
              value={it.content}
              placeholder={CONTENT_PLACEHOLDER[it.type]}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
            />
            {it.type === 'file' && (
              <>
                <button type="button" className="btn" onClick={() => browse(false, 'content')}>
                  选文件
                </button>
                <button type="button" className="btn" onClick={() => browse(true, 'content')}>
                  选文件夹
                </button>
              </>
            )}
          </div>
        )}
        {it.type === 'command' && (
          <small className="hint">
            {params.length
              ? `参数：${params.map((p) => p.name + (p.defaultValue ? `=${p.defaultValue}` : '')).join('，')}（使用时填写）`
              : '可用 {{参数}} 或 {{参数:默认值}} 做占位，使用时再填'}
          </small>
        )}
      </label>
      )}

      {it.type === 'command' && (
        <label className="field lang-field">
          <span>高亮语言</span>
          <select value={it.meta.lang ?? ''} onChange={(e) => setMeta({ lang: e.target.value || undefined })}>
            <option value="">自动（{LANGS.find((l) => l.id === detectLang(it.content))?.label}）</option>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="row gap">
        {it.type !== 'todo' && (
        <label className="field grow">
          <span>标题</span>
          <input
            value={it.title}
            placeholder="留空则自动生成"
            onChange={(e) => {
              titleTouched.current = true;
              set({ title: e.target.value });
            }}
          />
        </label>
        )}
        <label className={'field folder-field' + (it.type === 'todo' ? ' grow' : '')}>
          <span>文件夹</span>
          <select value={it.folderId ?? ''} onChange={(e) => set({ folderId: e.target.value || null })}>
            <option value="">未分类</option>
            {folderOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {'\u3000'.repeat(f.depth) + f.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {it.type === 'software' && (
        <>
          <div className="row gap">
            <label className="field grow">
              <span>官网 / 下载地址</span>
              <input value={it.meta.website ?? ''} placeholder="https://" onChange={(e) => setMeta({ website: e.target.value })} />
            </label>
            <label className="field" style={{ width: 130 }}>
              <span>版本</span>
              <input value={it.meta.version ?? ''} onChange={(e) => setMeta({ version: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>安装包位置</span>
            <div className="row">
              <input
                className="mono grow"
                value={it.meta.installerPath ?? ''}
                placeholder="D:\\soft\\xxx-setup.exe"
                onChange={(e) => setMeta({ installerPath: e.target.value })}
              />
              <button type="button" className="btn" onClick={() => browse(false, 'installer')}>
                选择
              </button>
            </div>
          </label>
          <label className="field">
            <span>注册码 / 账号等敏感信息</span>
            <div className="row">
              <input
                className="mono grow"
                type={showSecret ? 'text' : 'password'}
                autoComplete="off"
                value={it.meta.secret ?? ''}
                onChange={(e) => setMeta({ secret: e.target.value })}
              />
              <button type="button" className="btn" onClick={() => setShowSecret((v) => !v)}>
                {showSecret ? '隐藏' : '显示'}
              </button>
            </div>
          </label>
        </>
      )}

      {(it.type === 'link' || it.type === 'file') && (
        <div className="field">
          <span>备注</span>
          <MarkdownField rows={2} value={it.meta.notes ?? ''} onChange={(notes) => setMeta({ notes })} />
        </div>
      )}

      <label className="field">
        <span>标签</span>
        <TagInput value={it.tags} onChange={(tags) => set({ tags })} suggestions={allTags} />
      </label>

      <div className="row between editor-foot">
        <div className="row gap">
          <label className="check">
            <input type="checkbox" checked={it.pinned} onChange={(e) => set({ pinned: e.target.checked })} /> 置顶
          </label>
          {it.type === 'todo' && (
            <label className="check">
              <input
                type="checkbox"
                checked={!!it.meta.done}
                onChange={(e) => setMeta({ done: e.target.checked, doneAt: e.target.checked ? Date.now() : null })}
              />{' '}
              已完成
            </label>
          )}
        </div>
        <div className="row gap-s">
          {aiReady(settings) && (
            <button type="button" className="btn" disabled={aiBusy} onClick={runAi}>
              {aiBusy ? 'AI 思考中…' : 'AI 生成标题/标签'}
            </button>
          )}
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            保存 <span className="muted-key">Ctrl+Enter</span>
          </button>
        </div>
      </div>
    </form>
  );
}
