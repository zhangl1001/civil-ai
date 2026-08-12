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

export const ImageSourceKind = {
  Local: 'local',
  Inline: 'inline',
  Remote: 'remote',
  Blocked: 'blocked'
} as const;

export type ImageSourceKind = typeof ImageSourceKind[keyof typeof ImageSourceKind];

export interface ResolvedImageSource {
  readonly src: string;
  readonly kind: ImageSourceKind;
}

const SAFE_ABSOLUTE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const MAX_INLINE_IMAGE_SOURCE_LENGTH = 8 * 1_024 * 1_024;
const SAFE_INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

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

export function resolveImageSource(rawSource: string): ResolvedImageSource {
  const src = rawSource.trim();
  if (!src) return { src: '', kind: ImageSourceKind.Blocked };
  if (isLocalAppPath(src)) return { src, kind: ImageSourceKind.Local };
  if (src.length <= MAX_INLINE_IMAGE_SOURCE_LENGTH && SAFE_INLINE_IMAGE.test(src)) {
    return { src, kind: ImageSourceKind.Inline };
  }
  try {
    const url = new URL(src);
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return { src, kind: ImageSourceKind.Remote };
    }
  } catch {
    // Invalid and unsupported image references are blocked below.
  }
  return { src: '', kind: ImageSourceKind.Blocked };
}

function isLocalAppPath(value: string): boolean {
  if (value.startsWith('//') || value.includes('\\')) return false;
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../');
}
