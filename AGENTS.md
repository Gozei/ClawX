# AGENTS.md — AI Agent 行为指令

> 本文件定义 AI Agent（Claude / Copilot 等）在本项目中工作时必须遵守的行为规则。
> 架构概览见 [OVERVIEW.md](./OVERVIEW.md)。

## 开发命令速查

| 操作 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 首次初始化 | `pnpm run init`（install + 下载 uv） |
| 开发服务器 | `pnpm dev`（自动先执行 `predev` 准备预装技能） |
| 类型检查 | `pnpm run typecheck` |
| Lint | `pnpm run lint`（eslint --fix） |
| 单元测试 | `pnpm test`（vitest run，jsdom 环境） |
| E2E 测试 | `pnpm run test:e2e`（需先 build:vite） |
| 生产构建 | `pnpm run build`（vite build + bundle + electron-builder） |
| 仅 Vite 构建 | `pnpm run build:vite` |
| 环境重置 | `pnpm run fresh` |
| 通信回归重放 | `pnpm run comms:replay` |
| 通信基线刷新 | `pnpm run comms:baseline` |
| 通信回归对比 | `pnpm run comms:compare` |

## 编码规范

### TypeScript
- **严格模式**：`strict: true`，`noUnusedLocals` / `noUnusedParameters` 启用
- 未使用的变量/参数用 `_` 前缀忽略：`_unused`
- 禁止裸 `any`（ESLint `@typescript-eslint/no-explicit-any: warn`），优先用具体类型或 `unknown`

### 路径别名
- `@/*` → `src/*`
- `@electron/*` → `electron/*`

### React
- React 19 + JSX transform，无需手动 `import React`
- Hooks 规则由 `eslint-plugin-react-hooks` 强制
- 组件导出遵循 `react-refresh/only-export-components` 规则，允许常量导出

### IPC 安全红线（ESLint 强制）

**Renderer 进程（src/）中：**
- **禁止** 直接调用 `window.electron.ipcRenderer.invoke`，必须使用 `@/lib/api-client` 中的 `invokeIpc`
- **禁止** 从 Renderer 直接 `fetch` localhost/127.0.0.1 端点，所有后端请求必须走 `host-api` / `api-client` 代理

这两条规则已编码在 `eslint.config.mjs` 的 `no-restricted-syntax` 中，lint 失败即违规。

## 测试要求

### 单元测试（Vitest + jsdom）
- 测试文件位于 `tests/unit/`
- 命名：`*.test.ts` 或 `*.spec.ts`
- 环境：jsdom，setup 在 `tests/setup.ts`
- 运行：`pnpm test`
- 覆盖率：`pnpm test -- --coverage`

### E2E 测试（Playwright + Electron）
- 测试文件位于 `tests/e2e/`
- 需要先构建：`pnpm run build:vite`
- 运行：`pnpm run test:e2e`
- 有头模式调试：`pnpm run test:e2e:headed`

### 测试策略
- 修改 `electron/` 逻辑必须补对应 `tests/unit/` 测试
- 修改 UI 页面或组件必须补 `tests/e2e/` 测试
- 新增 API 路由必须补单元测试覆盖正常+异常路径

## Git 工作流

详见 [GIT_WORKFLOW.md](./GIT_WORKFLOW.md)

## 架构约束

### 双进程隔离
- **Renderer 不直接访问 Gateway**：所有后端调用必须经 Main 进程的 Host API Server（port 13210）代理
- **IPC 通信唯一入口**：Renderer 通过 `src/lib/api-client.ts` → `contextBridge` → Main Process
- **数据流**：Renderer UI → host-api → api-client → IPC → Main → Host API → Gateway（WS/HTTP）

### 安全存储
- Provider API Key 与 OAuth Token 存储在 OS Keychain，**禁止**明文存储到 JSON 文件或代码中
- Keychain 操作跨平台差异：macOS Keychain / Windows Credential Manager / Linux Secret Service

### Gateway 进程管理
- Gateway 作为独立子进程运行，由 `electron/gateway/` 的 21 个模块管理生命周期
- Gateway 配置同步：Main → Gateway，不可反向覆盖
- Gateway 异常时由 `supervisor.ts` + `restart-governor.ts` 自动重连，无需手动重启

### Provider 体系
- Provider 注册类型定义在 `electron/shared/providers/`，Main/Renderer 共享
- Provider 运行时管理在 `electron/services/providers/`
- 新增 Provider 必须同时更新注册表和运行时服务

## 常见陷阱

1. **Renderer 直接 fetch Gateway** — 会被 ESLint 拦截，但即使绕过 lint 也会因 CORS 失败
2. **绕过 api-client 直接调用 IPC** — 会被 ESLint `no-restricted-syntax` 拦截，必须用 `invokeIpc`
3. **在 electron-store 中存储密钥** — 密钥必须走 Keychain（`services/secrets/`）
4. **Gateway 配置反向覆盖** — 配置同步方向是 Main → Gateway，反向写入会丢失
5. **E2E 测试未先 build** — Playwright E2E 需要 `build:vite` 产物，直接运行会失败
6. **scratch/ 目录** — 实验性代码，不影响构建，不要在生产代码中 import 它
7. **pnpm 版本** — pnpm 版本通过 `package.json` 的 `packageManager` 锁定，需 `corepack enable && corepack prepare` 激活正确版本后再安装
8. **headless Linux dbus 错误** — `Failed to connect to the bus` 在无头/云环境中是预期行为，设置 `$DISPLAY`（如 Xvfb `:1`）即可正常运行
9. **lint 与 uv:download 竞态** — 刚运行 `pnpm run uv:download` 后，ESLint 可能因临时目录 `/workspace/temp_uv_extract` 已被清理而报 `ENOENT`，等下载脚本完成后再跑 lint 即可
10. **构建脚本警告** — `pnpm install` 可能对 `@discordjs/opus` 和 `koffi` 报 ignored build scripts 警告，这些是可选的消息通道依赖，可安全忽略
11. **Gateway 启动耗时** — `pnpm dev` 时 Gateway 在 port 18789 自动启动，需 10-30s 就绪；UI 开发不依赖它（显示 "connecting" 状态）
12. **无需数据库** — 应用使用 `electron-store`（JSON）和 OS Keychain，无需数据库
13. **AI Provider key 非必须** — 实际 AI 聊天需配置至少一个 Provider API Key（Settings > AI Providers），但无 key 时应用仍可完整导航和测试
14. **Token Usage History 来源** — Dashboard 的 Token Usage 历史从 OpenClaw 会话转录 `.jsonl` 文件解析，非 console log；`.deleted.jsonl` 和 `.jsonl.reset.*` 也视为有效历史源，从 `message.usage` 提取 input/output/cache/total tokens 及 cost
15. **Models 页时间窗口** — 7d/30d 筛选是 rolling window（滚动窗口），非按月分桶；按时间分组时图表保留窗口内所有日期桶，仅 model 分组做 top-N 截断
16. **OpenClaw Doctor 调用** — Settings > Advanced > Developer 中的 `Run Doctor` / `Run Doctor Fix` 通过 host-api 暴露，Renderer 须调用 host 路由，不可直接 spawn CLI 进程
17. **传输策略由 Main 控制** — 传输协议为 `WS → HTTP → IPC` 三层 fallback，策略由 Main 进程管理，Renderer 不应实现协议切换逻辑
18. **通信路径变更 checklist** — 改动涉及 gateway events、runtime send/receive、delivery 或 fallback 时，推送前必须运行 `pnpm run comms:replay` 和 `pnpm run comms:compare`
19. **UI 变更须补 E2E 测试** — 任何用户可见的 UI 变更必须在同 PR 中补充或更新 Playwright E2E spec
20. **文档同步规则** — 功能或架构变更后，须检查 `README.md` 和 `README.zh-CN.md` 是否需要更新；若行为/流程/接口有变，须在同 PR/commit 中更新文档

## CHANGELOG 格式规范

每次发版前，在 `CHANGELOG.md` 顶部添加新版本块，格式如下：

```markdown
## v{x.y.z}

[此版本的核心价值，一句话]

### 新功能
- [一句话描述]

### 问题修复
- [一句话描述]
```

### 格式要求

- 每个条目只需一句话描述，简洁明了
- 描述必须是完整的一句话，末尾不加句号
- 新功能按影响力排序，问题修复按严重程度排序
- 发版前执行 `pnpm run release-notes` 自动将最新版本段提取为 `release-notes.md`，供 electron-builder 写入 yml 的 `releaseNotes` 字段
- `release-notes.md` 由脚本自动生成，勿手动编辑（已在 `.gitignore` 中）
