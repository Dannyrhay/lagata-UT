import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('spectator sharing excludes private administrator credentials', async () => {
  const source = await readFile(new URL('../components/tournament-access.tsx', import.meta.url), 'utf8');
  assert.match(source, /encodeURIComponent\(id\)/);
  assert.doesNotMatch(source, /location\.hash|editToken|#admin=/);
  assert.match(source, /QRCodeSVG value=\{url\}/);
  assert.match(source, /id && isAdmin &&/);
});

test('tournament controls retain accessible navigation and unsaved-change guards', async () => {
  const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /TournamentTabs\.List className="tabs" aria-label="Tournament views"/);
  assert.match(source, /SettingsDialog\.Content[^>]+aria-labelledby="setup-title"/);
  assert.match(source, /rememberTournament\(activeId, selected\.name\)/);
  assert.match(source, /Save or resolve current changes before switching tournaments/);
  assert.match(source, /individual revocation is not supported yet/);
});
