import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBiliContentMode } from '../skills/dylan-bili-to-md/scripts/bili_to_txt.mjs';

test('pickBiliContentMode prefers subtitle when subtitle url exists', () => {
  assert.equal(
    pickBiliContentMode({
      pickedSubtitle: { url: 'https://example.com/subtitle.json' },
      asrBaseUrl: 'http://100.110.240.36:8103',
    }),
    'subtitle'
  );
});

test('pickBiliContentMode can force asr when preferAsr is enabled', () => {
  assert.equal(
    pickBiliContentMode({
      pickedSubtitle: { url: 'https://example.com/subtitle.json' },
      asrBaseUrl: 'http://100.110.240.36:8103',
      preferAsr: true,
    }),
    'asr'
  );
});

test('pickBiliContentMode falls back to asr when subtitle missing and asr configured', () => {
  assert.equal(
    pickBiliContentMode({
      pickedSubtitle: null,
      asrBaseUrl: 'http://100.110.240.36:8103',
    }),
    'asr'
  );
});

test('pickBiliContentMode returns none when subtitle missing and asr not configured', () => {
  assert.equal(
    pickBiliContentMode({
      pickedSubtitle: null,
      asrBaseUrl: '',
    }),
    'none'
  );
});
