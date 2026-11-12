// Merges data/rules/*.json into one list of cards, giving each card its file's topic.
import { readdirSync, readFileSync } from 'node:fs';

export function loadRules(root) {
  const dir = new URL('data/rules/', root);
  const cards = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const file = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    for (const c of file.cards) cards.push({ topic: file.topic, products: [], aliases: [], see: [], ...c, file: f });
  }
  return cards;
}
