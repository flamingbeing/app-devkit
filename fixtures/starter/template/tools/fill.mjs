// A stand-in for a template's fill.mjs: just the exports starter-drift uses.
import fs from 'node:fs';
import path from 'node:path';
const KITS = { a: 'https://kit-a.example.com', b: 'https://kit-b.example.com' };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const KEEP_FILES = ['vendor.js'];
export const swapsFor = (old, app) => [[new RegExp(esc(KITS[old.kit]), 'g'), KITS[app.kit]], [new RegExp(esc(old.host), 'g'), app.host],
  [new RegExp(esc(old.name), 'g'), app.name], [new RegExp(esc(old.title), 'g'), app.title]];
export function files(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? files(dir, r) : r === 'tools/fill.mjs' ? [] : [r];
  });
}
