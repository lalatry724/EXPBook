'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// 建一個臨時 EXPBOOK_HOME，回傳路徑；呼叫端負責清理
function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expbook-test-'));
  return dir;
}

// 建一個臨時 projects root，寫入指定的 transcript 檔
// sessions: [{ proj, file, lines: [obj,...] }]
function tmpProjects(sessions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expbook-proj-'));
  for (const s of sessions) {
    const dir = path.join(root, s.proj);
    fs.mkdirSync(dir, { recursive: true });
    const body = s.lines.map((o) => JSON.stringify(o)).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, s.file), body);
  }
  return root;
}

// 組一筆 assistant transcript 訊息（帶 usage + model + timestamp）
function asstMsg(ts, model, { in: i = 0, out = 0, cc = 0, cr = 0 } = {}) {
  return { type: 'assistant', timestamp: ts, message: {
    role: 'assistant', model,
    usage: { input_tokens: i, output_tokens: out, cache_creation_input_tokens: cc, cache_read_input_tokens: cr },
  } };
}

// 組一筆 user transcript 訊息（純文字 or tool_result）
function userMsg(ts, text) {
  return { type: 'user', timestamp: ts, message: { role: 'user', content: text } };
}
function toolResultMsg(ts) {
  return { type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } };
}

function rm(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

module.exports = { tmpHome, tmpProjects, asstMsg, userMsg, toolResultMsg, rm };
