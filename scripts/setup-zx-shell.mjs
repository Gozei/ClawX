import { usePowerShell } from 'zx';

if (process.platform === 'win32') {
  usePowerShell();
}
