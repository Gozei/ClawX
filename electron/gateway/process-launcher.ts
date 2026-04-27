import { app, utilityProcess } from 'electron';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import type { GatewayLaunchContext } from './config-sync';
import type { GatewayLifecycleState } from './process-policy';
import { DEFAULT_BRANDING } from '../../shared/branding';
import { logger } from '../utils/logger';
import { appendNodeRequireToNodeOptions } from '../utils/paths';

export function getGatewayFetchPreloadSource(requestTitle: string): string {
  return `'use strict';
(function () {
  function isPowerShellExecutable(command) {
    if (typeof command !== 'string') return false;
    var normalized = command.replace(/\\\\/g, '/').toLowerCase();
    var base = normalized.slice(normalized.lastIndexOf('/') + 1);
    return base === 'powershell' || base === 'powershell.exe' || base === 'pwsh' || base === 'pwsh.exe';
  }

  function findArgIndex(argv, names) {
    if (!Array.isArray(argv)) return -1;
    for (var i = 0; i < argv.length; i++) {
      var value = typeof argv[i] === 'string' ? argv[i].toLowerCase() : '';
      if (names.indexOf(value) !== -1) return i;
    }
    return -1;
  }

  function encodePowerShellCommand(command) {
    return Buffer.from(command, 'utf16le').toString('base64');
  }

  function decodePowerShellCommand(command) {
    return Buffer.from(command, 'base64').toString('utf16le');
  }

  function ensurePowerShellUtf8Args(command, argv) {
    if (!isPowerShellExecutable(command) || !Array.isArray(argv)) return argv;

    var prefix = '[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);'
      + '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'
      + '$OutputEncoding=[Text.UTF8Encoding]::new($false);';
    var encodedIndex = findArgIndex(argv, ['-encodedcommand', '-enc', '-e']);
    if (encodedIndex >= 0 && typeof argv[encodedIndex + 1] === 'string') {
      try {
        var decoded = decodePowerShellCommand(argv[encodedIndex + 1]);
        if (decoded.indexOf('[Console]::OutputEncoding') === -1) {
          var nextEncodedArgs = argv.slice();
          nextEncodedArgs[encodedIndex + 1] = encodePowerShellCommand(prefix + decoded);
          return nextEncodedArgs;
        }
      } catch (e) {
        return argv;
      }
    }

    var commandIndex = findArgIndex(argv, ['-command', '-c']);
    if (commandIndex >= 0 && typeof argv[commandIndex + 1] === 'string') {
      if (argv[commandIndex + 1].indexOf('[Console]::OutputEncoding') !== -1) return argv;
      var nextCommandArgs = argv.slice();
      nextCommandArgs[commandIndex + 1] = prefix + nextCommandArgs[commandIndex + 1];
      return nextCommandArgs;
    }

    return argv;
  }

  function ensureUtf8ChildEnv(options) {
    var next = options && typeof options === 'object' ? Object.assign({}, options) : {};
    next.env = Object.assign({}, process.env, next.env || {}, {
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      LC_CTYPE: 'C.UTF-8'
    });
    return next;
  }

  var _f = globalThis.fetch;
  if (typeof _f === 'function' && !globalThis.__clawxFetchPatched) {
    globalThis.__clawxFetchPatched = true;

    globalThis.fetch = function clawxFetch(input, init) {
      var url =
        typeof input === 'string' ? input
          : input && typeof input === 'object' && typeof input.url === 'string'
            ? input.url : '';

    // The Gateway boot path warms a model-pricing cache from OpenRouter's
    // public catalog. In this app's Windows dev environment that fetch can
    // hang badly enough to delay or destabilize the local Gateway handshake.
    // Returning an empty catalog keeps chat startup responsive; pricing can
    // still fall back to local model metadata where available.
      if (url.indexOf('openrouter.ai/api/v1/models') !== -1) {
        if (typeof globalThis.Response === 'function') {
          return Promise.resolve(new globalThis.Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
      }

      if (url.indexOf('openrouter.ai') !== -1) {
        init = init ? Object.assign({}, init) : {};
        var prev = init.headers;
        var flat = {};
        if (prev && typeof prev.forEach === 'function') {
          prev.forEach(function (v, k) { flat[k] = v; });
        } else if (prev && typeof prev === 'object') {
          Object.assign(flat, prev);
        }
        delete flat['http-referer'];
        delete flat['HTTP-Referer'];
        delete flat['x-title'];
        delete flat['X-Title'];
        flat['HTTP-Referer'] = 'https://claw-x.com';
        flat['X-Title'] = ${JSON.stringify(requestTitle)};
        init.headers = flat;
      }
      return _f.call(globalThis, input, init);
    };
  }

  if (process.platform === 'win32') {
    try {
      var cp = require('child_process');
      if (!cp.__clawxPatched) {
        cp.__clawxPatched = true;
        ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync'].forEach(function(method) {
          var original = cp[method];
          if (typeof original !== 'function') return;
          cp[method] = function() {
            var args = Array.prototype.slice.call(arguments);
            if ((method === 'spawn' || method === 'execFile' || method === 'spawnSync' || method === 'execFileSync')
              && Array.isArray(args[1])) {
              args[1] = ensurePowerShellUtf8Args(args[0], args[1]);
            }
            var optIdx = -1;
            for (var i = 1; i < args.length; i++) {
              var a = args[i];
              if (a && typeof a === 'object' && !Array.isArray(a)) {
                optIdx = i;
                break;
              }
            }
            if (optIdx >= 0) {
              args[optIdx] = ensureUtf8ChildEnv(args[optIdx]);
              args[optIdx].windowsHide = true;
            } else {
              var opts = ensureUtf8ChildEnv({ windowsHide: true });
              if (typeof args[args.length - 1] === 'function') {
                args.splice(args.length - 1, 0, opts);
              } else {
                args.push(opts);
              }
            }
            return original.apply(this, args);
          };
        });
      }
    } catch (e) {
      // ignore
    }
  }
})();
`;
}

function ensureGatewayFetchPreload(): string {
  const dest = path.join(app.getPath('userData'), 'gateway-fetch-preload.cjs');
  try {
    writeFileSync(dest, getGatewayFetchPreloadSource(DEFAULT_BRANDING.requestTitle), 'utf-8');
  } catch {
    // best-effort
  }
  return dest;
}

export async function launchGatewayProcess(options: {
  port: number;
  launchContext: GatewayLaunchContext;
  sanitizeSpawnArgs: (args: string[]) => string[];
  getCurrentState: () => GatewayLifecycleState;
  getShouldReconnect: () => boolean;
  onStdoutLine?: (line: string) => void;
  onStderrLine: (line: string) => void;
  onSpawn: (pid: number | undefined) => void;
  onExit: (child: Electron.UtilityProcess, code: number | null) => void;
  onError: (error: Error) => void;
}): Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }> {
  const {
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
    discoverySummary,
  } = options.launchContext;

  logger.info(
    `Starting Gateway process (mode=${mode}, port=${options.port}, entry="${entryScript}", args="${options.sanitizeSpawnArgs(gatewayArgs).join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'}, providerKeys=${loadedProviderKeyCount}, channels=${channelStartupSummary}, discovery=${discoverySummary}, proxy=${proxySummary})`,
  );
  const lastSpawnSummary = `mode=${mode}, entry="${entryScript}", args="${options.sanitizeSpawnArgs(gatewayArgs).join(' ')}", cwd="${openclawDir}"`;

  const runtimeEnv = { ...forkEnv };
  let forkExecArgv: string[] = [];
  try {
    const preloadPath = ensureGatewayFetchPreload();
    if (existsSync(preloadPath)) {
      if (app.isPackaged) {
        forkExecArgv = ['--require', preloadPath];
      } else {
        runtimeEnv.NODE_OPTIONS = appendNodeRequireToNodeOptions(
          runtimeEnv.NODE_OPTIONS,
          preloadPath,
        );
      }
    }
  } catch (err) {
    logger.warn('Failed to set up OpenRouter headers preload:', err);
  }

  return await new Promise<{ child: Electron.UtilityProcess; lastSpawnSummary: string }>((resolve, reject) => {
    const child = utilityProcess.fork(entryScript, gatewayArgs, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: runtimeEnv as NodeJS.ProcessEnv,
      serviceName: 'OpenClaw Gateway',
      execArgv: forkExecArgv,
    });

    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve({ child, lastSpawnSummary });
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.on('error', (error) => {
      const normalizedError = new Error(String(error));
      logger.error('Gateway process spawn error:', normalizedError);
      options.onError(normalizedError);
      rejectOnce(normalizedError);
    });

    child.on('exit', (code: number) => {
      // Only check shouldReconnect — not current state.  On Windows the WS
      // close handler fires before the process exit handler and sets state to
      // 'stopped', which would make an unexpected crash look like a planned
      // shutdown in logs.  shouldReconnect is the reliable indicator: stop()
      // sets it to false (expected), crashes leave it true (unexpected).
      const expectedExit = !options.getShouldReconnect();
      if (expectedExit) {
        logger.info(`Gateway process exited (code=${code}, expected=yes)`);
      } else {
        logger.warn(`Gateway process exited (code=${code}, expected=no)`);
      }
      options.onExit(child, code);
    });

    child.stderr?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        options.onStderrLine(line);
      }
    });

    child.stdout?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        options.onStdoutLine?.(line);
      }
    });

    child.on('spawn', () => {
      logger.info(`Gateway process started (pid=${child.pid})`);
      options.onSpawn(child.pid);
      resolveOnce();
    });
  });
}
