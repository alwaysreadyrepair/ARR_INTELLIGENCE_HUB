/** An external link safe to put in an href: http(s) only. Anything else (javascript:, data:) becomes undefined. */
export function httpUrl(raw: string | null | undefined): string | undefined {
  try {
    const u = new URL(raw ?? '');
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}
