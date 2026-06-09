import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeQrTextFromPng, renderTerminalQrFromPng } from './qr_terminal.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const mockQrPath = path.join(skillRoot, 'login-qr.png');

test('decodeQrTextFromPng decodes mock login qr png', async () => {
  const text = await decodeQrTextFromPng(mockQrPath);
  assert.match(text, /^https:\/\/open\.weixin\.qq\.com\/connect\/confirm\?/);
  assert.match(text, /uuid=/);
});

test('renderTerminalQrFromPng renders terminal qr blocks from mock login qr png', async () => {
  const output = await renderTerminalQrFromPng(mockQrPath);
  assert.match(output, /[█▄▀]/);
  assert.ok(output.split('\n').length >= 10);
});
