// npm start launches Python; FastAPI serves both the frontend and the API.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.PYTHON || (existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3');
export function startBackend({ port = process.env.PORT || '3000', stdio = 'inherit' } = {}) {
  return spawn(python, ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root, stdio, windowsHide: true
  });
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const child = startBackend();
  let stopping = false;
  child.on('error', error => {
    console.error(`Could not start Python: ${error.message}\nCreate .venv and install requirements.txt (see README.md).`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (code && !stopping) console.error('Backend stopped. Check the error above; install dependencies with your .venv Python: -m pip install -r requirements.txt');
    process.exitCode = stopping ? 0 : code ?? (signal ? 1 : 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopping = true;
      if (child.exitCode === null) child.kill(signal);
    });
  }
}
