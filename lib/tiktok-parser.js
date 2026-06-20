'use strict';

const _NL = '\x01';

function stripEmoji(text) {
  return String(text)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu,    '')
    .replace(/[\u{2B00}-\u{2BFF}]/gu,    '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu,    '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function wrapText(text, maxCharsPerLine = 18) {
  if (text.length <= maxCharsPerLine) return text;

  const slashIdx = text.indexOf(' / ');
  if (slashIdx > 0 && slashIdx <= maxCharsPerLine + 4) {
    return text.substring(0, slashIdx) + _NL + text.substring(slashIdx + 3);
  }

  const mid = Math.floor(text.length / 2);
  let splitAt = text.lastIndexOf(' ', mid);
  if (splitAt < 5) splitAt = text.indexOf(' ', mid);
  if (splitAt < 0) return text;

  return text.substring(0, splitAt) + _NL + text.substring(splitAt + 1);
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%');
}

function parseTikTokScript(mdText) {
  const scenes = [];

  for (const line of mdText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|[-|: ]+\|$/.test(trimmed)) continue;

    const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;

    const [time, voiceover = '', visual = '', onScreen = ''] = cells;
    if (/time/i.test(time) || !time) continue;

    const m = time.match(/(\d+):(\d+)\s*[-–—~to]+\s*(\d+):(\d+)/);
    if (!m) continue;

    const startSec       = parseInt(m[1]) * 60 + parseInt(m[2]);
    const endSec         = parseInt(m[3]) * 60 + parseInt(m[4]);
    const scriptDuration = Math.max(endSec - startSec, 2);

    const cleanOnScreen = onScreen
      .replace(/\*+/g, '')
      .replace(/"/g, '')
      .replace(/^[']+|[']+$/g, '')
      .replace(/\\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    scenes.push({
      time,
      scriptDuration,
      voiceover: voiceover.trim(),
      visual: visual.trim(),
      onScreen: cleanOnScreen,
    });
  }

  return scenes;
}

module.exports = { parseTikTokScript, stripEmoji, wrapText, escapeDrawtext, _NL };
