# HTML+HubL → eLead Email Converter

Converts HubSpot-exported email HTML (including HubL tokens) into an eLead-safe HTML file. Preserves layout, fonts, colors, and — most critically — all original link hrefs, including image clickthrough URLs.

## Features

- Preserves `<a><img></a>` href mappings byte-for-byte
- Strips HubSpot wrapper elements and tracking attributes (`data-hs-link-id`, etc.)
- Removes responsive/stacking media queries while keeping the 600px fixed layout
- Adds dark mode mitigation meta tags and override styles
- Detects suspicious hrefs (`.com.com`, `www..`, image extensions, HubSpot file hosts)
- Strict validation mode: non-zero exit on any link mapping failure

## Run locally

```bash
npm install
npm start
# Open http://localhost:3000
```

## CLI

```bash
# Install globally (from repo root)
npm link

# Convert a file
email-convert --in input.html --out output.html --strict

# From stdin
cat input.html | email-convert --stdin --out output.html --strict
```

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--in <file>` | — | Input HTML file path |
| `--stdin` | — | Read input from stdin |
| `--out <file>` | — | Output file path (required) |
| `--strict` | off | Exit non-zero if validation errors found |
| `--no-strip-wrappers` | off | Skip unwrapping HubSpot wrapper divs |
| `--no-remove-responsive` | off | Skip stripping responsive media queries |

## Strict validation

With `--strict` (or Strict Mode toggle in the UI), the converter:

1. Builds a map of every `<a href>` that directly wraps an `<img src>` in the input: `imgSrc → href`.
2. After conversion, verifies each image still has the same parent `<a>` with the exact same href.
3. Fails (non-zero exit / 422 response) if:
   - Any mapped image lost its anchor tag
   - Any mapped image's href changed
   - Any image was auto-linked to its own `src` when it was not in the input

Warnings (never a hard failure) are also emitted for suspicious hrefs:
- Contains `.com.com`
- Contains `www..`
- Ends with an image extension (`.jpg`, `.png`, `.webp`, `.gif`)
- Contains a HubSpot file host (`hs-fs/hubfs`, `hs-sites`)

## Run tests

```bash
npm test
```
