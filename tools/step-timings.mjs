#!/usr/bin/env node
// Prints each job's and step's duration for a GitHub Actions run, to compare CI before and after a change.
//   node step-timings.mjs <owner/repo> <run-id>        (GITHUB_TOKEN optional for public repos; set it for private ones)
const [repo, run] = process.argv.slice(2);
if (!repo || !run) { console.error('usage: step-timings.mjs <owner/repo> <run-id>'); process.exit(2); }
const headers = { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${run}/jobs?per_page=100`, { headers });
if (!r.ok) { console.error(`GitHub said ${r.status}`); process.exit(1); }
const secs = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 1000) : 0;
for (const j of (await r.json()).jobs) {
  console.log(`${j.name}: ${secs(j.started_at, j.completed_at)}s (${j.conclusion})`);
  for (const s of j.steps) if (secs(s.started_at, s.completed_at) >= 2) console.log(`  ${String(secs(s.started_at, s.completed_at)).padStart(4)}s  ${s.name}`);
}
