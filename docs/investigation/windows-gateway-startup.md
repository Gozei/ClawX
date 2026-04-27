# Windows Gateway startup investigation

This document records the investigation into slow Windows Gateway startup on the ClawX Windows startup-optimization branch.

## Background

The observed startup time was about 30 seconds before the Gateway became usable. The Electron window itself was already visible in about 1.3 to 2.1 seconds, so the perceived delay was not caused by renderer or window creation.

Representative timeline:

```text
Gateway process started                    T+0.1s
Window visible / startup-complete           T+1.3s to T+2.1s
Gateway wait-ready success                  T+21s to T+25s
Gateway connect handshake completed         T+26s to T+31s
```

## Diagnostic Method

Temporary timing probes were added during the investigation to the installed OpenClaw package under `node_modules/openclaw/dist/...`. These probes emitted `[clawx-boot]` lines for internal Gateway phases.

Important: direct edits under `node_modules` are only suitable for local diagnosis. They are not a valid fix because they will be lost after dependency install, package upgrade, or repackaging.

For a durable fix, changes must be made in one of these places:

- OpenClaw source code, then released or vendored through the normal dependency flow.
- ClawX startup code, when the issue can be solved by launch environment, arguments, proxying, or lifecycle policy.
- A formal preload/instrumentation hook owned by ClawX, if temporary diagnostics must be repeatable without modifying dependency output.

During the investigation, ClawX was also updated to capture Gateway `stdout` so `[clawx-boot]` timing lines could appear in the main app log. Without this, only Gateway `stderr` lines were visible.

## Findings

### UI startup is not the bottleneck

Windows startup monitor showed the app window becoming visible quickly:

```text
stage=window-visible elapsed=1337ms
startup-complete elapsed=1337ms
renderer-ready elapsed=1338ms
```

The slow portion is Gateway readiness and connection.

### Gateway HTTP/WS binds much earlier than ClawX reports connected

Gateway reached HTTP/WS setup around 8 to 9 seconds into `startGatewayServer`:

```text
server runtime-state:http-ready elapsed=8388ms
server ws-handlers:done elapsed=8731ms
```

However, ClawX did not complete managed Gateway startup until much later:

```text
Windows Gateway Monitor wait-ready success elapsed=24553ms
Gateway connect handshake completed
connected-managed totalElapsed=30585ms
```

This means the Gateway can bind sockets before it is responsive enough for ClawX's readiness probe and connect handshake.

### Largest blocking phase: session lock cleanup

The largest measured single phase was session lock cleanup inside `startGatewaySidecars`:

```text
sidecars:session-lock-cleanup:begin elapsed=9037ms
sidecars:session-lock-cleanup:done  elapsed=20088ms delta=11051ms dirs=1
```

This phase blocked for about 9 to 11 seconds across runs.

Local inspection found no `*.jsonl.lock` files and only a small number of session files under:

```text
C:\Users\szdee\.openclaw\agents\main\sessions
```

So the slowdown is not explained by many stale lock files. It is likely caused by the Node/Electron utility process first-touching the sessions path, Windows filesystem behavior, realpath/stat calls, antivirus/Defender interaction, or related runtime overhead.

### Second largest blocking phase: memory backend startup

The post-plugin-services tail was confirmed to be memory backend startup:

```text
sidecars:memory-backend:schedule-begin elapsed=20537ms
sidecars:memory-backend:scheduled      elapsed=25908ms delta=5371ms
```

Although the code looks like a background call:

```js
startGatewayMemoryBackend(...).catch(...)
```

the async function still executes synchronously until its first `await`. In this path it loads or resolves the memory runtime/plugin registry before yielding, blocking Gateway startup for about 5.4 seconds.

### Plugin services are not the cause

Measured plugin service startup was fast:

```text
acpx-runtime             18ms
browser-control          51ms
device-pair-notifier      8ms
phone-control-expiry      2ms
```

The `acpx` readiness probe finishes later, but service registration itself is not the main startup blocker.

### Other measured phases

Other repeatable costs:

```text
Gateway CLI/run-loop before server import       ~2.2s
server.impl import / startGatewayServer load    ~1.5s
config-snapshot                                 ~3.9s to ~4.0s
plugin-bootstrap                                ~3.4s to ~4.1s
runtime-services                                ~0.2s to ~0.3s
internal hooks                                  ~0.2s to ~0.4s
```

These are worth optimizing later, but the first-order wins are session lock cleanup and memory backend startup.

## Recommended Fixes

### 1. Move session lock cleanup out of the critical path

Current behavior blocks Gateway startup while cleaning stale session locks:

```js
const sessionDirs = await resolveAgentSessionDirs(resolveStateDir(process.env));
for (const sessionsDir of sessionDirs) {
  await cleanStaleLockFiles({ ... });
}
```

Recommended behavior:

- Do not `await` stale lock cleanup before Gateway readiness/connect.
- Schedule cleanup after the Gateway is responsive.
- Keep errors best-effort and logged.
- Consider skipping detailed cleanup when there are no `*.jsonl.lock` files, if this can be checked cheaply.

Example shape:

```js
setTimeout(() => {
  cleanupStaleSessionLocks({ cfg, log }).catch((err) => {
    log.warn(`session lock cleanup failed after startup: ${String(err)}`);
  });
}, 1000).unref?.();
```

The actual implementation should live in OpenClaw source, not in `node_modules`.

Expected improvement: about 9 to 11 seconds on the measured Windows machine.

### 2. Defer memory backend startup

Current behavior calls the async function immediately:

```js
startGatewayMemoryBackend({
  cfg,
  log,
}).catch(...);
```

Recommended behavior:

```js
setTimeout(() => {
  startGatewayMemoryBackend({
    cfg,
    log,
  }).catch((err) => {
    log.warn(`qmd memory startup initialization failed: ${String(err)}`);
  });
}, 1000).unref?.();
```

This prevents synchronous runtime/plugin loading before the first `await` from blocking Gateway connect.

Expected improvement: about 5 seconds on the measured Windows machine.

### 3. Split readiness semantics

The current Gateway log can report `ready` before post-attach sidecars finish and before ClawX completes its connect handshake.

Recommended readiness model:

- `http-ready`: HTTP/WS sockets are bound.
- `connect-ready`: Gateway can issue `connect.challenge` and complete `connect`.
- `fully-ready`: sidecars, maintenance tasks, and optional startup services have been scheduled or completed.

ClawX should use `connect-ready` for app connectivity, not optional sidecar completion.

### 4. Avoid direct dependency-output patches

Do not commit changes under:

```text
node_modules/openclaw
build/openclaw/node_modules
release/win-unpacked/resources/app.asar
```

Any lasting fix should be made in OpenClaw source and consumed by ClawX through a dependency update, patch package, or vendored source flow that is explicit and reproducible.

## Expected Result

Moving session lock cleanup and memory backend startup out of the blocking path should reduce Gateway usable time by roughly:

```text
session lock cleanup     ~9s to ~11s
memory backend startup   ~5s
total likely win         ~14s to ~16s
```

This should bring the measured 26 to 31 second Gateway startup closer to the 10 to 15 second range before addressing config snapshot and plugin bootstrap costs.

## Local OpenClaw Iteration and Debugging

The durable fix belongs in the OpenClaw source tree. ClawX can run against a local OpenClaw checkout without publishing OpenClaw to npm by setting `CLAWX_OPENCLAW_LOCAL_DIR`.

Use this workflow when a Gateway startup or runtime bug requires changes in both repositories:

```text
C:\Users\szdee\Projects\ClawX      ClawX desktop app and Gateway manager
C:\Users\szdee\Projects\openclaw   local OpenClaw source checkout
```

### 1. Build the local OpenClaw checkout

Run this after editing OpenClaw source that is compiled into `dist/entry.js`:

```powershell
cd C:\Users\szdee\Projects\openclaw
pnpm install
pnpm build
```

Run this when the Control UI assets are missing or changed:

```powershell
cd C:\Users\szdee\Projects\openclaw
pnpm ui:build
```

`pnpm build` and `pnpm ui:build` are both needed for a clean ClawX-managed Gateway startup. If `dist/control-ui/index.html` is missing, OpenClaw may try to build UI assets during Gateway startup, which can look like a Gateway readiness hang on Windows.

### 2. Point ClawX dev mode at the local OpenClaw build

Start ClawX with the override set in the same shell:

```powershell
cd C:\Users\szdee\Projects\ClawX
$env:CLAWX_OPENCLAW_LOCAL_DIR = 'C:\Users\szdee\Projects\openclaw'
pnpm dev
```

On Windows, `CLAWX_OPENCLAW_LOCAL_DIR` also accepts Git Bash/MSYS drive paths such as `/c/Users/szdee/Projects/openclaw`; ClawX normalizes them before launching the Gateway.

To remove the override in the current PowerShell session:

```powershell
Remove-Item Env:\CLAWX_OPENCLAW_LOCAL_DIR -ErrorAction SilentlyContinue
```

ClawX preflights local OpenClaw overrides before launch. If `dist/entry.js` or `dist/control-ui/index.html` is missing, or if the edited startup source is newer than `dist/entry.js`, ClawX fails fast with the build commands instead of letting the Gateway block while trying to repair assets during startup.

### 3. Smoke-test OpenClaw directly before involving ClawX

When ClawX reports `wait-ready outcome=pending`, first verify whether the local OpenClaw build can start by itself:

```powershell
cd C:\Users\szdee\Projects\openclaw
node .\openclaw.mjs gateway --port 18790 --allow-unconfigured
```

In another PowerShell window, check that the port is listening:

```powershell
Test-NetConnection 127.0.0.1 -Port 18790
```

Use a non-default port such as `18790` so the smoke test does not collide with the ClawX-managed Gateway on `18789`.

### 4. Read the ClawX Gateway logs

The ClawX main log is the fastest place to understand managed Gateway startup and reconnect behavior:

```powershell
Get-Content "$env:APPDATA\Deep AI Worker\logs\clawx-$(Get-Date -Format yyyy-MM-dd).log" -Tail 200 -Wait
```

Useful patterns:

```text
[Windows Gateway Monitor] wait-ready ...
[Gateway stdout] [clawx-boot] ...
[Gateway stderr] Config was last written by a newer OpenClaw ...
config.patch write ... changedPaths=...
config change requires gateway restart (...)
Gateway WebSocket closed (code=1012, reason=service restart)
```

If sending the first chat message immediately restarts the Gateway, look for a `config.patch` immediately before `code=1012`. The `/api/agents/:id/model/runtime` route is meant to be runtime-only; it should not patch `agents.list` or trigger a Gateway reload.

### 5. Package with the local OpenClaw build

For packaged/bundled validation, the same environment variable makes `scripts/bundle-openclaw.mjs` copy the local OpenClaw package files into `build/openclaw` while using ClawX's installed OpenClaw dependency graph for runtime dependencies:

```powershell
cd C:\Users\szdee\Projects\ClawX
$env:CLAWX_OPENCLAW_LOCAL_DIR = 'C:\Users\szdee\Projects\openclaw'
pnpm run package
```

This keeps the dependency flow explicit and avoids patching `node_modules/openclaw`, `build/openclaw/node_modules`, or packaged `app.asar` output by hand.

Important limitation: the local package override copies the local OpenClaw package files, but dependency collection still uses ClawX's installed OpenClaw dependency graph. This is fine for source-only changes. If the local OpenClaw change adds, removes, or upgrades runtime dependencies, update ClawX's installed OpenClaw dependency or the bundling strategy before trusting a packaged build.

### 6. Recommended validation loop

For OpenClaw startup changes:

```powershell
cd C:\Users\szdee\Projects\openclaw
pnpm build
pnpm run test:gateway -- src/gateway/server-startup-post-attach.test.ts

cd C:\Users\szdee\Projects\ClawX
$env:CLAWX_OPENCLAW_LOCAL_DIR = 'C:\Users\szdee\Projects\openclaw'
pnpm run typecheck
pnpm test -- tests/unit/gateway-process-launcher.test.ts tests/unit/paths.test.ts
pnpm dev
```

For ClawX Gateway-manager changes:

```powershell
cd C:\Users\szdee\Projects\ClawX
pnpm run typecheck
pnpm test -- tests/unit/gateway-process-launcher.test.ts tests/unit/paths.test.ts
```

For chat-send or runtime model synchronization regressions:

```powershell
cd C:\Users\szdee\Projects\ClawX
pnpm test -- tests/unit/agents-routes.test.ts tests/unit/chat-send-error-localization.test.ts
```

### 7. Common local-development pitfalls

- Rebuild OpenClaw after editing `src/` files. ClawX launches `openclaw.mjs`, which loads built `dist` output.
- Build Control UI assets before managed startup. Missing `dist/control-ui/index.html` can make first startup much slower.
- Keep `CLAWX_OPENCLAW_LOCAL_DIR` scoped to the shell used for `pnpm dev` or `pnpm run package`.
- A warning like `Config was last written by a newer OpenClaw` means the local checkout version is older than the version that wrote `~/.openclaw/openclaw.json`. It is noisy but not necessarily fatal.
- Do not edit `node_modules/openclaw`, `build/openclaw`, or `release/win-unpacked/resources/openclaw` by hand except for throwaway diagnosis.
- On Windows, prefer PowerShell paths for scripts, but `/c/Users/...` override paths are accepted and normalized.

## Follow-up Work

After the two main fixes, investigate:

- Why `loadGatewayStartupConfigSnapshot` costs around 4 seconds on Windows.
- Why `prepareGatewayPluginBootstrap` costs around 3.5 to 4 seconds even with channels skipped.
- Whether ClawX readiness probes should avoid producing noisy Gateway `closed before connect` warnings.
- Whether Gateway stdout capture should remain enabled for diagnostic lines only, or be gated by a debug setting.
