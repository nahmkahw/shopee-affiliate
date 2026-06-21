'use strict';
/**
 * agent-hub/html/manao/index.js — assembles manao dashboard HTML from split modules
 * ประกอบ CSS + HTML + JS จาก 10 ไฟล์ย่อย แต่ละไฟล์ < 300 บรรทัด
 */

const { getStylesBase }        = require('./styles-base');
const { getStylesComponents }  = require('./styles-components');
const { getLayoutHeader }      = require('./layout-header');
const { getLayoutModals }      = require('./layout-modals');
const { getScriptsData }       = require('./scripts-data');
const { getScriptsPreview }    = require('./scripts-preview');
const { getScriptsLog }        = require('./scripts-log');
const { getScriptsPost }       = require('./scripts-post');
const { getScriptsPipeline }   = require('./scripts-pipeline');
const { getScriptsActions }    = require('./scripts-actions');

function buildManaoHTML() {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🍋 มะนาว — Agent Hub</title>
<style>
${getStylesBase()}
${getStylesComponents()}
</style>
</head>
<body>
${getLayoutHeader()}
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

module.exports = { buildManaoHTML };
