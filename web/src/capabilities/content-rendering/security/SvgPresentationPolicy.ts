/**
 * The presentation vocabulary an authored SVG figure may keep.
 *
 * Figures come from model output and imported question packs, so everything
 * here is an allow-list: element and attribute names, the style properties an
 * element may set, and a value grammar that leaves no room for resource loads.
 * The only reference that survives is a same-figure fragment (`url(#id)`), and
 * it is rewritten into the figure's own id scope so several figures on one
 * screen can never resolve each other's gradients, markers or clip paths.
 *
 * Everything in this module is pure string work so it can be exercised in Node;
 * the DOM walk that applies it lives in HtmlPolicy.
 */

export const SVG_ALLOWED_ELEMENTS = Object.freeze([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line',
  'polyline', 'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop',
  'pattern', 'clipPath', 'mask', 'marker'
] as const);

/**
 * Removed together with their content. `use` and `symbol` stay out on purpose:
 * nested `use` references multiply rendering work exponentially, and without
 * `use` a symbol is template content that must not be hoisted into view.
 * Anything else outside the allow-list (links, `switch`, unknown elements) is
 * unwrapped instead, so the shapes inside it still render.
 */
export const SVG_FORBIDDEN_ELEMENTS = Object.freeze([
  'style', 'script', 'foreignObject', 'use', 'symbol', 'image', 'feImage', 'filter',
  'animate', 'animateMotion', 'animateTransform', 'animateColor', 'set', 'mpath',
  'iframe', 'embed', 'object', 'metadata'
] as const);

/** Style properties an element may set inline or through the figure's own stylesheet. */
export const SVG_STYLE_PROPERTIES = Object.freeze([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-opacity', 'opacity', 'color', 'stop-color', 'stop-opacity', 'font-size',
  'font-weight', 'font-style', 'font-family', 'text-anchor', 'dominant-baseline',
  'alignment-baseline', 'baseline-shift', 'letter-spacing', 'text-decoration',
  'vector-effect', 'paint-order', 'visibility', 'clip-path', 'clip-rule', 'mask',
  'marker-start', 'marker-mid', 'marker-end', 'transform', 'transform-origin',
  'transform-box', 'shape-rendering', 'text-rendering'
] as const);

const SVG_GEOMETRY_ATTRIBUTES = [
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr',
  'width', 'height', 'd', 'points', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust',
  'pathLength', 'viewBox', 'preserveAspectRatio', 'offset', 'gradientUnits',
  'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits',
  'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'markerWidth',
  'markerHeight', 'markerUnits', 'refX', 'refY', 'orient'
] as const;

/** Presentation attributes with no inline-style counterpart: CSS on the figure container outranks them. */
const SVG_ATTRIBUTE_ONLY_PRESENTATION = ['display', 'overflow'] as const;

/** Every attribute a sanitized figure may carry; `class` is read for the stylesheet, never kept. */
export const SVG_ALLOWED_ATTRIBUTES = Object.freeze([
  'id', 'style', ...SVG_GEOMETRY_ATTRIBUTES, ...SVG_ATTRIBUTE_ONLY_PRESENTATION, ...SVG_STYLE_PROPERTIES
]);

export interface SvgStyleRule {
  readonly tag?: string;
  readonly classes: readonly string[];
  readonly specificity: number;
  readonly order: number;
  readonly declarations: readonly SvgDeclaration[];
}

export type SvgDeclaration = readonly [property: string, value: string];

const ALLOWED_ATTRIBUTE_NAMES = new Set(SVG_ALLOWED_ATTRIBUTES.map((name) => name.toLowerCase()));
const STYLE_PROPERTY_NAMES = new Set<string>(SVG_STYLE_PROPERTIES);
const SAFE_ID = /^[A-Za-z_][\w.-]{0,63}$/;
const LOCAL_REFERENCE = /url\(\s*(['"]?)#([A-Za-z_][\w.-]{0,63})\1\s*\)/gi;
// Letters, digits and the punctuation of numbers, colours, lists and function
// calls. No quotes, colons, backslash escapes, `@`, `;`, `!`, braces or angle
// brackets, so neither CSS escapes nor protocol-style values can form.
const GENERIC_VALUE = /^[A-Za-z0-9#.,%+\-\s()/]*$/;
const FONT_FAMILY_VALUE = /^[A-Za-z0-9\s,'"._\-\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]+$/;
const FUNCTION_CALL = /([A-Za-z][\w-]*)\s*\(/g;
const COLOR_FUNCTIONS = ['rgb', 'rgba', 'hsl', 'hsla'];
const TRANSFORM_FUNCTIONS = [
  'translate', 'translatex', 'translatey', 'rotate', 'scale', 'scalex', 'scaley',
  'skewx', 'skewy', 'matrix'
];
const FUNCTIONS_BY_PROPERTY = new Map<string, ReadonlySet<string>>([
  ...['fill', 'stroke', 'color', 'stop-color'].map((name) => [name, new Set(COLOR_FUNCTIONS)] as const),
  ...['transform', 'gradienttransform', 'patterntransform'].map((name) => [name, new Set(TRANSFORM_FUNCTIONS)] as const)
]);
const REFERENCE_PROPERTIES = new Set(['fill', 'stroke', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end']);
const NO_FUNCTIONS: ReadonlySet<string> = new Set();
const MAX_STYLE_VALUE_LENGTH = 256;

/** Returns the value to keep for an attribute, or `undefined` when it has to go. */
export function sanitizeSvgAttribute(name: string, value: string, scope: string): string | undefined {
  const attribute = name.toLowerCase();
  if (!ALLOWED_ATTRIBUTE_NAMES.has(attribute)) return undefined;
  if (attribute === 'id') return scopeSvgId(value, scope);
  if (attribute === 'style') return sanitizeSvgStyle(value, scope) || undefined;
  return sanitizeSvgValue(attribute, value, scope);
}

/** Keeps only allow-listed declarations with safe values, in `property:value;…` form. */
export function sanitizeSvgStyle(style: string, scope: string): string {
  return serializeDeclarations(parseDeclarations(style).flatMap(([property, value]) => {
    if (!STYLE_PROPERTY_NAMES.has(property) || value.length > MAX_STYLE_VALUE_LENGTH) return [];
    const safe = sanitizeSvgValue(property, value, scope);
    return safe ? [[property, safe] as const] : [];
  }));
}

export function scopeSvgId(id: string, scope: string): string | undefined {
  const value = id.trim();
  return SAFE_ID.test(value) ? `${scope}-${value}` : undefined;
}

/**
 * Parses a figure's own `<style>` text into rules it can still honour once the
 * stylesheet itself is gone. Only simple selectors are understood (`rect`,
 * `.shape`, `text.label`, `*`, comma lists); at-rules, combinators, ids and
 * pseudo-classes are dropped, so a rule is either applied exactly or not at all.
 */
export function parseSvgStyleSheet(css: string): SvgStyleRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--|-->|<!\[CDATA\[|\]\]>/g, ' ');
  const rules: SvgStyleRule[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('{', cursor);
    if (open < 0) break;
    const close = matchingBrace(text, open);
    const prelude = text.slice(cursor, open).split(';').pop()?.trim() ?? '';
    const body = text.slice(open + 1, close < 0 ? text.length : close);
    cursor = close < 0 ? text.length : close + 1;
    if (!prelude || prelude.startsWith('@') || body.includes('{')) continue;
    const declarations = parseDeclarations(body);
    if (!declarations.length) continue;
    for (const selectorText of prelude.split(',')) {
      const selector = parseSimpleSelector(selectorText.trim());
      if (selector) rules.push({ ...selector, order: rules.length, declarations });
    }
  }
  return rules;
}

/** Declarations the stylesheet assigns to one element, most specific last-wins. */
export function matchSvgStyleRules(
  rules: readonly SvgStyleRule[],
  tagName: string,
  className: string
): SvgDeclaration[] {
  const tag = tagName.toLowerCase();
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  const matched = rules
    .filter((rule) => (!rule.tag || rule.tag === tag) && rule.classes.every((item) => classes.has(item)))
    .sort((left, right) => left.specificity - right.specificity || left.order - right.order);
  const merged = new Map<string, string>();
  for (const rule of matched) {
    for (const [property, value] of rule.declarations) {
      merged.delete(property);
      merged.set(property, value);
    }
  }
  return [...merged];
}

/** Stylesheet declarations below the element's inline style, which wins as it does in CSS. */
export function mergeSvgStyle(sheet: readonly SvgDeclaration[], inlineStyle: string): string {
  const merged = new Map<string, string>(sheet);
  for (const [property, value] of parseDeclarations(inlineStyle)) {
    merged.delete(property);
    merged.set(property, value);
  }
  return serializeDeclarations([...merged]);
}

function sanitizeSvgValue(property: string, value: string, scope: string): string | undefined {
  const trimmed = value.trim();
  let referenceCount = 0;
  const unreferenced = trimmed.replace(LOCAL_REFERENCE, () => {
    referenceCount += 1;
    return ' ';
  });
  if (referenceCount && !REFERENCE_PROPERTIES.has(property)) return undefined;
  const grammar = property === 'font-family' ? FONT_FAMILY_VALUE : GENERIC_VALUE;
  if (!grammar.test(unreferenced)) return undefined;
  const allowedFunctions = FUNCTIONS_BY_PROPERTY.get(property) ?? NO_FUNCTIONS;
  const calls = [...unreferenced.matchAll(FUNCTION_CALL)].map((match) => match[1]!.toLowerCase());
  const openParentheses = unreferenced.split('(').length - 1;
  if (calls.length !== openParentheses || calls.some((name) => !allowedFunctions.has(name))) return undefined;
  return trimmed.replace(LOCAL_REFERENCE, (_match, _quote: string, id: string) => `url(#${scope}-${id})`);
}

function parseDeclarations(style: string): SvgDeclaration[] {
  const declarations = new Map<string, string>();
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator <= 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).replace(/!\s*important\s*$/i, '').trim();
    if (!/^[a-z-]+$/.test(property) || !value) continue;
    declarations.delete(property);
    declarations.set(property, value);
  }
  return [...declarations];
}

function serializeDeclarations(declarations: readonly SvgDeclaration[]): string {
  return declarations.map(([property, value]) => `${property}:${value}`).join(';');
}

function parseSimpleSelector(selector: string): Omit<SvgStyleRule, 'order' | 'declarations'> | undefined {
  const match = /^(\*|[A-Za-z][\w-]*)?((?:\.[A-Za-z_-][\w-]*)*)$/.exec(selector);
  if (!selector || !match) return undefined;
  const tag = match[1] && match[1] !== '*' ? match[1].toLowerCase() : undefined;
  const classes = (match[2] ?? '').split('.').filter(Boolean);
  return { tag, classes, specificity: classes.length * 10 + (tag ? 1 : 0) };
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}' && --depth === 0) return index;
  }
  return -1;
}
