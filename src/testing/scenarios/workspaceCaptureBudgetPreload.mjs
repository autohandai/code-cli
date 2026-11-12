import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const originalExecFile = childProcess.execFile;
childProcess.execFile = (command, args, options, callback) => {
  if (command === 'git' && Array.isArray(args) && args[0] === 'add'
    && options?.env?.GIT_INDEX_FILE?.includes('autohand-change-index-')) {
    return originalExecFile(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options, callback);
  }
  return originalExecFile(command, args, options, callback);
};
syncBuiltinESMExports();
