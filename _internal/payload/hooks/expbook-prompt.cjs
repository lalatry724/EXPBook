#!/usr/bin/env node
'use strict';
// ExpBook UserPromptSubmit hook：若有 Stop hook 留下的提醒，注入一次後清除
const fs = require('fs');
const path = require('path');
const os = require('os');

// 跟著「本 hook 所在的 CLI home」載入 exp.cjs（.claude 或 .gemini），雙 CLI 各自獨立。
// 本檔位於 <HOME>/hooks/expbook-prompt.cjs → exp.cjs 在 <HOME>/skills/ExpBook/scripts/。
const expPath = path.join(__dirname, '..', 'skills', 'ExpBook', 'scripts', 'exp.cjs');
let exp;
try { exp = require(expPath); } catch { process.exit(0); }

const f = path.join(exp.paths().base, '_reminder.txt');
try {
  if (fs.existsSync(f)) {
    const msg = fs.readFileSync(f, 'utf8');
    fs.unlinkSync(f);
    if (msg.trim()) process.stdout.write(msg.trim() + '\n');
  }
} catch {}
process.exit(0);
