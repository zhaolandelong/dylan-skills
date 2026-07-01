import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeasonArchivesApiUrl,
  pickBiliContentMode,
} from '../skills/dylan-bili-to-md/scripts/bili_to_txt.mjs';
import {
  isProbablyBilibiliCollectionUrl,
  isProbablyBilibiliCheeseUrl,
  parseBilibiliCheeseUrl,
  parseBilibiliCollectionUrl,
} from '../skills/dylan-bili-to-md/scripts/core.mjs';

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

test('isProbablyBilibiliCollectionUrl detects season urls', () => {
  assert.equal(
    isProbablyBilibiliCollectionUrl('https://space.bilibili.com/504934876/lists/7638935'),
    true
  );
  assert.equal(
    isProbablyBilibiliCollectionUrl('https://www.bilibili.com/video/BV1qh7b6xEAH'),
    false
  );
});

test('parseBilibiliCollectionUrl extracts mid and season id', () => {
  assert.deepEqual(
    parseBilibiliCollectionUrl('https://space.bilibili.com/504934876/lists/7638935'),
    { mid: 504934876, seasonId: 7638935 }
  );
});

test('isProbablyBilibiliCheeseUrl detects cheese ep/ss urls', () => {
  assert.equal(isProbablyBilibiliCheeseUrl('https://www.bilibili.com/cheese/play/ep6902'), true);
  assert.equal(isProbablyBilibiliCheeseUrl('https://www.bilibili.com/cheese/play/ss61'), true);
  assert.equal(isProbablyBilibiliCheeseUrl('https://www.bilibili.com/video/BV1qh7b6xEAH'), false);
});

test('parseBilibiliCheeseUrl extracts epId or seasonId', () => {
  assert.deepEqual(parseBilibiliCheeseUrl('https://www.bilibili.com/cheese/play/ep6902'), {
    epId: 6902,
    seasonId: null,
  });
  assert.deepEqual(parseBilibiliCheeseUrl('https://www.bilibili.com/cheese/play/ss61'), {
    epId: null,
    seasonId: 61,
  });
});

test('buildSeasonArchivesApiUrl builds expected query', () => {
  const url = new URL(
    buildSeasonArchivesApiUrl({
      mid: 504934876,
      seasonId: 7638935,
      pageNum: 2,
      pageSize: 30,
    })
  );
  assert.equal(url.pathname, '/x/polymer/web-space/seasons_archives_list');
  assert.equal(url.searchParams.get('mid'), '504934876');
  assert.equal(url.searchParams.get('season_id'), '7638935');
  assert.equal(url.searchParams.get('page_num'), '2');
  assert.equal(url.searchParams.get('page_size'), '30');
});
