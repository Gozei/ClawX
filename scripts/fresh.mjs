import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function resolveAppDataCandidates() {
  const home = homedir();
  const candidates = [join(home, '.openclaw')];

  if (process.platform === 'darwin') {
    candidates.push(
      join(home, 'Library', 'Application Support', 'Deep AI Worker'),
      join(home, 'Library', 'Application Support', 'clawx'),
    );
    return candidates;
  }

  if (process.platform === 'win32') {
    const roamingRoot = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    candidates.push(
      join(roamingRoot, 'Deep AI Worker'),
      join(roamingRoot, 'clawx'),
    );
    return candidates;
  }

  // Linux / other unix-like: follow Electron default appData behavior.
  candidates.push(
    join(home, '.config', 'Deep AI Worker'),
    join(home, '.config', 'clawx'),
  );
  return candidates;
}

async function removeIfExists(path) {
  if (!existsSync(path)) {
    console.log(`[skip] ${path}`);
    return;
  }
  await rm(path, { recursive: true, force: true });
  console.log(`[removed] ${path}`);
}

async function main() {
  const targets = resolveAppDataCandidates();
  console.log('Resetting local state to fresh-install baseline...');
  for (const target of targets) {
    // Sequential deletion keeps logs deterministic and easier to debug.
    await removeIfExists(target);
  }
  console.log('Done. Relaunch the app to trigger onboarding.');
}

main().catch((error) => {
  console.error('Failed to reset local state:', error);
  process.exitCode = 1;
});

