const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// predist: starting

function tryKill(processName) {
  try {
    if (process.platform === 'win32') {
      // try taskkill
  execSync(`taskkill /IM "${processName}" /F /T`, { stdio: 'ignore' });
    } else {
  execSync(`pkill -f ${processName}`, { stdio: 'ignore' });
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
    }
} catch (err) {
  // ignore cleanup errors
}

// predist: done
