import { PROMPT_VERSION, DEFAULT_MODEL } from './analyzeGame.js';

const MIGRATION_KEY = 'kibitz-migration-version';
const CURRENT_VERSION = 1;

export function runMigrations() {
  let lastRun = 0;
  try { lastRun = parseInt(localStorage.getItem(MIGRATION_KEY) ?? '0', 10); } catch {}
  if (isNaN(lastRun) || lastRun >= CURRENT_VERSION) return;

  if (lastRun < 1) migration1_removeUnversionedEvals();

  try { localStorage.setItem(MIGRATION_KEY, String(CURRENT_VERSION)); } catch {}
}

// Remove old kibitz-evals-{gameId} keys (no version suffix).
// New format: kibitz-evals-{gameId}-{promptVersion}-{model} (contains PROMPT_VERSION).
function migration1_removeUnversionedEvals() {
  const toDelete = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('kibitz-evals-') && !key.includes(PROMPT_VERSION)) {
        toDelete.push(key);
      }
    }
  } catch {}
  for (const key of toDelete) {
    if (import.meta.env?.DEV) console.log('[kibitz] migration: removing orphaned key:', key);
    try { localStorage.removeItem(key); } catch {}
  }
}

export function evalsKey(gameId) {
  return `kibitz-evals-${gameId}-${PROMPT_VERSION}-${DEFAULT_MODEL}`;
}

export function perMoveKey(gameId, ply, tone, perspective) {
  const p = perspective ?? 'none';
  return `kibitz-analysis-move-${gameId}-${ply}-${tone}-${p}-${PROMPT_VERSION}-${DEFAULT_MODEL}`;
}
