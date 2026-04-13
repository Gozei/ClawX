/**
 * ClawHub Service
 * Manages interactions with the ClawHub CLI for skills management
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { getOpenClawConfigDir, ensureDir, getClawHubCliBinPath, getClawHubCliEntryPath, quoteForCmd } from '../utils/paths';
import { getSkillSourceById, inferSkillSourceFromBaseDir, listSkillSources, type SkillSourceConfig } from '../utils/skill-sources';

export interface ClawHubSearchParams {
    query: string;
    limit?: number;
    sourceId?: string;
    allSources?: boolean;
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

export interface ClawHubInstalledSkillResult {
    slug: string;
    version: string;
    source?: string;
    baseDir?: string;
    sourceId?: string;
    sourceLabel?: string;
}

export class ClawHubService {
    private cliPath: string;
    private cliEntryPath: string;
    private useNodeRunner: boolean;
    private ansiRegex: RegExp;

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

            const env: Record<string, string | undefined> = {
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
    async search(params: ClawHubSearchParams): Promise<ClawHubSkillResult[]> {
        try {
            if (params.allSources || !params.sourceId) {
                const sources = (await listSkillSources()).filter((source) => source.enabled);
                const results = await Promise.allSettled(sources.map(async (source) => {
                    return await this.search({ ...params, sourceId: source.id, allSources: false });
                }));
                return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
            }

            const source = await this.resolveSource(params.sourceId);
            // If query is empty, use 'explore' to show trending skills
            if (!params.query || params.query.trim() === '') {
                return this.explore({ limit: params.limit, sourceId: source.id });
            }

            const args = ['search', params.query];
            if (params.limit) {
                args.push('--limit', String(params.limit));
            }

            const output = await this.runCommand(args, { sourceId: source.id });
            if (!output || output.includes('No skills found')) {
                return [];
            }

            const lines = output.split('\n').filter(l => l.trim());
            return lines.map(line => {
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
                    };
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
                        version: 'latest', // Fallback version since it's not provided
                        description,
                        sourceId: source.id,
                        sourceLabel: source.label,
                    };
                }
                return null;
            }).filter((s): s is ClawHubSkillResult => s !== null);
        } catch (error) {
            console.error('ClawHub search error:', error);
            throw error;
        }
    }

    /**
     * Explore trending skills
     */
    async explore(params: { limit?: number; sourceId?: string } = {}): Promise<ClawHubSkillResult[]> {
        try {
            const source = await this.resolveSource(params.sourceId);
            const args = ['explore'];
            if (params.limit) {
                args.push('--limit', String(params.limit));
            }

            const output = await this.runCommand(args, { sourceId: source.id });
            if (!output) return [];

            const lines = output.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const cleanLine = this.stripAnsi(line);

                // Format: slug vversion time description
                // Example: my-skill v1.0.0 2 hours ago A great skill
                const match = cleanLine.match(/^(\S+)\s+v?(\d+\.\S+)\s+(.+? ago|just now|yesterday)\s+(.+)$/i);
                if (match) {
                    return {
                        slug: match[1],
                        name: match[1],
                        version: match[2],
                        description: match[4],
                        sourceId: source.id,
                        sourceLabel: source.label,
                    };
                }
                return null;
            }).filter((s): s is ClawHubSkillResult => s !== null);
        } catch (error) {
            console.error('ClawHub explore error:', error);
            throw error;
        }
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

        await this.runCommand(args, { sourceId: source.id });
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

        // 1. Delete the skill directory
        const skillDir = path.join(source.workdir, 'skills', params.slug);
        if (fs.existsSync(skillDir)) {
            console.log(`Deleting skill directory: ${skillDir}`);
            await fsPromises.rm(skillDir, { recursive: true, force: true });
        }

        // 2. Remove from lock.json
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
            const output = await this.runCommand(['list'], { sourceId: source.id });
            if (!output || output.includes('No installed skills')) {
                return [];
            }

            const lines = output.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const cleanLine = this.stripAnsi(line);
                const match = cleanLine.match(/^(\S+)\s+v?(\d+\.\S+)/);
                if (match) {
                    const slug = match[1];
                    return {
                        slug,
                        version: match[2],
                        source: 'openclaw-managed',
                        baseDir: path.join(source.workdir, 'skills', slug),
                        sourceId: source.id,
                        sourceLabel: source.label,
                    };
                }
                return null;
            }).filter((s): s is ClawHubInstalledSkillResult => s !== null);
        } catch (error) {
            console.error('ClawHub list error:', error);
            return [];
        }
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
