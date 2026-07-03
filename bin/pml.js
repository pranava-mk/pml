#!/usr/bin/env node
// pml CLI — `pml new <name>` scaffolds a deck, `pml serve [dir]` runs it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);

const HELP = `pml — presentations as plain HTML files

Usage:
  pml new <name>              Scaffold a new deck in ./<name>
  pml serve [dir] [-p port]   Serve a deck (default: current dir, port 4321)

The served deck gets: visual editor (/edit), presenter mode (/present),
comments, and live reload when any file changes — including edits made
by AI agents working in the same folder.`;

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (cmd === 'new') {
  const name = rest[0];
  if (!name) die('Usage: pml new <name>');
  const dest = path.resolve(name);
  if (fs.existsSync(dest)) die(`Refusing to overwrite existing path: ${dest}`);
  fs.cpSync(path.join(ROOT, 'templates/deck'), dest, { recursive: true });
  const metaPath = path.join(dest, 'deck.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.title = name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`Deck created: ${dest}\n\n  cd ${name} && pml serve\n`);
} else if (cmd === 'serve') {
  let port = 4321;
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-p' || rest[i] === '--port') port = Number(rest[++i]);
    else args.push(rest[i]);
  }
  const dir = args[0] || '.';
  startServer({ deckDir: dir, port })
    .then(({ port, deckDir }) => {
      console.log(`\n  pml serving ${deckDir}`);
      console.log(`  ▸ overview   http://localhost:${port}/`);
      console.log(`  ▸ present    http://localhost:${port}/present`);
      console.log(`\n  Edit slide files in any editor or AI agent — browser reloads live.\n`);
    })
    .catch((e) => die(e.message));
} else {
  console.log(HELP);
  process.exit(cmd ? 1 : 0);
}
