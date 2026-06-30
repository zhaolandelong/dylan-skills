import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDownloadedAudioBasename,
  extractPlayinfoFromHtml,
  pickPreferredDashAudio,
} from '../skills/dylan-bili-to-md/scripts/bili_download_audio.mjs';

test('extractPlayinfoFromHtml parses embedded json', () => {
  const html = '<script>window.__playinfo__={"data":{"dash":{"audio":[{"id":30216}]}}}</script>';
  const parsed = extractPlayinfoFromHtml(html);
  assert.deepEqual(parsed, {
    data: {
      dash: {
        audio: [{ id: 30216 }],
      },
    },
  });
});

test('pickPreferredDashAudio prefers highest bandwidth', () => {
  const picked = pickPreferredDashAudio([
    { id: 30216, bandwidth: 65561, baseUrl: 'https://example.com/30216.m4s' },
    { id: 30280, bandwidth: 100074, baseUrl: 'https://example.com/30280.m4s' },
    { id: 30232, bandwidth: 132145, baseUrl: 'https://example.com/30232.m4s' },
  ]);
  assert.equal(picked?.id, 30232);
});

test('buildDownloadedAudioBasename appends part and audio id', () => {
  assert.equal(
    buildDownloadedAudioBasename({ title: '标题', p: 2, audioId: 30280 }),
    '标题-p2-audio-30280'
  );
  assert.equal(
    buildDownloadedAudioBasename({ title: '标题', p: 1, audioId: null }),
    '标题-audio'
  );
});
