export const LinkKind = {
  Internal: 'internal',
  External: 'external',
  Blocked: 'blocked'
} as const;

export type LinkKind = typeof LinkKind[keyof typeof LinkKind];

export interface ResolvedLink {
  readonly href: string;
  readonly kind: LinkKind;
}

const SAFE_ABSOLUTE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function resolveLink(rawHref: string): ResolvedLink {
  const href = rawHref.trim();
  if (!href) return { href: '', kind: LinkKind.Blocked };
  if (href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
    return { href, kind: LinkKind.Internal };
  }
  try {
    const url = new URL(href);
    if (!SAFE_ABSOLUTE_PROTOCOLS.has(url.protocol)) return { href: '', kind: LinkKind.Blocked };
    return {
      href,
      kind: url.protocol === 'http:' || url.protocol === 'https:' ? LinkKind.External : LinkKind.Internal
    };
  } catch {
    return { href: '', kind: LinkKind.Blocked };
  }
}
