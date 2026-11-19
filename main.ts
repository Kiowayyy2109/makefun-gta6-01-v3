// Port Aurelia — hand-in program (Node 22, standard library only).
//
// The game itself is the static site in game/ (game/index.html plus its ES
// modules; no build step, no network). This program publishes it: it copies
// game/ and screenshots/ from beside this file into the output directory and
// writes dossier.json there with the vendored make.fun library, exactly as
// the gta6-01 gate recomputes it.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// MAKEFUN_OUTPUT_DIR stands in for the grader's /output outside the grader.
// Play the game locally with `node serve.ts` (http://localhost:8080).

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The gate's own caps, passed through so this program refuses anything the
// scorer would refuse: the dossier text cap, at most 4 screenshots of at
// most 256 KiB each, and the game tree limits (files, bytes, path length).
const GATE_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

function publish() {
  mkdirSync(outputDir, { recursive: true });

  const gameSource = join(repoRoot, 'game');
  if (!existsSync(gameSource)) {
    throw new Error('game/ is missing: the entry is the static site in game/.');
  }
  cpSync(gameSource, join(outputDir, 'game'), { recursive: true });

  const shotsSource = join(repoRoot, 'screenshots');
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  if (existsSync(shotsSource)) {
    cpSync(shotsSource, join(outputDir, 'screenshots'), { recursive: true });
  }

  const dossier = buildDossier(outputDir, GATE_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
}

publish();
