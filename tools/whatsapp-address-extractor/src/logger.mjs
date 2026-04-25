import fs from 'node:fs';
import path from 'node:path';

export function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const logfile = path.join(logDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  return {
    info(msg, data) {
      write('INFO', msg, data);
    },
    warn(msg, data) {
      write('WARN', msg, data);
    },
    error(msg, data) {
      write('ERROR', msg, data);
    },
    logfile,
  };

  function write(level, msg, data) {
    const payload = {
      ts: new Date().toISOString(),
      level,
      msg,
      data: data ?? null,
    };
    const line = JSON.stringify(payload);
    console.log(line);
    fs.appendFileSync(logfile, line + '\n');
  }
}
