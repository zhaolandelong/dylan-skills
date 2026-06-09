import fs from 'node:fs/promises';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import qrcodeTerminal from 'qrcode-terminal';

export async function decodeQrTextFromPng(pngPath) {
  const buf = await fs.readFile(pngPath);
  const png = PNG.sync.read(buf);
  const rgba = new Uint8ClampedArray(png.data);
  const decoded = jsQR(rgba, png.width, png.height, {
    inversionAttempts: 'attemptBoth'
  });

  const text = String(decoded?.data || '').trim();
  if (!text) {
    throw new Error(`无法从 PNG 识别二维码: ${pngPath}`);
  }
  return text;
}

export async function renderTerminalQrFromText(text, { small = true } = {}) {
  const value = String(text || '').trim();
  if (!value) return '';

  return await new Promise((resolve) => {
    qrcodeTerminal.generate(value, { small }, (out) => {
      resolve(String(out || ''));
    });
  });
}

export async function renderTerminalQrFromPng(pngPath, options) {
  const text = await decodeQrTextFromPng(pngPath);
  return await renderTerminalQrFromText(text, options);
}
