import { useState, type ReactNode } from 'react';
import { primaryAction, secondaryAction, type ActionDef } from '../lib/actions';
import { toast, toastError, useApp } from '../lib/app';
import { basename } from '../lib/detect';
import { folderPath } from '../lib/folders';
import { copyText, pickFile } from '../lib/platform';
import { TYPE_LABEL, type Item } from '../lib/types';
import { ConfirmButton, Modal, ParamForm, TypeBadge, timeAgo } from './common';

export function ItemDetail({
  item,
  missing,
  onEdit,
  onDeleted,
}: {
  item: Item;
  missing: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const app = useApp();
  const [showSecret, setShowSecret] = useState(false);
  const [pending, setPending] = useState<ActionDef | null>(null);
  const prim = primaryAction(item);
  const sec = secondaryAction(item);
  const m = item.meta;

  const run = async (a: ActionDef | null, filled?: string) => {
    if (!a) return;
    if (a.needsParams && filled === undefined) {
      setPending(a);
      return;
    }
    try {
      const msg = await a.run(item, app.settings, filled);
      setPending(null);
      toast(msg);
      await app.markUsed(item.id);
    } catch (e) {
      toastError(e);
    }
  };

  const copy = async (text: string, msg = '已复制') => {
    try {
      await copyText(text);
      toast(msg);
    } catch (e) {
      toastError(e);
    }
  };

  const relocate = async () => {
    const p = await pickFile({ directory: !!m.isDir });
    if (!p) return;
    if (item.type === 'file') await app.saveItem({ ...item, content: p });
    else await app.saveItem({ ...item, meta: { ...m, installerPath: p } });
    toast('路径已更新');
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <TypeBadge type={item.type} />
        <div className="grow">
          <h2 className="detail-title">{item.title}</h2>
          <div className="detail-meta">
            {TYPE_LABEL[item.type]}
            {item.folderId && <> · {folderPath(app.folders, item.folderId)}</>}
            {item.tags.map((t) => (
              <span key={t} className="tag small">
                #{t}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        {prim && (
          <button className="btn primary" onClick={() => run(prim)}>
            {prim.label}
          </button>
        )}
        {sec && (
          <button className="btn" onClick={() => run(sec)}>
            {sec.label}
          </button>
        )}
        {item.type !== 'text' && item.type !== 'command' && item.content && (
          <button className="btn" onClick={() => copy(item.content)}>
            复制{item.type === 'software' ? '说明' : item.type === 'link' ? '' : '路径'}
          </button>
        )}
        <span className="grow" />
        <button className="btn" onClick={() => app.saveItem({ ...item, pinned: !item.pinned })}>
          {item.pinned ? '取消置顶' : '置顶'}
        </button>
        <button className="btn" onClick={onEdit}>
          编辑
        </button>
        <ConfirmButton
          onConfirm={async () => {
            await app.deleteItem(item.id);
            toast('已删除');
            onDeleted();
          }}
        >
          删除
        </ConfirmButton>
      </div>

      {missing && (
        <div className="warn">
          {item.type === 'file' ? '文件' : '安装包'}不存在或已被移动。
          <button className="link-btn" onClick={relocate}>
            重新定位
          </button>
        </div>
      )}

      {item.type === 'software' ? (
        <div className="kv">
          {item.content && <Kv k="说明" v={<div className="pre-wrap">{item.content}</div>} />}
          {m.website && (
            <Kv
              k="官网"
              v={
                <span className="row gap-s">
                  <span className="mono ellipsis">{m.website}</span>
                  <button className="link-btn" onClick={() => copy(m.website!)}>
                    复制
                  </button>
                </span>
              }
            />
          )}
          {m.version && <Kv k="版本" v={m.version} />}
          {m.installerPath && (
            <Kv
              k="安装包"
              v={
                <span className="row gap-s">
                  <span className="mono ellipsis" title={m.installerPath}>
                    {m.installerPath}
                  </span>
                  <button className="link-btn" onClick={() => copy(m.installerPath!)}>
                    复制
                  </button>
                </span>
              }
            />
          )}
          {m.secret && (
            <Kv
              k="敏感信息"
              v={
                <span className="row gap-s">
                  <span className="mono">{showSecret ? m.secret : '••••••••••'}</span>
                  <button className="link-btn" onClick={() => setShowSecret((v) => !v)}>
                    {showSecret ? '隐藏' : '显示'}
                  </button>
                  <button className="link-btn" onClick={() => copy(m.secret!, '已复制敏感信息')}>
                    复制
                  </button>
                </span>
              }
            />
          )}
        </div>
      ) : (
        <div className="detail-body">
          <pre className={'content-box' + (item.type === 'text' ? ' prose' : ' mono')}>
            {item.content}
          </pre>
          {(item.type === 'command' || item.type === 'text') && (
            <button className="copy-float" onClick={() => copy(item.content)} title="复制全部">
              复制
            </button>
          )}
          {item.type === 'file' && <div className="muted small">文件名：{basename(item.content)}</div>}
          {m.notes && (
            <div className="notes">
              <div className="notes-title">备注</div>
              <div className="pre-wrap">{m.notes}</div>
            </div>
          )}
        </div>
      )}

      <div className="detail-stats">
        使用 {item.useCount} 次 · 上次使用 {timeAgo(item.lastUsedAt)} · 更新于 {timeAgo(item.updatedAt)} · 创建于{' '}
        {timeAgo(item.createdAt)}
      </div>

      {pending && (
        <Modal title={`${item.title} · 填写参数`} onClose={() => setPending(null)}>
          <ParamForm
            template={item.content}
            confirmLabel={pending.label}
            onCancel={() => setPending(null)}
            onDone={(filled) => run(pending, filled)}
          />
        </Modal>
      )}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv-row">
      <div className="kv-k">{k}</div>
      <div className="kv-v">{v}</div>
    </div>
  );
}
