'use strict';
const { JSDOM } = require('jsdom');

// ─── HubL token preservation ─────────────────────────────────────────────────
// Replace {{ ... }} and {% ... %} with stable placeholders before DOM parsing,
// restore them after serialisation so JSDOM never sees or escapes them.
function extractHubl(html) {
  const tokens = [];
  const escaped = html.replace(/(\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\})/g, (match) => {
    const idx = tokens.length;
    tokens.push(match);
    return `__HUBL_${idx}__`;
  });
  return { escaped, tokens };
}

function restoreHubl(html, tokens) {
  return html.replace(/__HUBL_(\d+)__/g, (_, i) => tokens[Number(i)]);
}

// ─── Suspicious link detector ─────────────────────────────────────────────────
function suspiciousHrefs(hrefs) {
  const warnings = [];
  for (const href of hrefs) {
    if (/\.com\.com/i.test(href))          warnings.push({ href, reason: 'contains .com.com' });
    if (/www\.\./i.test(href))             warnings.push({ href, reason: 'contains www..' });
    if (/\.(jpg|png|webp|gif)$/i.test(href)) warnings.push({ href, reason: 'ends with image extension' });
    if (/(hs-fs\/hubfs|hs-sites)/i.test(href)) warnings.push({ href, reason: 'contains HubSpot file host' });
  }
  return warnings;
}

// ─── Build ImageAnchorMap from a document ────────────────────────────────────
// key = exact img src string, value = exact href string
function buildImageAnchorMap(document) {
  const map = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const imgs = a.querySelectorAll('img[src]');
    // Only direct-child images (not images wrapped by another element between)
    for (const img of imgs) {
      if (img.parentElement === a) {
        map.set(img.getAttribute('src'), a.getAttribute('href'));
      }
    }
  }
  return map;
}

// ─── Remove HubSpot wrapper elements ─────────────────────────────────────────
// Unwrap (hoist children) — never remove <a>, <img>, <table>, <tr>, <td>
const SAFE_TO_UNWRAP = new Set(['div', 'span', 'section']);
function unwrapHubspotWrappers(document) {
  const wrappers = document.querySelectorAll(
    '.hs_cos_wrapper, .hse-section, [class*="hs-cos-wrapper"]'
  );
  for (const el of wrappers) {
    if (!SAFE_TO_UNWRAP.has(el.tagName.toLowerCase())) continue;
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
}

// ─── Remove HubSpot tracking attributes ──────────────────────────────────────
const HS_ATTRS = [
  'data-hs-link-id', 'data-hs-link-id-v2',
];
function removeHsAttributes(document) {
  const all = document.querySelectorAll('*');
  for (const el of all) {
    for (const attr of HS_ATTRS) {
      el.removeAttribute(attr);
    }
    // Remove data-hs-cos-* and data-hs-* attributes
    for (const attr of [...el.attributes]) {
      if (/^data-hs-/i.test(attr.name)) el.removeAttribute(attr.name);
    }
    // Remove HubSpot-only classes (hs_cos_wrapper* but keep other classes)
    if (el.className && typeof el.className === 'string') {
      const cleaned = el.className
        .split(/\s+/)
        .filter(c => !/^hs[_-]|^hse-|^hs-/i.test(c))
        .join(' ')
        .trim();
      if (cleaned) el.setAttribute('class', cleaned);
      else el.removeAttribute('class');
    }
  }
}

// ─── Strip responsive / stacking media queries from <style> blocks ───────────
const RESPONSIVE_CLASS_PATTERNS = [
  /\.hse-column\b/, /\.hse-column-container\b/, /\.hse-no-stack-row\b/,
  /display\s*:\s*block/, /display\s*:\s*table/,
];

// Extract top-level @media blocks using brace counting (handles nesting)
function extractMediaBlocks(css) {
  const blocks = [];
  let i = 0;
  while (i < css.length) {
    const atIdx = css.indexOf('@media', i);
    if (atIdx === -1) break;
    // Find the opening brace
    let braceStart = css.indexOf('{', atIdx);
    if (braceStart === -1) break;
    // Count braces to find the matching closing brace
    let depth = 0;
    let end = braceStart;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}') { depth--; if (depth === 0) break; }
    }
    blocks.push({ start: atIdx, end: end + 1, text: css.slice(atIdx, end + 1) });
    i = end + 1;
  }
  return blocks;
}

function stripResponsiveCSS(document) {
  for (const style of document.querySelectorAll('style')) {
    let css = style.textContent;
    const blocks = extractMediaBlocks(css);
    // Process in reverse order so indices stay valid
    for (let b = blocks.length - 1; b >= 0; b--) {
      const { start, end, text } = blocks[b];
      if (/prefers-color-scheme\s*:\s*dark/i.test(text)) continue;
      if (RESPONSIVE_CLASS_PATTERNS.some(p => p.test(text))) {
        css = css.slice(0, start) + css.slice(end);
      }
    }
    style.textContent = css;
  }
}

// ─── Force inline widths on images ───────────────────────────────────────────
function lockImageWidths(document) {
  for (const img of document.querySelectorAll('img')) {
    const w = img.getAttribute('width') || img.style.width?.replace('px', '');
    if (w && !isNaN(parseInt(w))) {
      const px = parseInt(w);
      img.setAttribute('width', px);
      img.style.width = `${px}px`;
    } else {
      // No width specified — leave it alone, don't add a guess
    }
    if (!img.style.display) img.style.display = 'block';
    if (!img.getAttribute('height')) img.setAttribute('height', 'auto');
  }
}

// ─── Enforce 600px container ──────────────────────────────────────────────────
function enforce600Container(document) {
  // Find the outermost table — make sure it's 600px
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    const w = table.getAttribute('width');
    // Only touch top-level container (no ancestor table)
    if (!table.closest('table > * table')) {
      if (!w || parseInt(w) >= 550) {
        table.setAttribute('width', '600');
        table.style.width = '600px';
        if (!table.style.maxWidth) table.style.maxWidth = '600px';
      }
      break; // only the outermost
    }
  }
}

// ─── Add dark mode meta + override ───────────────────────────────────────────
function addDarkModeMitigation(document) {
  const head = document.head;
  if (!head) return;
  // Meta tags
  for (const [name, content] of [
    ['color-scheme', 'light only'],
    ['supported-color-schemes', 'light'],
  ]) {
    if (!head.querySelector(`meta[name="${name}"]`)) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', name);
      meta.setAttribute('content', content);
      head.insertBefore(meta, head.firstChild);
    }
  }
  // Small override style block
  if (!head.querySelector('style[data-dark-override]')) {
    const s = document.createElement('style');
    s.setAttribute('data-dark-override', '1');
    s.textContent = `@media (prefers-color-scheme:dark){body,table,td,div{color:inherit!important;background-color:inherit!important;}}`;
    head.appendChild(s);
  }
}

// ─── Re-apply ImageAnchorMap ─────────────────────────────────────────────────
// For every img whose src is in the map, ensure parent <a> has exact href.
function reapplyImageAnchorMap(document, map) {
  for (const [src, href] of map) {
    for (const img of document.querySelectorAll(`img`)) {
      if (img.getAttribute('src') !== src) continue;
      const parent = img.parentElement;
      if (parent && parent.tagName.toLowerCase() === 'a') {
        // Fix href if it changed
        if (parent.getAttribute('href') !== href) {
          parent.setAttribute('href', href);
        }
      } else {
        // Wrap with correct <a>
        const a = document.createElement('a');
        a.setAttribute('href', href);
        img.parentNode.insertBefore(a, img);
        a.appendChild(img);
      }
    }
  }
}

// ─── Validate output ─────────────────────────────────────────────────────────
function validate(inputMap, outputDocument, strict) {
  const errors = [];
  const warnings = [];

  // Collect all hrefs in output for suspicious check
  const allHrefs = [...outputDocument.querySelectorAll('a[href]')]
    .map(a => a.getAttribute('href'));
  warnings.push(...suspiciousHrefs(allHrefs));

  for (const [src, expectedHref] of inputMap) {
    const imgs = [...outputDocument.querySelectorAll('img')].filter(
      i => i.getAttribute('src') === src
    );
    for (const img of imgs) {
      const parent = img.parentElement;
      if (!parent || parent.tagName.toLowerCase() !== 'a') {
        errors.push({ src, issue: 'image lost its anchor tag' });
        continue;
      }
      const actualHref = parent.getAttribute('href');
      if (actualHref !== expectedHref) {
        errors.push({ src, expectedHref, actualHref, issue: 'href changed' });
      }
      // Flag href===src as auto-link ONLY if that was NOT the original input relationship
      if (actualHref === src && expectedHref !== src) {
        errors.push({ src, issue: 'image href equals its own src (auto-link detected)' });
      }
    }
  }

  // Check images NOT in map — make sure none got auto-wrapped with their own src
  for (const img of outputDocument.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (inputMap.has(src)) continue; // already checked above
    const parent = img.parentElement;
    if (parent && parent.tagName.toLowerCase() === 'a') {
      const href = parent.getAttribute('href');
      if (href === src) {
        errors.push({ src, issue: 'image auto-wrapped with its own src (was not linked in input)' });
      }
    }
  }

  return { errors, warnings, passed: errors.length === 0 };
}

// ─── Main convert function ────────────────────────────────────────────────────
/**
 * @param {string} html  Raw input HTML+HubL
 * @param {object} opts
 * @param {boolean} [opts.strict=true]            Fail on validation errors
 * @param {boolean} [opts.stripWrappers=true]     Unwrap HubSpot wrapper divs
 * @param {boolean} [opts.removeResponsiveCSS=true] Strip stacking media queries
 * @returns {{ output: string, validation: object }}
 */
function convert(html, opts = {}) {
  const {
    strict = true,
    stripWrappers = true,
    removeResponsiveCSS = true,
  } = opts;

  // 1. Preserve HubL tokens
  const { escaped, tokens } = extractHubl(html);

  // 2. Parse input DOM (once to build the anchor map)
  const inputDom = new JSDOM(escaped, { contentType: 'text/html' });
  const inputDoc = inputDom.window.document;
  const imageAnchorMap = buildImageAnchorMap(inputDoc);

  // 3. Parse working DOM for transformation
  const dom = new JSDOM(escaped, { contentType: 'text/html' });
  const doc = dom.window.document;

  // 4. Pipeline
  if (stripWrappers)       unwrapHubspotWrappers(doc);
  removeHsAttributes(doc);
  if (removeResponsiveCSS) stripResponsiveCSS(doc);
  lockImageWidths(doc);
  enforce600Container(doc);
  addDarkModeMitigation(doc);
  reapplyImageAnchorMap(doc, imageAnchorMap);

  // 5. Serialize
  let output = dom.serialize();

  // 6. Restore HubL tokens
  output = restoreHubl(output, tokens);

  // 7. Validate
  const outDom = new JSDOM(output, { contentType: 'text/html' });
  const validation = validate(imageAnchorMap, outDom.window.document, strict);

  if (strict && !validation.passed) {
    const err = new Error('Strict validation failed:\n' +
      validation.errors.map(e => JSON.stringify(e)).join('\n'));
    err.validation = validation;
    throw err;
  }

  return { output, validation };
}

module.exports = { convert, suspiciousHrefs, buildImageAnchorMap, validate };
