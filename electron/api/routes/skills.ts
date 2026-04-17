import type { IncomingMessage, ServerResponse } from 'http';
import type {
  ClawHubInstallParams,
  ClawHubSearchParams,
  ClawHubUninstallParams,
} from '../../gateway/clawhub';
import { getAllSkillConfigs, updateSkillConfig } from '../../utils/skill-config';
import { deleteSkillDirectory, getSkillDetail, listSkills, saveSkillConfig } from '../../utils/skill-details';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills' && req.method === 'GET') {
    try {
      sendJson(res, 200, await listSkills(ctx.gatewayManager));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      sendJson(res, 200, await updateSkillConfig(body.skillKey, {
        apiKey: body.apiKey,
        env: body.env,
      }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/skills/') && req.method === 'GET') {
    try {
      const skillId = decodeURIComponent(url.pathname.slice('/api/skills/'.length));
      const detail = await getSkillDetail(ctx.gatewayManager, skillId);
      if (!detail) {
        sendJson(res, 404, { success: false, error: 'Skill not found' });
      } else {
        sendJson(res, 200, detail);
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/config') && req.method === 'PUT') {
    try {
      const skillId = decodeURIComponent(url.pathname.slice('/api/skills/'.length, -'/config'.length));
      const body = await parseJsonBody<{
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      sendJson(res, 200, await saveSkillConfig(ctx.gatewayManager, skillId, body));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/skills/') && req.method === 'DELETE') {
    try {
      const skillId = decodeURIComponent(url.pathname.slice('/api/skills/'.length));
      const detail = await getSkillDetail(ctx.gatewayManager, skillId);
      if (!detail) {
        sendJson(res, 404, { success: false, error: 'Skill not found' });
        return true;
      }

      const sources = await ctx.clawHubService.listSources();
      const inferredSource = ctx.clawHubService.inferSourceFromBaseDir(detail.identity.baseDir, sources);
      if (inferredSource && detail.identity.slug) {
        await ctx.clawHubService.uninstall({
          slug: detail.identity.slug,
          sourceId: inferredSource.id,
        });
        sendJson(res, 200, { success: true });
        return true;
      }

      sendJson(res, 200, await deleteSkillDirectory(ctx.gatewayManager, skillId));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<ClawHubSearchParams>(req);
      const page = await ctx.clawHubService.search(body);
      sendJson(res, 200, {
        success: true,
        results: page.results,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/sources' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await ctx.clawHubService.listSources() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/source-counts' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await ctx.clawHubService.listSourceCounts() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<ClawHubInstallParams>(req);
      await ctx.clawHubService.install(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/uninstall' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<ClawHubUninstallParams>(req);
      await ctx.clawHubService.uninstall(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/list' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await ctx.clawHubService.listInstalled() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillPath(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
