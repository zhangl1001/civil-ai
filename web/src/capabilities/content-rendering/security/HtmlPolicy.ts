import DOMPurify, { type Config, type DOMPurify as Purifier } from 'dompurify';
import {
  SVG_ALLOWED_ATTRIBUTES,
  SVG_ALLOWED_ELEMENTS,
  SVG_FORBIDDEN_ELEMENTS,
  matchSvgStyleRules,
  mergeSvgStyle,
  parseSvgStyleSheet,
  sanitizeSvgAttribute,
  type SvgStyleRule
} from './SvgPresentationPolicy';

/**
 * What Marked and KaTeX emit. Raw HTML inside Markdown is escaped before it
 * reaches the policy, so this list only has to cover the renderer output: the
 * GFM blocks, KaTeX's HTML spans with their SVG strokes, and its MathML tree.
 */
const HTML_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'hr', 'del', 's', 'u',
  'mark', 'kbd', 'sub', 'sup', 'details', 'summary', 'figure', 'figcaption',
  'dl', 'dt', 'dd', 'input', 'table', 'caption', 'colgroup', 'col', 'thead',
  'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img', 'svg', 'g', 'defs',
  'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop',
  'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn',
  'mtext', 'mspace', 'mfrac', 'msqrt', 'mroot', 'msup', 'msub', 'msubsup',
  'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'menclose', 'mstyle',
  'mpadded', 'mphantom', 'mfenced'
] as const;

const HTML_ALLOWED_ATTRIBUTES = [
  'href', 'target', 'rel', 'class', 'alt', 'title', 'width', 'height',
  'loading', 'decoding', 'viewBox', 'preserveAspectRatio', 'xmlns', 'id', 'role',
  'aria-label', 'aria-hidden', 'style', 'type', 'checked', 'disabled', 'open', 'start', 'colspan',
  'rowspan', 'scope', 'align', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'data-app-image-src',
  'stroke-dashoffset', 'opacity', 'vector-effect', 'cx', 'cy', 'r', 'rx', 'ry',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'd', 'transform', 'font-size',
  'text-anchor', 'dominant-baseline', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'patternUnits', 'patternContentUnits',
  'display', 'encoding', 'mathvariant', 'columnalign', 'rowalign', 'columnspacing',
  'rowspacing', 'columnlines', 'rowlines', 'linethickness', 'scriptlevel', 'displaystyle',
  'stretchy', 'fence', 'separator', 'lspace', 'rspace', 'accent', 'accentunder',
  'minsize', 'maxsize', 'movablelimits', 'largeop', 'symmetric', 'notation', 'depth',
  'voffset', 'linebreak', 'mathcolor', 'mathbackground'
] as const;

/**
 * Never allowed on either path, whatever an allow-list says. A `<style>` that
 * survives is a stylesheet for the whole app, not for the fragment it came in.
 */
export const ALWAYS_FORBIDDEN_TAGS = Object.freeze([
  'style', 'script', 'foreignObject', 'iframe', 'object', 'embed', 'link', 'meta',
  'base', 'use', 'image', 'animate', 'animateMotion', 'animateTransform', 'set'
] as const);

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Markdown HTML options. No `USE_PROFILES`: DOMPurify replaces ALLOWED_TAGS and
 * ALLOWED_ATTR with the profile lists whenever a profile is set, which silently
 * turns the allow-lists above into dead configuration.
 */
export function htmlSanitizeConfig(): Config {
  return {
    ALLOWED_TAGS: [...HTML_ALLOWED_TAGS],
    ALLOWED_ATTR: [...HTML_ALLOWED_ATTRIBUTES],
    FORBID_TAGS: [...ALWAYS_FORBIDDEN_TAGS],
    FORBID_ATTR: ['xlink:href', 'src', 'srcset'],
    ALLOW_UNKNOWN_PROTOCOLS: false
  };
}

/** Authored SVG figures: the explicit vocabulary of SvgPresentationPolicy and nothing else. */
export function svgSanitizeConfig(): Config {
  return {
    ALLOWED_TAGS: [...SVG_ALLOWED_ELEMENTS],
    ALLOWED_ATTR: [...SVG_ALLOWED_ATTRIBUTES],
    FORBID_TAGS: [...new Set<string>([...SVG_FORBIDDEN_ELEMENTS, ...ALWAYS_FORBIDDEN_TAGS])],
    FORBID_ATTR: ['href', 'xlink:href', 'src', 'class'],
    ADD_FORBID_CONTENTS: [...SVG_FORBIDDEN_ELEMENTS],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false
  };
}

interface SvgSanitizeScope {
  readonly idPrefix: string;
  sheet?: readonly SvgStyleRule[];
}

let policySequence = 0;
let svgPurifier: Purifier | undefined;
let activeSvgScope: SvgSanitizeScope | undefined;

export class HtmlPolicy {
  private readonly svgScopeSeed = (policySequence += 1).toString(36);

  sanitize(html: string): string {
    return DOMPurify.sanitize(html, htmlSanitizeConfig());
  }

  /**
   * Ids are rewritten per policy instance and markup, so the same figure keeps
   * a stable id space across re-renders while two figures on one screen (or the
   * same figure in two components) never share one.
   */
  sanitizeSvg(svg: string): string {
    const purifier = svgSanitizer();
    activeSvgScope = { idPrefix: `svg${this.svgScopeSeed}-${markupHash(svg)}` };
    try {
      return purifier.sanitize(svg, svgSanitizeConfig());
    } finally {
      activeSvgScope = undefined;
    }
  }
}

/** A private DOMPurify instance, so these hooks never run for Markdown HTML. */
function svgSanitizer(): Purifier {
  if (svgPurifier) return svgPurifier;
  const purifier = DOMPurify(window);
  // The walk starts at the parse root, so the figure's stylesheets are read
  // once, in full, before any element that they style is visited.
  purifier.addHook('beforeSanitizeElements', (node) => {
    const scope = activeSvgScope;
    if (scope && !scope.sheet) scope.sheet = collectStyleRules(node);
  });
  // `<style>` never survives, so rules it applied through simple selectors are
  // folded into each element's inline style beneath the element's own style.
  purifier.addHook('beforeSanitizeAttributes', (element) => {
    const sheet = activeSvgScope?.sheet;
    if (!sheet?.length || element.namespaceURI !== SVG_NAMESPACE) return;
    const declarations = matchSvgStyleRules(sheet, element.localName, element.getAttribute('class') ?? '');
    if (declarations.length) element.setAttribute('style', mergeSvgStyle(declarations, element.getAttribute('style') ?? ''));
  });
  purifier.addHook('uponSanitizeAttribute', (_element, event) => {
    const scope = activeSvgScope;
    const value = scope ? sanitizeSvgAttribute(event.attrName, event.attrValue, scope.idPrefix) : undefined;
    if (value === undefined) event.keepAttr = false;
    else event.attrValue = value;
  });
  svgPurifier = purifier;
  return purifier;
}

function collectStyleRules(root: Node): SvgStyleRule[] {
  try {
    if (root.nodeType !== Node.ELEMENT_NODE) return [];
    // Prototype call: markup under sanitation must not be able to shadow it.
    const styles = Element.prototype.querySelectorAll.call(root as Element, 'style');
    return parseSvgStyleSheet(Array.from(styles, (style) => style.textContent ?? '').join('\n'));
  } catch {
    return [];
  }
}

function markupHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
