export function editPhone(value: string, start: number, end: number, key: string): { value: string; caret: number } {
  const a = Math.max(0, Math.min(value.length, start));
  const b = Math.max(a, Math.min(value.length, end));
  if (key === '⌫') {
    const from = a === b ? Math.max(0, a - 1) : a;
    return { value: value.slice(0, from) + value.slice(b), caret: from };
  }
  if (!/^[0-9+]$/.test(key)) return { value, caret: b };
  return { value: value.slice(0, a) + key + value.slice(b), caret: a + 1 };
}
