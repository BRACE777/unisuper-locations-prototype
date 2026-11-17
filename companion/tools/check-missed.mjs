// Re-runs searches exported from the page's "Missed searches" list against the current search, so you
// can see which ones the latest aliases and glossary phrases now answer.
// Run (after a build): node companion/tools/check-missed.mjs path/to/missed-searches-YYYY-MM-DD.json
// Keep exported files in companion/feedback/ (git-ignored): they hold what consultants typed on calls.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2];
if (!file) { console.error('Usage: node companion/tools/check-missed.mjs <missed-searches.json>'); process.exit(1); }
const root = new URL('../', import.meta.url);
const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('src/search.js', root), 'utf8'), ctx);
const engine = vm.runInContext('CompanionSearch', ctx).create(JSON.parse(readFileSync(new URL('dist/companion-data.json', root), 'utf8')));
const { missed = [] } = JSON.parse(readFileSync(file, 'utf8'));

for (const m of missed) {
  const now = engine.search(m.q).results.slice(0, 3).map((r) => r.type + ':' + r.id);
  const changed = now.join() !== (m.top || []).join();
  console.log(`${changed ? 'CHANGED' : 'same   '}  "${m.q}"${m.wanted ? `  (wanted: ${m.wanted})` : ''}\n         then: ${(m.top || []).join(', ') || 'nothing'}\n         now:  ${now.join(', ') || 'nothing'}`);
}
console.log(`\n${missed.length} missed searches. To fix one: add the member's wording as an alias on the right card (or a glossary phrase), and a case in test/search-cases.json.`);
