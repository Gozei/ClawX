/**
 * ClawHub Service
 * Manages interactions with the ClawHub CLI for skills management
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import {
    invalidateMarketplaceCacheForSource,
    invalidateMarketplaceCacheKey,
    readMarketplaceCache,
    writeMarketplaceCache,
} from '../services/skills/marketplace-cache';
import { getOpenClawConfigDir, ensureDir, getClawHubCliBinPath, getClawHubCliEntryPath, quoteForCmd } from '../utils/paths';
import { getSkillSourceById, inferSkillSourceFromBaseDir, listSkillSources, type SkillSourceConfig } from '../utils/skill-sources';

export interface ClawHubSearchParams {
    query: string;
    limit?: number;
    sourceId?: string;
    allSources?: boolean;
    cursor?: string;
}

export interface ClawHubInstallParams {
    slug: string;
    version?: string;
    force?: boolean;
    sourceId?: string;
}

export interface ClawHubUninstallParams {
    slug: string;
    sourceId?: string;
}

export interface ClawHubSkillResult {
    slug: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    downloads?: number;
    stars?: number;
    sourceId?: string;
    sourceLabel?: string;
}

export interface ClawHubSearchResponse {
    results: ClawHubSkillResult[];
    nextCursor?: string;
}

export interface ClawHubSourceCountResult {
    sourceId: string;
    sourceLabel?: string;
    total: number | null;
}

interface PublicSkillsApiItem {
    skill?: {
        slug?: string;
        displayName?: string;
        description?: string;
        summary?: string;
        stats?: {
            downloads?: number;
            stars?: number;
        };
    };
    latestVersion?: {
        version?: string;
    };
    owner?: {
        handle?: string;
    };
}

interface PublicSkillsQueryResponse<T> {
  status?: string;
  value?: T;
}

interface PublicSkillsFileTextResponse {
    path?: string;
    sha256?: string;
    size?: number;
    text?: string;
}

export interface ClawHubInstalledSkillResult {
    slug: string;
    version: string;
    source?: string;
    baseDir?: string;
    sourceId?: string;
    sourceLabel?: string;
}

const MARKETPLACE_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MARKETPLACE_EXPLORE_CACHE_TTL_MS = 10 * 60 * 1000;
const MARKETPLACE_DETAIL_CACHE_TTL_MS = 60 * 60 * 1000;
const MARKETPLACE_SOURCE_COUNTS_CACHE_TTL_MS = 15 * 60 * 1000;

function buildSourceFingerprint(source: SkillSourceConfig): string {
    return JSON.stringify({
        id: source.id,
        site: source.site,
        apiQueryEndpoint: source.apiQueryEndpoint || '',
        registry: source.registry || '',
        workdir: source.workdir,
    });
}

function buildMarketplaceSearchCacheKey(
    source: SkillSourceConfig,
    params: { query: string; limit?: number; cursor?: string },
): string {
    return `search:${JSON.stringify({
        sourceId: source.id,
        sourceFingerprint: buildSourceFingerprint(source),
        query: params.query,
        limit: params.limit ?? 25,
        cursor: params.cursor || '',
    })}`;
}

function buildMarketplaceDetailCacheKey(source: SkillSourceConfig, slug: string): string {
    return `detail:${JSON.stringify({
        sourceId: source.id,
        sourceFingerprint: buildSourceFingerprint(source),
        slug,
    })}`;
}

function buildMarketplaceSourceCountCacheKey(source: SkillSourceConfig): string {
    return `source-count:${JSON.stringify({
        sourceId: source.id,
        sourceFingerprint: buildSourceFingerprint(source),
    })}`;
}

export class ClawHubService {
    private cliPath: string;
    private cliEntryPath: string;
    private useNodeRunner: boolean;
    private ansiRegex: RegExp;
    private static readonly INSTALL_RETRY_COUNT = 3;
    private static readonly INSTALL_RETRY_BASE_DELAY_MS = 1000;

    constructor() {
        // Use the user's OpenClaw config directory (~/.openclaw) for skill management
        // This avoids installing skills into the project's openclaw submodule
        ensureDir(getOpenClawConfigDir());

        const binPath = getClawHubCliBinPath();
        const entryPath = getClawHubCliEntryPath();

        this.cliEntryPath = entryPath;
        if (!app.isPackaged && fs.existsSync(binPath)) {
            this.cliPath = binPath;
            this.useNodeRunner = false;
        } else {
            this.cliPath = process.execPath;
            this.useNodeRunner = true;
        }
        const esc = String.fromCharCode(27);
        const csi = String.fromCharCode(155);
        const pattern = `(?:${esc}|${csi})[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`;
        this.ansiRegex = new RegExp(pattern, 'g');
    }

    private stripAnsi(line: string): string {
        return line.replace(this.ansiRegex, '').trim();
    }

    private isRetryableInstallError(error: unknown): boolean {
        const message = String(error).toLowerCase();
        return message.includes('rate limit') || message.includes('429');
    }

    private async delay(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private extractFrontmatterName(skillManifestPath: string): string | null {
        try {
            const raw = fs.readFileSync(skillManifestPath, 'utf8');
            // Match the first frontmatter block and read `name: ...`
            const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) return null;
            const body = frontmatterMatch[1];
            const nameMatch = body.match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
            if (!nameMatch) return null;
            const name = nameMatch[1].trim();
            return name || null;
        } catch {
            return null;
        }
    }

    private resolveSkillDirByManifestName(candidates: string[], skillsRoot: string): string | null {
        if (!fs.existsSync(skillsRoot)) return null;

        const wanted = new Set(
            candidates
                .map((v) => v.trim().toLowerCase())
                .filter((v) => v.length > 0),
        );
        if (wanted.size === 0) return null;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
        } catch {
            return null;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillDir = path.join(skillsRoot, entry.name);
            const skillManifestPath = path.join(skillDir, 'SKILL.md');
            if (!fs.existsSync(skillManifestPath)) continue;

            const frontmatterName = this.extractFrontmatterName(skillManifestPath);
            if (!frontmatterName) continue;
            if (wanted.has(frontmatterName.toLowerCase())) {
                return skillDir;
            }
        }
        return null;
    }

    private async resolveSource(sourceId?: string): Promise<SkillSourceConfig> {
        if (sourceId) {
            const source = await getSkillSourceById(sourceId);
            if (!source) {
                throw new Error(`Unknown skill source: ${sourceId}`);
            }
            return source;
        }
        const sources = await listSkillSources();
        const firstEnabled = sources.find((source) => source.enabled);
        if (!firstEnabled) {
            throw new Error('No enabled skill source configured');
        }
        return firstEnabled;
    }

    private buildSourceEnv(source: SkillSourceConfig): Record<string, string> {
        const env: Record<string, string> = {
            CLAWHUB_SITE: source.site,
            CLAWDHUB_SITE: source.site,
            CLAWHUB_WORKDIR: source.workdir,
            CLAWDHUB_WORKDIR: source.workdir,
        };
        if (source.registry) {
            env.CLAWHUB_REGISTRY = source.registry;
            env.CLAWDHUB_REGISTRY = source.registry;
        }
        return env;
    }

    private async readInstalledSkillsFromLock(workdir: string): Promise<Array<{ slug: string; version: string }>> {
        const lockPaths = [
            path.join(workdir, '.clawhub', 'lock.json'),
            path.join(workdir, '.clawdhub', 'lock.json'),
        ];

        for (const lockPath of lockPaths) {
            try {
                const raw = await fs.promises.readFile(lockPath, 'utf8');
                const parsed = JSON.parse(raw) as {
                    skills?: Record<string, { version?: unknown }>;
                };
                const skills = parsed?.skills;
                if (!skills || typeof skills !== 'object' || Array.isArray(skills)) {
                    continue;
                }

                return Object.entries(skills)
                    .filter(([slug]) => typeof slug === 'string' && slug.trim().length > 0)
                    .map(([slug, entry]) => ({
                        slug,
                        version: typeof entry?.version === 'string' && entry.version.trim().length > 0
                            ? entry.version
                            : 'latest',
                    }));
            } catch {
                // Try the next known lockfile location.
            }
        }

        return [];
    }

    private async fetchPublicSkills(source: SkillSourceConfig, limit: number, cursor?: string): Promise<ClawHubSearchResponse> {
        if (!source.apiQueryEndpoint) {
            return { results: [] };
        }

        const data = await this.queryPublicSkills<{ page?: PublicSkillsApiItem[]; nextCursor?: string }>(source, 'skills:listPublicPageV4', [{
            dir: 'desc',
            highlightedOnly: false,
            nonSuspiciousOnly: false,
            numItems: limit,
            sort: 'downloads',
            ...(cursor ? { cursor } : {}),
        }]);
        const items = Array.isArray(data?.value?.page) ? data.value.page : [];

        return {
            results: items.map((item) => ({
                slug: item.skill?.slug || '',
                name: item.skill?.displayName || item.skill?.slug || '',
                version: item.latestVersion?.version || '1.0.0',
                description: item.skill?.summary || item.skill?.description || '',
                author: item.owner?.handle || 'community',
                downloads: item.skill?.stats?.downloads,
                stars: item.skill?.stats?.stars,
                sourceId: source.id,
                sourceLabel: source.label,
            })).filter((item) => item.slug),
            nextCursor: data?.value?.nextCursor,
        };
    }

    private async queryPublicSkills<T>(source: SkillSourceConfig, pathName: string, args: unknown[], endpoint: 'query' | 'action' = 'query'): Promise<PublicSkillsQueryResponse<T>> {
        if (!source.apiQueryEndpoint) {
            throw new Error(`Source ${source.id} does not expose an API query endpoint`);
        }

        const response = await fetch(source.apiQueryEndpoint.replace(/\/api\/query$/, `/api/${endpoint}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: pathName,
                format: 'convex_encoded_json',
                args,
            }),
        } as RequestInit);

        if (!response.ok) {
            throw new Error(`Failed to query public skills from ${source.id}: ${response.status} ${response.statusText}`);
        }

        return await response.json() as PublicSkillsQueryResponse<T>;
    }

    private resolveMarketplaceMarkdownPath(files?: Array<{ path?: string }>): string | null {
        if (!Array.isArray(files) || files.length === 0) {
            return null;
        }

        const normalizedLeaf = (filePath?: string): string => filePath?.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
        const orderedTargets = ['skill.md', 'skills.md', 'readme.md'];
        for (const target of orderedTargets) {
            const match = files.find((file) => normalizedLeaf(file.path) === target);
            if (match?.path) {
                return match.path;
            }
        }
        return null;
    }

    private async fetchPublicSkillCount(source: SkillSourceConfig): Promise<number | null> {
        if (!source.apiQueryEndpoint) {
            return null;
        }

        try {
            const response = await fetch(source.apiQueryEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: 'skills:countPublicSkills',
                    format: 'convex_encoded_json',
                    args: [{}],
                }),
            } as RequestInit);

            if (!response.ok) {
                throw new Error(`Failed to count public skills from ${source.id}: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as { status?: string; value?: unknown };
            if (typeof data?.value === 'number' && Number.isFinite(data.value)) {
                return Math.max(0, Math.trunc(data.value));
            }
        } catch (error) {
            console.warn(`Direct HTTP count failed for ${source.id}, falling back to paginated counting:`, error);
            const message = String(error).toLowerCase();
            if (message.includes('rate limit') || message.includes('429')) {
                return null;
            }
        }

        try {
            let total = 0;
            let cursor: string | undefined;
            let safety = 0;

            while (safety < 200) {
                safety += 1;
                const page = await this.fetchPublicSkills(source, 250, cursor);
                total += page.results.length;

                if (!page.nextCursor || page.results.length === 0) {
                    break;
                }

                cursor = page.nextCursor;
            }

            return total;
        } catch (error) {
            console.error(`Fallback paginated count failed for ${source.id}:`, error);
            return null;
        }
    }

    /**
     * Run a ClawHub CLI command
     */
    private async runCommand(args: string[], options?: { sourceId?: string }): Promise<string> {
        const source = await this.resolveSource(options?.sourceId);
        return new Promise((resolve, reject) => {
            if (this.useNodeRunner && !fs.existsSync(this.cliEntryPath)) {
                reject(new Error(`ClawHub CLI entry not found at: ${this.cliEntryPath}`));
                return;
            }

            if (!this.useNodeRunner && !fs.existsSync(this.cliPath)) {
                reject(new Error(`ClawHub CLI not found at: ${this.cliPath}`));
                return;
            }

            const commandArgs = this.useNodeRunner ? [this.cliEntryPath, ...args] : args;
            const displayCommand = [this.cliPath, ...commandArgs].join(' ');
            console.log(`Running ClawHub command: ${displayCommand}`);

            fs.mkdirSync(source.workdir, { recursive: true });
            fs.mkdirSync(path.join(source.workdir, 'skills'), { recursive: true });

            const isWin = process.platform === 'win32';
            const useShell = isWin && !this.useNodeRunner;
            const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
            const env: NodeJS.ProcessEnv = {
                ...baseEnv,
                ...this.buildSourceEnv(source),
                CI: 'true',
                FORCE_COLOR: '0',
            };

            if (this.useNodeRunner) {
                env.ELECTRON_RUN_AS_NODE = '1';
            }
            const spawnCmd = useShell ? quoteForCmd(this.cliPath) : this.cliPath;
            const fullArgs = [...commandArgs, '--workdir', source.workdir, '--dir', 'skills'];
            const spawnArgs = useShell ? fullArgs.map(a => quoteForCmd(a)) : fullArgs;
            const child = spawn(spawnCmd, spawnArgs, {
                cwd: source.workdir,
                shell: useShell,
                env,
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (error) => {
                console.error('ClawHub process error:', error);
                reject(error);
            });

            child.on('close', (code) => {
                if (code !== 0 && code !== null) {
                    console.error(`ClawHub command failed with code ${code}`);
                    console.error('Stderr:', stderr);
                    reject(new Error(`Command failed: ${stderr || stdout}`));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    /**
     * Search for skills
     */
    async search(params: ClawHubSearchParams): Promise<ClawHubSearchResponse> {
        try {
            if (params.allSources || !params.sourceId) {
                const sources = (await listSkillSources()).filter((source) => source.enabled);
                const results = await Promise.allSettled(sources.map(async (source) => {
                    return await this.search({ ...params, sourceId: source.id, allSources: false });
                }));
                return {
                    results: results.flatMap((result) => result.status === 'fulfilled' ? result.value.results : []),
                };
            }

            const source = await this.resolveSource(params.sourceId);
            const normalizedQuery = params.query?.trim() || '';
            // If query is empty, use 'explore' to show trending skills
            if (!normalizedQuery) {
                return this.explore({ limit: params.limit, sourceId: source.id, cursor: params.cursor });
            }

            const cacheKey = buildMarketplaceSearchCacheKey(source, {
                query: normalizedQuery,
                limit: params.limit,
                cursor: params.cursor,
            });
            const cached = await readMarketplaceCache<ClawHubSearchResponse>(cacheKey);
            if (cached) {
                return cached;
            }

            const args = ['search', normalizedQuery];
            if (params.limit) {
                args.push('--limit', String(params.limit));
            }

            const output = await this.runCommand(args, { sourceId: source.id });
            if (!output || output.includes('No skills found')) {
                return { results: [] };
            }

            const lines = output.split('\n').filter(l => l.trim());
            const results = lines.map(line => {
                const cleanLine = this.stripAnsi(line);

                // Format could be: slug vversion description (score)
                // Or sometimes: slug  vversion  description
                let match = cleanLine.match(/^(\S+)\s+v?(\d+\.\S+)\s+(.+)$/);
                if (match) {
                    const slug = match[1];
                    const version = match[2];
                    let description = match[3];

                    // Clean up score if present at the end
                    description = description.replace(/\(\d+\.\d+\)$/, '').trim();

                    return {
                        slug,
                        name: slug,
                        version,
                        description,
                        sourceId: source.id,
                        sourceLabel: source.label,
                    } as ClawHubSkillResult;
                }

                // Fallback for new clawhub search format without version:
                // slug  name/description  (score)
                match = cleanLine.match(/^(\S+)\s+(.+)$/);
                if (match) {
                    const slug = match[1];
                    let description = match[2];

                    // Clean up score if present at the end
                    description = description.replace(/\(\d+\.\d+\)$/, '').trim();

                    return {
                        slug,
                        name: slug,
                        version: 'latest', 
                        description,
                        sourceId: source.id,
                        sourceLabel: source.label,
                    } as ClawHubSkillResult;
                }
                return null;
            });
            
            const response = { results: results.filter((s): s is ClawHubSkillResult => s !== null) };
            await writeMarketplaceCache(cacheKey, response, {
                ttlMs: MARKETPLACE_SEARCH_CACHE_TTL_MS,
                sourceId: source.id,
            });
            return response;
        } catch (error) {
            console.error('ClawHub search error:', error);
            throw error;
        }
    }

    /**
     * Explore trending skills
     */
    async explore(params: { limit?: number; sourceId?: string; cursor?: string } = {}): Promise<ClawHubSearchResponse> {
        try {
            const source = await this.resolveSource(params.sourceId);
            const limit = params.limit || 25;
            const cacheKey = buildMarketplaceSearchCacheKey(source, {
                query: '',
                limit,
                cursor: params.cursor,
            });
            const cached = await readMarketplaceCache<ClawHubSearchResponse>(cacheKey);
            if (cached) {
                return cached;
            }

            if (source.apiQueryEndpoint) {
                try {
                    const response = await this.fetchPublicSkills(source, limit, params.cursor);
                    await writeMarketplaceCache(cacheKey, response, {
                        ttlMs: MARKETPLACE_EXPLORE_CACHE_TTL_MS,
                        sourceId: source.id,
                    });
                    return response;
                } catch (httpError) {
                    console.warn(`Direct HTTP explore failed for ${source.id}, falling back to CLI:`, httpError);
                }
            }

            const args = ['explore', '--json', '--sort', 'trending'];
            if (params.limit) {
                args.push('--limit', String(params.limit));
            }

            const output = await this.runCommand(args, { sourceId: source.id });
            if (!output) return { results: [] };

            const jsonPart = output.substring(output.indexOf('{'));
            const data = JSON.parse(jsonPart);

            const items = Array.isArray(data.items) ? data.items : [];
            const response = {
                results: items.map((item: any) => ({
                    slug: item.slug,
                    name: item.name || item.slug,
                    version: item.version,
                    description: item.description,
                    author: item.author,
                    sourceId: source.id,
                    sourceLabel: source.label,
                })),
            };
            await writeMarketplaceCache(cacheKey, response, {
                ttlMs: MARKETPLACE_EXPLORE_CACHE_TTL_MS,
                sourceId: source.id,
            });
            return response;
        } catch (error) {
            console.error('ClawHub explore error:', error);
            return { results: [] };
        }
    }

    async getPublicSkillBySlug(params: { slug: string; sourceId?: string }): Promise<unknown> {
        const source = await this.resolveSource(params.sourceId);
        const cacheKey = buildMarketplaceDetailCacheKey(source, params.slug);
        const cached = await readMarketplaceCache<unknown>(cacheKey);
        if (cached) {
            return cached;
        }

        const data = await this.queryPublicSkills<unknown>(source, 'skills:getBySlug', [{ slug: params.slug }]);
        const detailValue = data?.value;
        if (!detailValue || typeof detailValue !== 'object') {
            return null;
        }

        const detail = detailValue as {
            latestVersion?: { _id?: string; files?: Array<{ path?: string }>; rawMarkdown?: string };
        };
        const latestVersionId = detail?.latestVersion?._id;
        const markdownPath = this.resolveMarketplaceMarkdownPath(detail?.latestVersion?.files);

        if (detail && latestVersionId && markdownPath) {
            try {
                const markdown = await this.queryPublicSkills<PublicSkillsFileTextResponse>(
                    source,
                    'skills:getFileText',
                    [{ versionId: latestVersionId, path: markdownPath }],
                    'action',
                );
                if (markdown?.value?.text !== undefined) {
                    detail.latestVersion = {
                        ...detail.latestVersion,
                        rawMarkdown: markdown.value.text,
                    };
                }
            } catch (error) {
                console.warn(`Failed to load marketplace markdown for ${params.slug} from ${source.id}:`, error);
            }
        }

        await writeMarketplaceCache(cacheKey, detail, {
            ttlMs: MARKETPLACE_DETAIL_CACHE_TTL_MS,
            sourceId: source.id,
        });
        return detail;
    }

    /**
     * Install a skill
     */
    async install(params: ClawHubInstallParams): Promise<void> {
        const source = await this.resolveSource(params.sourceId);
        const args = ['install', params.slug];

        if (params.version) {
            args.push('--version', params.version);
        }

        if (params.force) {
            args.push('--force');
        }

        let lastError: unknown;
        for (let attempt = 0; attempt <= ClawHubService.INSTALL_RETRY_COUNT; attempt += 1) {
            try {
                await this.runCommand(args, { sourceId: source.id });
                await invalidateMarketplaceCacheForSource(source.id);
                return;
            } catch (error) {
                lastError = error;
                const shouldRetry = this.isRetryableInstallError(error) && attempt < ClawHubService.INSTALL_RETRY_COUNT;
                if (!shouldRetry) {
                    throw error;
                }

                const delayMs = ClawHubService.INSTALL_RETRY_BASE_DELAY_MS * (2 ** attempt);
                console.warn(
                    `ClawHub install retry ${attempt + 1}/${ClawHubService.INSTALL_RETRY_COUNT} for ${params.slug} from ${source.id} after ${delayMs}ms: ${String(error)}`,
                );
                await this.delay(delayMs);
            }
        }

        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    /**
     * Uninstall a skill
     */
    async uninstall(params: ClawHubUninstallParams): Promise<void> {
        if (!params.sourceId) {
            const installed = await this.listInstalled();
            const matches = installed.filter((entry) => entry.slug === params.slug);
            if (matches.length === 0) {
                return;
            }
            for (const match of matches) {
                await this.uninstall({ ...params, sourceId: match.sourceId });
            }
            return;
        }
        const source = await this.resolveSource(params.sourceId);
        const fsPromises = fs.promises;

        const skillDir = path.join(source.workdir, 'skills', params.slug);
        if (fs.existsSync(skillDir)) {
            console.log(`Deleting skill directory: ${skillDir}`);
            await fsPromises.rm(skillDir, { recursive: true, force: true });
        }

        const lockFile = path.join(source.workdir, '.clawhub', 'lock.json');
        if (fs.existsSync(lockFile)) {
            try {
                const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
                if (lockData.skills && lockData.skills[params.slug]) {
                    console.log(`Removing ${params.slug} from lock.json`);
                    delete lockData.skills[params.slug];
                    await fsPromises.writeFile(lockFile, JSON.stringify(lockData, null, 2));
                }
            } catch (err) {
                console.error('Failed to update ClawHub lock file:', err);
            }
        }

        await invalidateMarketplaceCacheForSource(source.id);
    }

    /**
     * List installed skills
     */
    async listInstalled(sourceId?: string): Promise<ClawHubInstalledSkillResult[]> {
        if (!sourceId) {
            const sources = (await listSkillSources()).filter((source) => source.enabled);
            const results = await Promise.allSettled(sources.map(async (source) => await this.listInstalled(source.id)));
            return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
        }
        const source = await this.resolveSource(sourceId);
        try {
            const installed = await this.readInstalledSkillsFromLock(source.workdir);
            return installed.map((entry) => ({
                slug: entry.slug,
                version: entry.version,
                source: 'openclaw-managed',
                baseDir: path.join(source.workdir, 'skills', entry.slug),
                sourceId: source.id,
                sourceLabel: source.label,
            } satisfies ClawHubInstalledSkillResult));
        } catch (error) {
            console.error('ClawHub list error:', error);
            return [];
        }
    }

    async listSourceCounts(): Promise<ClawHubSourceCountResult[]> {
        const sources = (await listSkillSources()).filter((source) => source.enabled);
        const results = await Promise.allSettled(sources.map(async (source) => {
            const cacheKey = buildMarketplaceSourceCountCacheKey(source);
            const cached = await readMarketplaceCache<ClawHubSourceCountResult>(cacheKey);
            if (cached && typeof cached.total === 'number') {
                return cached;
            }
            if (cached) {
                await invalidateMarketplaceCacheKey(cacheKey);
            }

            const result = {
                sourceId: source.id,
                sourceLabel: source.label,
                total: await this.fetchPublicSkillCount(source),
            } satisfies ClawHubSourceCountResult;
            if (typeof result.total === 'number') {
                await writeMarketplaceCache(cacheKey, result, {
                    ttlMs: MARKETPLACE_SOURCE_COUNTS_CACHE_TTL_MS,
                    sourceId: source.id,
                });
            }
            return result;
        }));

        return results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }

            const source = sources[index];
            return {
                sourceId: source?.id || `source-${index}`,
                sourceLabel: source?.label,
                total: null,
            } satisfies ClawHubSourceCountResult;
        });
    }

    private async resolveSkillDir(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<string | null> {
        const candidates = [skillKeyOrSlug, fallbackSlug]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map(v => v.trim());
        const uniqueCandidates = [...new Set(candidates)];
        if (preferredBaseDir && preferredBaseDir.trim() && fs.existsSync(preferredBaseDir.trim())) {
            return preferredBaseDir.trim();
        }
        const sources = await listSkillSources();
        for (const source of sources) {
            const directSkillDir = uniqueCandidates
                .map((id) => path.join(source.workdir, 'skills', id))
                .find((dir) => fs.existsSync(dir));
            if (directSkillDir) {
                return directSkillDir;
            }
            const foundByName = this.resolveSkillDirByManifestName(uniqueCandidates, path.join(source.workdir, 'skills'));
            if (foundByName) {
                return foundByName;
            }
        }
        return null;
    }

    /**
     * Open skill README/manual in default editor
     */
    async openSkillReadme(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = await this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);

        // Try to find documentation file
        const possibleFiles = ['SKILL.md', 'README.md', 'skill.md', 'readme.md'];
        let targetFile = '';

        if (skillDir) {
            for (const file of possibleFiles) {
                const filePath = path.join(skillDir, file);
                if (fs.existsSync(filePath)) {
                    targetFile = filePath;
                    break;
                }
            }
        }

        if (!targetFile) {
            // If no md file, just open the directory
            if (skillDir) {
                targetFile = skillDir;
            } else {
                throw new Error('Skill directory not found');
            }
        }

        try {
            // Open file with default application
            await shell.openPath(targetFile);
            return true;
        } catch (error) {
            console.error('Failed to open skill readme:', error);
            throw error;
        }
    }

    /**
     * Open skill path in file explorer
     */
    async openSkillPath(skillKeyOrSlug: string, fallbackSlug?: string, preferredBaseDir?: string): Promise<boolean> {
        const skillDir = await this.resolveSkillDir(skillKeyOrSlug, fallbackSlug, preferredBaseDir);
        if (!skillDir) {
            throw new Error('Skill directory not found');
        }
        const openResult = await shell.openPath(skillDir);
        if (openResult) {
            throw new Error(openResult);
        }
        return true;
    }

    async listSources(): Promise<SkillSourceConfig[]> {
        return await listSkillSources();
    }

    inferSourceFromBaseDir(baseDir: string | undefined, sources: SkillSourceConfig[]): SkillSourceConfig | undefined {
        return inferSkillSourceFromBaseDir(baseDir, sources);
    }
}
