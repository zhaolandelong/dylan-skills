import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAsrOptions, resolveAudioTitle } from '../skills/dylan-bili-to-md/scripts/audio_to_md.mjs';
import { isSupportedMediaFile, needsPreprocess } from '../skills/dylan-bili-to-md/scripts/media.mjs';

test('isSupportedMediaFile accepts supported media extensions', () => {
  assert.equal(isSupportedMediaFile('/tmp/a.m4s'), true);
  assert.equal(isSupportedMediaFile('/tmp/a.mp3'), true);
  assert.equal(isSupportedMediaFile('/tmp/a.wav'), true);
  assert.equal(isSupportedMediaFile('/tmp/a.mp4'), true);
  assert.equal(isSupportedMediaFile('/tmp/a.txt'), false);
});

test('needsPreprocess only returns true for m4s', () => {
  assert.equal(needsPreprocess('/tmp/a.m4s'), true);
  assert.equal(needsPreprocess('/tmp/a.mp3'), false);
  assert.equal(needsPreprocess('/tmp/a.wav'), false);
});

test('resolveAudioTitle prefers cli title and falls back to filename', () => {
  assert.equal(
    resolveAudioTitle({ cliTitle: '自定义标题', inputPath: '/tmp/demo-audio.m4s' }),
    '自定义标题'
  );
  assert.equal(resolveAudioTitle({ cliTitle: '', inputPath: '/tmp/demo-audio.m4s' }), 'demo-audio');
});

test('resolveAsrOptions merges cli values over config', () => {
  const resolved = resolveAsrOptions({
    cliValues: {
      model: 'gpt-4o-mini-transcribe',
      'base-url': 'https://asr.example.com/',
      lang: 'en'
    },
    configAsr: {
      baseUrl: 'https://old.example.com',
      apiKey: 'secret',
      model: 'whisper-1',
      language: 'zh',
      timeoutMs: 123
    }
  });

  assert.deepEqual(resolved, {
    baseUrl: 'https://asr.example.com/',
    apiKey: 'secret',
    model: 'gpt-4o-mini-transcribe',
    language: 'en',
    prompt: '',
    timeoutMs: 123
  });
});
