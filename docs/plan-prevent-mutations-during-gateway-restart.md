# Plan: Prevent Mutations During Gateway Restart

## Problem

When a configuration change triggers a Gateway restart, the restart process takes time (state transitions: `running` -> `starting` -> `running`). During this window, other mutation operations (add provider, create agent, etc.) can still be initiated, leading to:

1. **Race conditions** - concurrent config modifications, later requests may overwrite earlier ones
2. **Silent data loss** - config written during restart may be overwritten when the gateway reloads its config from disk
3. **RPC failures** - requests sent to a not-yet-ready gateway fail with confusing errors
4. **Inconsistent state** - the UI shows success but the gateway never picked up the change

## Current State

- `confirmGatewayImpact()` only shows a pre-action confirmation dialog
- No check exists to block operations when gateway is in a transitional state (`starting`, `reconnecting`)
- Backend API routes do not check gateway state before accepting mutations
- The `GatewayStatus.state` type is: `'stopped' | 'starting' | 'running' | 'error' | 'reconnecting'`

## Solution: Two-Layer Protection

### Layer 1: Frontend - Mutation Guard

Add a guard in the gateway store and check it at the start of every mutation action across all stores.

#### 1.1 Add `isGatewayTransitioning()` helper to `src/stores/gateway.ts`

```ts
export function isGatewayTransitioning(): boolean {
  const state = useGatewayStore.getState().status.state;
  return state === 'starting' || state === 'reconnecting';
}
```

#### 1.2 Add guard to mutation actions in each store

Guard should fire **before** `confirmGatewayImpact()`, so the user doesn't even see the confirmation dialog when gateway is transitioning.

Stores and actions to guard:

| Store | Actions |
|-------|---------|
| `providers.ts` | `addProvider`, `createAccount`, `updateProvider`, `updateAccount`, `deleteProvider`, `removeAccount`, `setApiKey`, `updateProviderWithKey`, `setDefaultProvider`, `setDefaultAccount` |
| `agents.ts` | `createAgent`, `updateAgent`, `updateAgentModel`, `updateAgentStudio`, `deleteAgent`, `assignChannel`, `removeChannel` |
| `settings.ts` | `setDreamModeEnabled` |
| `channels.ts` | `addChannel`, `deleteChannel`, `connectChannel`, `disconnectChannel` |

Guard pattern:

```ts
createAccount: async (account, apiKey) => {
  if (isGatewayTransitioning()) {
    // TODO: show toast notification
    return false;
  }
  const confirmed = await confirmGatewayImpact({ ... });
  // ... existing logic
}
```

Note: `channels.ts` uses `useGatewayStore.getState().rpc()` directly (not `confirmGatewayImpact`), but still needs the guard since RPC calls during restart will fail.

#### 1.3 User feedback

When a mutation is blocked, show a toast/notification: "Gateway is restarting, please try again later."

Need to check what toast/notification system the project uses and integrate with it.

### Layer 2: Backend - API Route Guard

Add a state check to all mutation routes (POST/PUT/DELETE) on the Electron side. This is the safety net in case the frontend check is bypassed (multiple clients, direct API calls, etc.).

#### 2.1 Add helper to `electron/api/route-utils.ts`

```ts
export function isGatewayTransitioning(ctx: HostApiContext): boolean {
  const state = ctx.gatewayManager.getStatus().state;
  return state === 'starting' || state === 'reconnecting';
}
```

#### 2.2 Add guard to mutation routes

Route files to update:

| File | Routes to guard |
|------|-----------------|
| `electron/api/routes/providers.ts` | POST/PUT/DELETE on `/api/provider-accounts/*`, `/api/providers/*` |
| `electron/api/routes/agents.ts` | POST/PUT/DELETE on `/api/agents/*` |
| `electron/api/routes/channels.ts` | POST/PUT/DELETE on `/api/channels/*` |
| `electron/api/routes/skills.ts` | POST/PUT/DELETE on `/api/skills/*` |

Guard pattern:

```ts
if (isGatewayTransitioning(ctx)) {
  sendJson(res, 409, {
    success: false,
    error: 'Gateway is restarting, please try again later',
  });
  return true;
}
```

#### 2.3 Routes to NOT guard

Read-only routes (GET) should remain accessible - users should be able to view config even during restart. Also, the gateway's own lifecycle routes (`/api/gateway/start`, `/api/gateway/stop`, `/api/gateway/restart`) must remain open.

## Transition State Definitions

The following gateway states are considered "transitioning" (mutations should be blocked):

| State | Meaning |
|-------|---------|
| `starting` | Gateway is starting up or restarting |
| `reconnecting` | Gateway process is alive but WS connection dropped, attempting recovery |

The following states allow mutations:

| State | Meaning |
|-------|---------|
| `running` | Gateway is healthy and connected |
| `stopped` | Gateway is not running - config can be written to disk, will be picked up on next start |
| `error` | Gateway failed - config can still be written to disk for next start attempt |

Note: `stopped` and `error` states allow mutations because the config is written to local files, not through the gateway RPC. The gateway will read the latest config when it starts.

## Implementation Order

1. Add `isGatewayTransitioning()` to `src/stores/gateway.ts`
2. Add frontend guards to `providers.ts` (most mutation actions)
3. Add frontend guards to `agents.ts`
4. Add frontend guards to `settings.ts`
5. Add frontend guards to `channels.ts`
6. Add backend helper to `electron/api/route-utils.ts`
7. Add backend guards to `electron/api/routes/providers.ts`
8. Add backend guards to `electron/api/routes/agents.ts`
9. Add backend guards to `electron/api/routes/channels.ts`
10. Add backend guards to `electron/api/routes/skills.ts`
11. Add user-facing toast/notification feedback
12. Manual testing

## Edge Cases

- **Rapid successive clicks**: User clicks "save" while gateway is still running, but by the time the request reaches the backend, gateway has entered `starting`. The backend guard catches this.
- **Multiple clients**: If two browser windows are open, one triggers a restart, the other tries to make changes. The backend guard prevents the second client's mutations.
- **Long-running restart**: If restart takes unusually long, users see consistent "restarting" feedback and cannot make conflicting changes.
- **Auto-reconnect**: The `reconnecting` state should also block mutations, since the gateway may restart its process at any point during reconnection attempts.
