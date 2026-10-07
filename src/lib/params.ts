/**
 * Command placeholders: {{name}} or {{name:default value}}.
 * Example: ssh {{user:root}}@{{host}} -p {{port:22}}
 */

export interface Param {
  name: string;
  defaultValue: string;
}

const RE = /\{\{\s*([^{}:]+?)\s*(?::([^{}]*))?\}\}/g;

export function parseParams(template: string): Param[] {
  const seen = new Map<string, Param>();
  for (const m of template.matchAll(RE)) {
    const name = m[1].trim();
    if (!seen.has(name)) seen.set(name, { name, defaultValue: (m[2] ?? '').trim() });
  }
  return [...seen.values()];
}

export function fillParams(template: string, values: Record<string, string>): string {
  return template.replace(RE, (_all, rawName: string, def?: string) => {
    const name = rawName.trim();
    const v = values[name];
    if (v !== undefined && v !== '') return v;
    return (def ?? '').trim();
  });
}
