import { parseParams } from './params';
import { copyText, openPath, openUrl, revealPath, runInTerminal } from './platform';
import type { Item, Settings } from './types';

export interface ActionDef {
  label: string;
  /** returns the toast text */
  run: (item: Item, s: Settings, filledCommand?: string) => Promise<string>;
  /** command with {{params}}: UI must ask for values first */
  needsParams?: boolean;
}

function commandText(item: Item, filled?: string) {
  return filled ?? item.content;
}

export function primaryAction(item: Item): ActionDef | null {
  switch (item.type) {
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
