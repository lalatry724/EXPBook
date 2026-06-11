#!/usr/bin/env node
'use strict';
// ExpBook Stop hook：C) 沖刷 _pending 進 log；A) 非阻擋安全網（有新 commit 但本輪沒記 → 留提醒）
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
const cwd = input.cwd || process.cwd();

// 跟著「本 hook 所在的 CLI home」載入 exp.cjs（.claude 或 .gemini），雙 CLI 各自獨立。
const expPath = path.join(__dirname, '..', 'skills', 'ExpBook', 'scripts', 'exp.cjs');
let exp;
try { exp = require(expPath); } catch { process.exit(0); } // ExpBook 未安裝 → 不干擾

const p = exp.paths();
let flushed = 0;
try { flushed = exp.flushPending(p); } catch {}

// A：非阻擋。有新近 commit 但本輪沒記任何東西 → 留一次性提醒給下一輪
if (flushed === 0) {
  let head = '';
  try { head = execSync('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  if (head) {
    const seenFile = path.join(p.base, '_seen_commits.json');
    let seen = [];
    try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch {}
    if (!seen.includes(head)) {
      let recent = false;
      try {
        const ct = execSync(`git show -s --format=%ct ${head}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        recent = (Date.now() / 1000 - Number(ct)) < 600; // 10 分鐘內
      } catch {}
      seen.push(head); if (seen.length > 200) seen = seen.slice(-200);
      try { fs.mkdirSync(p.base, { recursive: true }); fs.writeFileSync(seenFile, JSON.stringify(seen)); } catch {}
      if (recent) {
        try { fs.writeFileSync(path.join(p.base, '_reminder.txt'), `[ExpBook] 上輪有新 commit (${head.slice(0, 7)}) 但未記 EXP；若完成了任務，請用 exp.cjs stage 補記。`); } catch {}
      }
    }
  }
}
process.exit(0);
