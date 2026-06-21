'use strict';
/**
 * agent-hub/html/makrut/index.js
 * Reuses manao modules ทั้งหมด — แทนเฉพาะ title, subtitle, card-title
 */

const { getStylesBase }       = require('../manao/styles-base');
const { getStylesComponents } = require('../manao/styles-components');
const { getLayoutHeader }     = require('../manao/layout-header');
const { getLayoutModals }     = require('../manao/layout-modals');
const { getScriptsData }      = require('../manao/scripts-data');
const { getScriptsPreview }   = require('../manao/scripts-preview');
const { getScriptsLog }       = require('../manao/scripts-log');
const { getScriptsPost }      = require('../manao/scripts-post');
const { getScriptsPipeline }  = require('../manao/scripts-pipeline');
const { getScriptsActions }   = require('../manao/scripts-actions');

function patchHeader(html) {
  return html
    .replace('🍋 มะนาว — Agent Hub', '⚽ มะกรูด — Agent Hub')
    .replace('Reuters AI News Pipeline · 4 Agents', 'FIFA World Cup 2026 Pipeline · 4 Agents');
}

function buildMakrutHTML() {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>⚽ มะกรูด — Agent Hub</title>
<style>
${getStylesBase()}
${getStylesComponents()}
</style>
</head>
<body>
${patchHeader(getLayoutHeader())}
${getLayoutModals()}
<script>
${getScriptsData()}
${getScriptsPreview()}
${getScriptsLog()}
${getScriptsPost()}
${getScriptsPipeline()}
${getScriptsActions()}
</script>
</body>
</html>`;
}

module.exports = { buildMakrutHTML };
