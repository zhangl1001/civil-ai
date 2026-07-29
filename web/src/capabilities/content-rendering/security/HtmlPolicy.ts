import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'hr', 'del', 's', 'u',
  'mark', 'kbd', 'sub', 'sup', 'details', 'summary', 'figure', 'figcaption',
  'dl', 'dt', 'dd', 'input', 'table', 'caption', 'colgroup', 'col', 'thead',
  'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img', 'svg', 'g', 'defs', 'symbol',
  'use', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop',
  'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn',
  'mtext', 'mspace', 'mfrac', 'msqrt', 'mroot', 'msup', 'msub', 'msubsup',
  'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'menclose', 'mstyle',
  'mpadded', 'mphantom', 'mfenced'
] as const;

const ALLOWED_ATTRIBUTES = [
  'href', 'target', 'rel', 'class', 'src', 'alt', 'title', 'width', 'height',
  'loading', 'decoding', 'viewBox', 'preserveAspectRatio', 'xmlns', 'id', 'role',
  'aria-label', 'aria-hidden', 'style', 'type', 'checked', 'disabled', 'open', 'start', 'colspan',
  'rowspan', 'scope', 'align', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'opacity', 'vector-effect', 'cx', 'cy', 'r', 'rx', 'ry',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'd', 'transform', 'font-size',
  'text-anchor', 'dominant-baseline', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'patternUnits', 'patternContentUnits',
  'display', 'encoding', 'mathvariant', 'columnalign', 'rowalign', 'columnspacing',
  'rowspacing', 'linethickness', 'scriptlevel', 'displaystyle', 'stretchy',
  'fence', 'separator', 'lspace', 'rspace', 'accent', 'accentunder'
] as const;

export class HtmlPolicy {
  sanitize(html: string): string {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true, mathMl: true },
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
      ALLOW_UNKNOWN_PROTOCOLS: false
    });
  }
}
