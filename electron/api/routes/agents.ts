import type { IncomingMessage, ServerResponse } from 'http';
import {
  applyPreparedAgentModelUpdate,
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  type AgentWorkflowNode,
  listAgentsSnapshot,
  prepareAgentModelUpdate,
  removeAgentRuntimeDirectory,
  removeAgentWorkspaceDirectory,
  resolveAccountIdForAgent,
  updateAgentModel,
  updateAgentStudio,
  updateAgentName,
} from '../../utils/agent-config';
import { deleteChannelAccountConfig } from '../../utils/channel-config';
import {
  syncAgentModelRefToRuntime,
  syncAgentModelOverrideToRuntime,
  syncAllProviderAuthToRuntime,
} from '../../services/providers/provider-runtime-sync';
import type { HostApiContext } from '../context';
import { emitMutationAudit } from '../audit-utils';
import { parseJsonBody, sendJson } from '../route-utils';
import { logger } from '../../utils/logger';

function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
    return;
  }
  void reason;
}

type GatewayConfigSnapshot = {
  hash?: string;
  config?: Record<string, unknown>;
};

async function tryHotPatchAgentModel(
  ctx: HostApiContext,
  agentId: string,
  modelRef: string | null,
  options: { setAsDefault?: boolean } = {},
): Promise<Awaited<ReturnType<typeof prepareAgentModelUpdate>> | null> {
  if (ctx.gatewayManager.getStatus().state !== 'running') {
    return null;
  }

  const snapshot = await ctx.gatewayManager.rpc<GatewayConfigSnapshot>('config.get', {}, 15000);
  if (!snapshot?.hash || !snapshot.config || typeof snapshot.config !== 'object' || Array.isArray(snapshot.config)) {
    return null;
  }

  const prepared = await prepareAgentModelUpdate(snapshot.config, agentId, modelRef, options);
  await ctx.gatewayManager.rpc(
    'config.patch',
    {
      baseHash: snapshot.hash,
      raw: JSON.stringify({ agents: prepared.config.agents ?? {} }),
    },
    15000,
  );
  await applyPreparedAgentModelUpdate(prepared);
  return prepared;
}

async function tryHotPatchRuntimeAgentModel(
  ctx: HostApiContext,
  agentId: string,
  modelRef: string | null,
  options: { setAsDefault?: boolean } = {},
): Promise<Awaited<ReturnType<typeof prepareAgentModelUpdate>>> {
  if (ctx.gatewayManager.getStatus().state !== 'running') {
    throw new Error('Gateway is not running');
  }

  const snapshot = await ctx.gatewayManager.rpc<GatewayConfigSnapshot>('config.get', {}, 15000);
  if (!snapshot?.hash || !snapshot.config || typeof snapshot.config !== 'object' || Array.isArray(snapshot.config)) {
    throw new Error('Unable to read running Gateway config');
  }

  const prepared = await prepareAgentModelUpdate(snapshot.config, agentId, modelRef, options);
  await ctx.gatewayManager.rpc(
    'config.patch',
    {
      baseHash: snapshot.hash,
      raw: JSON.stringify({ agents: prepared.config.agents ?? {} }),
    },
    15000,
  );
  return prepared;
}

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

async function waitForGatewayState(
  readStatus: () => { state?: string },
  predicate: (state: string) => boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readStatus().state ?? 'unknown';
    if (predicate(state)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const finalState = readStatus().state ?? 'unknown';
  return predicate(finalState);
}

/**
 * Force a full Gateway process restart after agent deletion.
 *
 * A SIGUSR1 in-process reload is NOT sufficient here: channel plugins
 * (e.g. Feishu) maintain long-lived WebSocket connections to external
 * services and do not disconnect accounts that were removed from the
 * config during an in-process reload.  The only reliable way to drop
 * stale bot connections is to kill the Gateway process entirely and
 * spawn a fresh one that reads the updated openclaw.json from scratch.
 */
export async function restartGatewayForAgentDeletion(ctx: HostApiContext): Promise<void> {
  try {
    // Capture the PID of the running Gateway BEFORE stop() clears it.
    const status = ctx.gatewayManager.getStatus();
    const pid = status.pid;
    const port = status.port;
    const shouldRecoverGateway = status.state !== 'stopped';
    logger.info('[agents] Triggering Gateway restart (kill+respawn) after agent deletion', { pid, port });

    // Force-kill the Gateway process by PID.  The manager's stop() only
    // kills "owned" processes; if the manager connected to an already-
    // running Gateway (ownsProcess=false), stop() simply closes the WS
    // and the old process stays alive with its stale channel connections.
    if (pid) {
      try {
        if (process.platform === 'win32') {
          await execAsync(`taskkill /F /PID ${pid} /T`);
        } else {
          process.kill(pid, 'SIGTERM');
          // Give it a moment to die
          await new Promise((resolve) => setTimeout(resolve, 500));
          try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
        }
      } catch {
        // process already gone – that's fine
      }
    } else if (port) {
      // If we don't know the PID (e.g. connected to an orphaned Gateway from
      // a previous pnpm dev run), forcefully kill whatever is on the port.
      try {
        if (process.platform === 'darwin' || process.platform === 'linux') {
          // MUST use -sTCP:LISTEN. Otherwise lsof returns the client process (ClawX itself) 
          // that has an ESTABLISHED WebSocket connection to the port, causing us to kill ourselves.
          const { stdout } = await execAsync(`lsof -t -i :${port} -sTCP:LISTEN`);
          const pids = stdout.trim().split('\n').filter(Boolean);
          for (const p of pids) {
            try { process.kill(parseInt(p, 10), 'SIGTERM'); } catch { /* ignore */ }
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          for (const p of pids) {
            try { process.kill(parseInt(p, 10), 'SIGKILL'); } catch { /* ignore */ }
          }
        } else if (process.platform === 'win32') {
          // Find PID listening on the port
          const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
          const lines = stdout.trim().split('\n');
          const pids = new Set<string>();
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING') {
              pids.add(parts[4]);
            }
          }
          for (const p of pids) {
            try { await execAsync(`taskkill /F /PID ${p} /T`); } catch { /* ignore */ }
          }
        }
      } catch {
        // Port might not be bound or command failed; ignore
      }
    }

    if (!shouldRecoverGateway) {
      logger.info('[agents] Gateway was already stopped; skipping post-deletion restart');
      return;
    }

    await waitForGatewayState(
      () => ctx.gatewayManager.getStatus(),
      (state) => state !== 'running',
      3000,
    );

    await ctx.gatewayManager.start();
    const recovered = await waitForGatewayState(
      () => ctx.gatewayManager.getStatus(),
      (state) => state === 'running',
      30000,
    );
    if (!recovered) {
      throw new Error(
        `Gateway did not recover after agent deletion (state=${ctx.gatewayManager.getStatus().state ?? 'unknown'})`,
      );
    }
    logger.info('[agents] Gateway restart completed after agent deletion');
  } catch (err) {
    logger.warn('[agents] Gateway restart after agent deletion failed:', err);
  }
}

export async function handleAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await listAgentsSnapshot()) });
    return true;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    const startedAt = Date.now();
    try {
      const body = await parseJsonBody<{
        name: string;
        inheritWorkspace?: boolean;
        studio?: {
          profileType?: string | null;
          description?: string | null;
          objective?: string | null;
          boundaries?: string | null;
          outputContract?: string | null;
        };
      }>(req);
      const created = await createAgent(body.name, { inheritWorkspace: body.inheritWorkspace });
      const snapshot = body.studio
        ? await updateAgentStudio(created.createdAgentId, body.studio)
        : created.snapshot;
      // Sync provider API keys to the new agent's auth-profiles.json before
      // returning success. If this runs in the background, users can open the
      // new agent immediately and hit "No API key found" before the sync lands.
      try {
        await syncAllProviderAuthToRuntime();
      } catch (err) {
        logger.warn('[agents] Failed to sync provider auth after agent creation:', err);
      }
      scheduleGatewayReload(ctx, 'create-agent');
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'agent.create',
        resourceType: 'agent',
        resourceId: created.createdAgentId,
        result: 'success',
        changedKeys: ['name', 'inheritWorkspace', ...(body.studio ? ['studio'] : [])],
      });
      sendJson(res, 200, { success: true, createdAgentId: created.createdAgentId, ...snapshot });
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'agent.create',
        resourceType: 'agent',
        result: 'failure',
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      const startedAt = Date.now();
      try {
        const body = await parseJsonBody<{ name: string }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentName(agentId, body.name);
        scheduleGatewayReload(ctx, 'update-agent');
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.update-name',
          resourceType: 'agent',
          resourceId: agentId,
          result: 'success',
          changedKeys: ['name'],
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.update-name',
          resourceType: 'agent',
          result: 'failure',
          changedKeys: ['name'],
          error,
        });
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'model' && parts[2] === 'runtime') {
      try {
        const body = await parseJsonBody<{ modelRef?: string | null; setAsDefault?: boolean }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const updateOptions = {
          setAsDefault: body.setAsDefault === true,
        };

        await syncAllProviderAuthToRuntime();
        await syncAgentModelRefToRuntime(agentId, body.modelRef ?? null);
        await tryHotPatchRuntimeAgentModel(ctx, agentId, body.modelRef ?? null, updateOptions);

        sendJson(res, 200, {
          success: true,
          agentId,
          modelRef: body.modelRef ?? null,
        });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 2 && parts[1] === 'model') {
      const startedAt = Date.now();
      try {
        const body = await parseJsonBody<{ modelRef?: string | null; setAsDefault?: boolean }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const updateOptions = {
          setAsDefault: body.setAsDefault === true,
        };
        let snapshot;
        let hotPatched = false;
        try {
          const prepared = await tryHotPatchAgentModel(ctx, agentId, body.modelRef ?? null, updateOptions);
          if (prepared) {
            snapshot = prepared.snapshot;
            hotPatched = true;
          }
        } catch (hotPatchError) {
          logger.warn('[agents] Gateway config.patch for agent model failed, falling back to local update:', hotPatchError);
        }

        if (!snapshot) {
          snapshot = await updateAgentModel(agentId, body.modelRef ?? null, updateOptions);
        }
        try {
          await syncAllProviderAuthToRuntime();
          // Ensure this agent's runtime model registry reflects the new model override.
          await syncAgentModelOverrideToRuntime(agentId);
        } catch (syncError) {
          logger.warn('[agents] Failed to sync runtime after updating agent model:', syncError);
        }
        if (!hotPatched) {
          scheduleGatewayReload(ctx, 'update-agent-model');
        }
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.update-model',
          resourceType: 'agent',
          resourceId: agentId,
          result: 'success',
          changedKeys: ['modelRef', ...(body.setAsDefault ? ['setAsDefault'] : [])],
          metadata: {
            hotPatched,
          },
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.update-model',
          resourceType: 'agent',
          result: 'failure',
          changedKeys: ['modelRef'],
          error,
        });
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 2 && parts[1] === 'studio') {
      const startedAt = Date.now();
      try {
        const body = await parseJsonBody<{
          description?: string | null;
          skillIds?: string[];
          workflowSteps?: string[];
          workflowNodes?: AgentWorkflowNode[];
          triggerModes?: string[];
        }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentStudio(agentId, body);
        scheduleGatewayReload(ctx, 'update-agent-studio');
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.update-studio',
          resourceType: 'agent',
          resourceId: agentId,
          result: 'success',
          changedKeys: Object.keys(body),
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.update-studio',
          resourceType: 'agent',
          result: 'failure',
          error,
        });
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      const startedAt = Date.now();
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const snapshot = await assignChannelToAgent(agentId, channelType);
        scheduleGatewayReload(ctx, 'assign-channel');
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.assign-channel',
          resourceType: 'agent',
          resourceId: agentId,
          result: 'success',
          changedKeys: ['channelType'],
          metadata: {
            channelType,
          },
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.assign-channel',
          resourceType: 'agent',
          result: 'failure',
          changedKeys: ['channelType'],
          error,
        });
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      const startedAt = Date.now();
      try {
        const agentId = decodeURIComponent(parts[0]);
        const { snapshot, removedEntry } = await deleteAgentConfig(agentId);
        // Await reload synchronously BEFORE responding to the client.
        // This ensures the Feishu plugin has disconnected the deleted bot
        // before the UI shows "delete success" and the user tries chatting.
        await restartGatewayForAgentDeletion(ctx);
        // Retry runtime cleanup after restart so stale session indexes and
        // transcripts are removed even if the old process still had files open
        // during the initial config deletion step.
        await removeAgentRuntimeDirectory(agentId).catch((err) => {
          logger.warn('[agents] Failed to remove runtime after agent deletion:', err);
        });
        // Delete workspace after reload so the new config is already live.
        await removeAgentWorkspaceDirectory(removedEntry).catch((err) => {
          logger.warn('[agents] Failed to remove workspace after agent deletion:', err);
        });
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.delete',
          resourceType: 'agent',
          resourceId: agentId,
          result: 'success',
          changedKeys: ['*'],
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.delete',
          resourceType: 'agent',
          result: 'failure',
          changedKeys: ['*'],
          error,
        });
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      const startedAt = Date.now();
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const ownerId = agentId.trim().toLowerCase();
        const snapshotBefore = await listAgentsSnapshot();
        const ownedAccountIds = Object.entries(snapshotBefore.channelAccountOwners)
          .filter(([channelAccountKey, owner]) => {
            if (owner !== ownerId) return false;
            return channelAccountKey.startsWith(`${channelType}:`);
          })
          .map(([channelAccountKey]) => channelAccountKey.slice(channelAccountKey.indexOf(':') + 1));
        // Backward compatibility for legacy agentId->accountId mapping.
        if (ownedAccountIds.length === 0) {
          const legacyAccountId = resolveAccountIdForAgent(agentId);
          if (snapshotBefore.channelAccountOwners[`${channelType}:${legacyAccountId}`] === ownerId) {
            ownedAccountIds.push(legacyAccountId);
          }
        }

        for (const accountId of ownedAccountIds) {
          await deleteChannelAccountConfig(channelType, accountId);
          await clearChannelBinding(channelType, accountId);
        }
        const snapshot = await listAgentsSnapshot();
        scheduleGatewayReload(ctx, 'remove-agent-channel');
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.remove-channel',
          resourceType: 'agent',
          resourceId: agentId,
          result: 'success',
          changedKeys: ['channelType'],
          metadata: {
            channelType,
            removedAccountCount: ownedAccountIds.length,
          },
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'agent.remove-channel',
          resourceType: 'agent',
          result: 'failure',
          changedKeys: ['channelType'],
          error,
        });
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  return false;
}
