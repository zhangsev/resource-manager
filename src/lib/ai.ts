import type { ItemType, Settings } from './types';

/**
 * Optional AI helper. Uses any OpenAI-compatible Chat Completions endpoint
 * (OpenAI, DeepSeek, Moonshot, Qwen compatible mode, a local Ollama, ...).
 * Nothing is sent anywhere unless the user enables it and fills in a key.
 */

export interface AiSuggestion {
  title: string;
  tags: string[];
}

export function aiReady(s: Settings): boolean {
  return s.aiEnabled && !!s.aiBaseUrl.trim() && !!s.aiModel.trim();
}

export async function suggestTitleAndTags(
  s: Settings,
  type: ItemType,
  content: string,
  existingTags: string[],
  request: typeof fetch = globalThis.fetch,
): Promise<AiSuggestion> {
  const url = s.aiBaseUrl.replace(/\/+$/, '') + '/chat/completions';
  const prompt = [
    '你是个人资源管理工具的助手。根据下面的条目内容，给出一个简短的中文标题（不超过20个字）和1到4个标签。',
    '优先复用已有标签：' + (existingTags.slice(0, 80).join('、') || '（暂无）'),
    '只输出 JSON，格式：{"title": "...", "tags": ["..."]}',
    `条目类型：${type}`,
    '内容：',
    content.slice(0, 4000),
  ].join('\n');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.aiApiKey.trim()) headers.Authorization = `Bearer ${s.aiApiKey.trim()}`;
  const res = await request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: s.aiModel,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`AI 请求失败：HTTP ${res.status}`);
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  return parseSuggestion(text);
}

export function parseSuggestion(text: string): AiSuggestion {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 返回内容无法解析');
  const obj = JSON.parse(m[0]);
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const tags = Array.isArray(obj.tags)
    ? obj.tags.map((t: unknown) => String(t).trim().replace(/^#/, '')).filter(Boolean).slice(0, 6)
    : [];
  return { title, tags };
}
