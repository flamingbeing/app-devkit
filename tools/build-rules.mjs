#!/usr/bin/env node
// Builds firestore.rules from an app's rules file plus the kit's rules/common.rules. Firestore rules have no
// imports, so the shared helpers are pasted in where the app file has a line `// devkit:common`, indented to match.
//
//   node build-rules.mjs <app.rules> [out.rules] [--common <file>] [--check]
//
// out defaults to the app file with `.app.rules` -> `.rules`. --check writes nothing and fails when out is stale.
// Commit the built file: deploys and the emulator then see exactly what ships.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = /^([ \t]*)\/\/ devkit:common[ \t]*$/;
export const defaultCommon = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'common.rules');

export function buildRules(appText, commonText, source = 'firestore.app.rules') {
  const lines = appText.split('\n');
  const hits = lines.map((l, i) => [l.match(MARKER), i]).filter(([m]) => m);
  if (hits.length !== 1) throw new Error(`${source}: expected one "// devkit:common" line, found ${hits.length}`);
  const [[m, at]] = hits;
  const pad = m[1];
  const common = commonText.replace(/\n+$/, '').split('\n').map((l) => (l ? pad + l : l));
  const header = `// Built by app-devkit tools/build-rules.mjs from ${source} and rules/common.rules. Edit those, then rebuild.`;
  return [header, ...lines.slice(0, at), ...common, ...lines.slice(at + 1)].join('\n');
}

function main(argv) {
  const args = [...argv];
  const flag = (f) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
  const opt = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const check = flag('--check');
  const commonPath = opt('--common') ?? defaultCommon;
  const [appPath, outArg] = args;
  if (!appPath) { console.error('usage: build-rules.mjs <app.rules> [out.rules] [--common <file>] [--check]'); return 2; }
  const out = outArg ?? appPath.replace(/\.app\.rules$/, '.rules');
  if (out === appPath) { console.error(`${appPath}: name it *.app.rules or pass the output path`); return 2; }
  const built = buildRules(readFileSync(appPath, 'utf8'), readFileSync(commonPath, 'utf8'), basename(appPath));
  if (check) {
    if (existsSync(out) && readFileSync(out, 'utf8') === built) { console.log(`${out} is up to date`); return 0; }
    console.error(`${out} is out of date: run node build-rules.mjs ${appPath}${outArg ? ' ' + outArg : ''}`);
    return 1;
  }
  writeFileSync(out, built);
  console.log(`wrote ${out}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
