'use strict';
const { JSDOM } = require('jsdom');
const { convert, suspiciousHrefs, buildImageAnchorMap } = require('../src/converter');

// ─── Helper ────────────────────────────────────────────────────────────────
function dom(html) {
  return new JSDOM(html, { contentType: 'text/html' }).window.document;
}

// ─── 1. Anchor+image href preservation ────────────────────────────────────
test('preserves <a><img></a> href mapping — single image', () => {
  const input = `<html><body>
    <a href="https://example.com/page"><img src="https://cdn.example.com/img.jpg" width="600"></a>
  </body></html>`;
  const { output } = convert(input, { strict: true });
  const doc = dom(output);
  const img = doc.querySelector('img[src="https://cdn.example.com/img.jpg"]');
  expect(img).not.toBeNull();
  expect(img.parentElement.tagName.toLowerCase()).toBe('a');
  expect(img.parentElement.getAttribute('href')).toBe('https://example.com/page');
});

test('preserves multiple <a><img> href mappings', () => {
  const pairs = [
    ['https://cdn.example.com/a.jpg', 'https://example.com/a'],
    ['https://cdn.example.com/b.jpg', 'https://example.com/b'],
    ['https://cdn.example.com/c.jpg', 'https://example.com/c'],
  ];
  const imgs = pairs.map(([src, href]) =>
    `<a href="${href}"><img src="${src}" width="200"></a>`
  ).join('\n');
  const input = `<html><body><table><tr><td>${imgs}</td></tr></table></body></html>`;
  const { output } = convert(input, { strict: true });
  const doc = dom(output);
  for (const [src, expectedHref] of pairs) {
    const img = doc.querySelector(`img[src="${src}"]`);
    expect(img).not.toBeNull();
    expect(img.parentElement.tagName.toLowerCase()).toBe('a');
    expect(img.parentElement.getAttribute('href')).toBe(expectedHref);
  }
});

// ─── 2. No href should equal img src unless it did in input ───────────────
test('does not auto-link images to their own src', () => {
  const input = `<html><body><img src="https://cdn.example.com/hero.jpg" width="600"></body></html>`;
  const { output } = convert(input, { strict: true });
  const doc = dom(output);
  const img = doc.querySelector('img[src="https://cdn.example.com/hero.jpg"]');
  expect(img).not.toBeNull();
  const parent = img.parentElement;
  if (parent && parent.tagName.toLowerCase() === 'a') {
    expect(parent.getAttribute('href')).not.toBe('https://cdn.example.com/hero.jpg');
  }
});

test('preserves href=src when it was that way in input', () => {
  const src = 'https://cdn.example.com/photo.jpg';
  const input = `<html><body><a href="${src}"><img src="${src}" width="300"></a></body></html>`;
  const { output } = convert(input, { strict: true });
  const doc = dom(output);
  const img = doc.querySelector(`img[src="${src}"]`);
  expect(img.parentElement.getAttribute('href')).toBe(src);
});

// ─── 3. Suspicious href detection ─────────────────────────────────────────
test('detects www.. as suspicious', () => {
  const warnings = suspiciousHrefs(['https://www..example.com/page']);
  expect(warnings.some(w => w.reason.includes('www..'))).toBe(true);
});

test('detects .com.com as suspicious', () => {
  const warnings = suspiciousHrefs(['https://example.com.com/page']);
  expect(warnings.some(w => w.reason.includes('.com.com'))).toBe(true);
});

test('detects image extension href as suspicious', () => {
  const warnings = suspiciousHrefs(['https://cdn.example.com/image.png']);
  expect(warnings.some(w => w.reason.includes('image extension'))).toBe(true);
});

test('detects HubSpot file host as suspicious', () => {
  const warnings = suspiciousHrefs(['https://hs-fs/hubfs/image.jpg']);
  expect(warnings.some(w => w.reason.includes('HubSpot file host'))).toBe(true);
});

test('clean href produces no suspicious warnings', () => {
  const warnings = suspiciousHrefs(['https://example.com/page', 'https://another.org/path/to/page']);
  expect(warnings).toHaveLength(0);
});

// ─── 4. Button row stays 3 columns (DOM assertion) ────────────────────────
test('button row with 3 td elements is preserved', () => {
  const input = `<html><body>
    <table width="600"><tr>
      <td width="200"><a href="https://example.com/a">Button A</a></td>
      <td width="200"><a href="https://example.com/b">Button B</a></td>
      <td width="200"><a href="https://example.com/c">Button C</a></td>
    </tr></table>
  </body></html>`;
  const { output } = convert(input, { strict: true });
  const doc = dom(output);
  const rows = doc.querySelectorAll('tr');
  const buttonRow = [...rows].find(r => r.querySelectorAll('td').length === 3);
  expect(buttonRow).not.toBeUndefined();
  expect(buttonRow.querySelectorAll('td').length).toBe(3);
});

// ─── 5. HubL tokens are preserved ─────────────────────────────────────────
test('HubL tokens survive conversion unchanged', () => {
  const hublBlock = '{% if contact.email %}Hello {{ contact.firstname }}{% endif %}';
  const input = `<html><body><p>${hublBlock}</p></body></html>`;
  const { output } = convert(input, { strict: false });
  expect(output).toContain(hublBlock);
});

// ─── 6. Integration fixture — realistic HubSpot export ────────────────────
test('integration: realistic HubSpot export conversion', () => {
  const input = `<!DOCTYPE html>
<html>
<head>
  <style>
    @media only screen and (max-width:600px){
      .hse-column { display:block!important; width:100%!important; }
      .hse-column-container { display:block!important; }
    }
  </style>
</head>
<body>
  <div class="hs_cos_wrapper hs_cos_wrapper_meta_field" data-hs-cos-type="email_body">
    <table width="600" style="width:600px;">
      <tr>
        <td>
          <a href="https://www.mountainviewnissan.com/specials" data-hs-link-id="1" data-hs-link-id-v2="abc123">
            <img src="https://hs-fs/hubfs/specials-banner.jpg" width="600" style="width:600px;">
          </a>
        </td>
      </tr>
      <tr>
        <td>
          <a href="https://www.mountainviewnissan.com/inventory" data-hs-link-id="2">
            Shop Inventory
          </a>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;

  const { output, validation } = convert(input, {
    strict: true,
    stripWrappers: true,
    removeResponsiveCSS: true,
  });

  const doc = dom(output);

  // data-hs-link-id removed
  expect(output).not.toContain('data-hs-link-id');

  // Responsive media query stripped
  expect(output).not.toContain('display:block!important');

  // Image link preserved exactly
  const img = doc.querySelector('img[src="https://hs-fs/hubfs/specials-banner.jpg"]');
  expect(img).not.toBeNull();
  expect(img.parentElement.tagName.toLowerCase()).toBe('a');
  expect(img.parentElement.getAttribute('href')).toBe('https://www.mountainviewnissan.com/specials');

  // Non-image link preserved
  const links = [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  expect(links).toContain('https://www.mountainviewnissan.com/inventory');

  // Validation passed (no errors)
  expect(validation.errors).toHaveLength(0);
});
