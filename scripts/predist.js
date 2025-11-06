const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('[predist] starting');

function tryKill(processName) {
  try {
    if (process.platform === 'win32') {
      // try taskkill
      execSync(`taskkill /IM "${processName}" /F /T`, { stdio: 'ignore' });
      console.log(`[predist] killed ${processName}`);
    } else {
      execSync(`pkill -f ${processName}`, { stdio: 'ignore' });
      console.log(`[predist] pkilled ${processName}`);
    }
  } catch (e) {
    // ignore
  }
}

tryKill('electron');
tryKill('app-builder.exe');
tryKill('Calendar Widget.exe');

const distPath = path.join(__dirname, '..', 'dist');
try {
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true, force: true });
    console.log('[predist] removed dist');
  } else {
    console.log('[predist] no dist directory');
  }
} catch (err) {
  console.warn('[predist] failed to remove dist:', err.message);
}

console.log('[predist] done');
