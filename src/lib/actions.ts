import { parseParams } from './params';
import { copyText, openPath, openUrl, revealPath, runInTerminal } from './platform';
import { setDone } from './todo';
import type { Item, Settings } from './types';

/** What an action may need from the app besides the item (todo actions save). */
export interface ActionCtx {
  saveItem: (item: Item) => Promise<unknown>;
}

export interface ActionDef {
  label: string;
  /** returns the toast text */
  run: (item: Item, s: Settings, filledCommand?: string, ctx?: ActionCtx) => Promise<string>;
  /** command with {{params}}: UI must ask for values first */
  needsParams?: boolean;
}

function commandText(item: Item, filled?: string) {
  return filled ?? item.content;
}

function todoToggle(item: Item): ActionDef {
  const done = !!item.meta.done;
  return {
    label: done ? '标记未完成' : '标记完成',
    run: async (it, _s, _f, ctx) => {
      if (!ctx) throw new Error('无法保存');
      await ctx.saveItem(setDone(it, !it.meta.done, Date.now()));
      return it.meta.done ? '已重新打开' : '已完成 ✓';
    },
  };
}

export function primaryAction(item: Item): ActionDef | null {
  switch (item.type) {
    case 'todo':
      return todoToggle(item);
    case 'command':
      return {
        label: '复制',
        needsParams: parseParams(item.content).length > 0,
        run: async (it, _s, filled) => {
          await copyText(commandText(it, filled));
          return '命令已复制';
        },
      };
    case 'text':
      return {
        label: '复制',
        run: async (it) => {
          await copyText(it.content);
          return '已复制';
        },
      };
    case 'link':
      return {
        label: '打开链接',
        run: async (it) => {
          await openUrl(it.content.trim());
          return '已在浏览器打开';
        },
      };
    case 'file':
      return {
        label: '打开',
        run: async (it) => {
          await openPath(it.content.trim());
          return '已打开';
        },
      };
    case 'software':
      if (item.meta.website)
        return {
          label: '打开官网',
          run: async (it) => {
            await openUrl(it.meta.website!.trim());
            return '已打开官网';
          },
        };
      if (item.meta.installerPath)
        return {
          label: '定位安装包',
          run: async (it) => {
            await revealPath(it.meta.installerPath!.trim());
            return '已在文件夹中显示';
          },
        };
      return {
        label: '复制说明',
        run: async (it) => {
          await copyText(it.content);
          return '已复制';
        },
      };
  }
}

export function secondaryAction(item: Item): ActionDef | null {
  switch (item.type) {
    case 'todo':
      return item.content.trim()
        ? {
            label: '复制子任务/备注',
            run: async (it) => {
              await copyText(it.content);
              return '已复制';
            },
          }
        : null;
    case 'command':
      return {
        label: '在终端执行',
        needsParams: parseParams(item.content).length > 0,
        run: async (it, s, filled) => {
          await runInTerminal(commandText(it, filled), s.terminal);
          return '已在终端执行';
        },
      };
    case 'link':
      return {
        label: '复制链接',
        run: async (it) => {
          await copyText(it.content.trim());
          return '链接已复制';
        },
      };
    case 'file':
      return {
        label: '在文件夹中显示',
        run: async (it) => {
          await revealPath(it.content.trim());
          return '已在文件夹中显示';
        },
      };
    case 'software':
      if (item.meta.installerPath && item.meta.website)
        return {
          label: '定位安装包',
          run: async (it) => {
            await revealPath(it.meta.installerPath!.trim());
            return '已在文件夹中显示';
          },
        };
      if (item.meta.secret)
        return {
          label: '复制注册码',
          run: async (it) => {
            await copyText(it.meta.secret!);
            return '已复制敏感信息';
          },
        };
      return null;
    case 'text':
      return null;
  }
}
