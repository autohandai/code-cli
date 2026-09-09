import path from 'node:path';
import { ResourceCoordinator } from '../../session/peers/ResourceCoordinator.js';
import { withCommandCoordination } from '../../session/peers/CommandCoordinationGate.js';
import { executeStreamingShellCommand } from '../../ui/shellCommand.js';

const directory = process.argv[2];
if (!directory) throw new Error('A fixture directory is required.');
const coordinator = new ResourceCoordinator({ directory, principal: { peerId: 'worker', instanceId: 'worker' }, canControl: false, isPrincipalAlive: async () => true });
try {
  const marker = path.join(directory, 'pty-marker');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const result = await withCommandCoordination({ coordinator, waitTimeoutMs: 10_000,
    onWaiting: activity => console.log(`WAITING_RESOURCE ${activity.requestId}`),
    onRecoveryRequired: error => console.log(`RECOVERY ${error.message}`),
  }, () => executeStreamingShellCommand(`touch ${quote(marker)}; printf 'PTY command output'`, directory, { preferPty: true, onStdout: text => process.stdout.write(text) }));
  console.log(`RESULT ${JSON.stringify(result)}`);
} finally { await coordinator.close(); }
