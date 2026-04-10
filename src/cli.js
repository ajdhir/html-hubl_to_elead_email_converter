#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { convert } = require('./converter');

const args = process.argv.slice(2);

function arg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}
function flag(name) {
  return args.includes(name);
}

const inFile   = arg('--in');
const outFile  = arg('--out');
const useStdin = flag('--stdin');
const strict   = flag('--strict');
const noWrap   = flag('--no-strip-wrappers');
const noResp   = flag('--no-remove-responsive');

if (!inFile && !useStdin) {
  console.error('Usage: email-convert --in input.html --out output.html [--strict]');
  console.error('       email-convert --stdin --out output.html [--strict]');
  process.exit(1);
}
if (!outFile) {
  console.error('Error: --out is required.');
  process.exit(1);
}

let html;
if (useStdin) {
  html = fs.readFileSync('/dev/stdin', 'utf8');
} else {
  html = fs.readFileSync(path.resolve(inFile), 'utf8');
}

let result;
try {
  result = convert(html, {
    strict,
    stripWrappers: !noWrap,
    removeResponsiveCSS: !noResp,
  });
} catch (err) {
  console.error('Conversion failed:', err.message);
  if (err.validation) {
    console.error('Validation errors:');
    for (const e of err.validation.errors) console.error(' -', JSON.stringify(e));
  }
  process.exit(1);
}

fs.writeFileSync(path.resolve(outFile), result.output, 'utf8');

const { errors, warnings } = result.validation;
if (errors.length === 0) {
  console.log('✔ Validation PASSED');
} else {
  console.warn(`⚠ ${errors.length} validation error(s):`);
  for (const e of errors) console.warn(' -', JSON.stringify(e));
}
if (warnings.length) {
  console.warn(`⚠ ${warnings.length} suspicious link(s):`);
  for (const w of warnings) console.warn(` - ${w.href} [${w.reason}]`);
}
console.log(`Output written to: ${outFile}`);
process.exit(errors.length && strict ? 1 : 0);
