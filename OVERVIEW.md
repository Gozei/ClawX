# Deep AI Worker — Architecture Overview

> **项目名**：`deep-ai-worker`（包名见 `package.json`）| **主分支**：`main`

## 整体架构

**Deep AI Worker** 是一款基于 Electron 的跨平台桌面 AI 工作区应用，封装 OpenClaw AI Agent Runtime，将 CLI 编排能力转化为可视化桌面体验。采用双进程架构（Main + Renderer），通过 IPC 通信，Renderer 不直接访问 Gateway HTTP，所有后端调用经由 Main 进程代理。

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Deep AI Worker Desktop App                      │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                Electron Main Process (electron/)                │  │
│  │  • 窗口/应用生命周期管理 (main/)                                 │  │
│  │  • Gateway 进程监督与启动 (gateway/)                             │  │
│  │  • Host API HTTP Server (api/, port 13210) — Renderer↔Gateway  │  │
│  │  • Provider/Secrets/Skills 服务 (services/)                     │  │
│  │  • 系统集成：托盘、通知、Keychain、自更新 (utils/)               │  │
│  └───────┬────────────────────────────────────┬───────────────────┘  │
│          │ IPC (contextBridge/preload)         │ Gateway 事件推送     │
│          ▼                                    │ (WS → Main → IPC)    │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              React Renderer Process (src/)                      │  │
│  │  • 页面：Chat/Agents/Channels/Cron/Dream/Models/Skills/Settings│  │
│  │  • 状态管理：Zustand stores (src/stores/)                       │  │
│  │  • API 层：host-api + api-client (src/lib/)                    │  │
│  │  • 国际化：i18n (en/zh)                                        │  │
│  │  • UI：Radix/shadcn + Tailwind CSS + Framer Motion              │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ Host API (port 13210)
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway (独立子进程)                      │
│  • AI Agent 运行时与编排                                              │
│  • 消息通道管理 (WeChat/DingTalk/WeCom/Telegram)                    │
│  • Skill/Plugin 执行环境                                             │
│  • Provider 抽象层 (OpenAI/Anthropic/Custom)                        │
│  • WebSocket (port 18789) + HTTP API                                │
└──────────────────────────────────────────────────────────────────────┘
```

**数据流路径**：Renderer UI → `host-api.ts`/`api-client.ts` → IPC → Main Process → Host API Server → OpenClaw Gateway (WS/HTTP)。Gateway 事件反向推送至 Main → IPC → Renderer stores 更新。

## 子项目明细

### src（Renderer 渲染进程）

- **定位**：用户界面层，提供 Chat、Agents、Channels、Cron、Dream、Models、Skills、Settings 等完整桌面交互体验
- **技术栈**：React 19 + TypeScript + Zustand（状态管理）+ React Router v7 + Tailwind CSS + Radix UI/shadcn + Framer Motion + i18next（国际化 en/zh）+ react-markdown + Lucide Icons
- **核心模块**：
  - `pages/` — 10 个核心页面（Chat、Agents、Channels、Cron、Dashboard、Dream、Models、Settings、Setup、Skills）
  - `stores/` — Zustand 状态仓（agents, channels, chat, chat/, cron, gateway, guide, providers, settings, skills, update）
  - `lib/` — API 层（host-api.ts、api-client.ts）与错误模型，Renderer 唯一后端调用入口
  - `components/` — 可复用 UI 组件（branding, channels, common, guides, layout, settings, ui）
  - `i18n/` — 国际化（en/zh）
  - `hooks/` — 自定义 React hooks
  - `types/` — TypeScript 类型定义（agent, channel, cron, gateway, skill, electron.d.ts）

### electron（Main 进程 + Preload）

- **定位**：Electron 主进程，负责系统级集成、Gateway 生命周期管理、安全存储与 IPC 桥接
- **技术栈**：Node.js + TypeScript + Electron 40+ + ws（WebSocket）+ electron-store + electron-updater + node-machine-id + sharp + cos-nodejs-sdk-v5（COS 上传）
- **核心模块**：
  - `main/` — 应用入口、窗口创建、IPC handlers 注册、系统托盘、自更新、代理设置、退出生命周期、单实例锁
  - `gateway/` — OpenClaw Gateway 进程管理器（21 个模块：启动编排、配置同步、心跳重连、重启治理、连接监控、WS 客户端、请求存储、事件分发、ClawHub 服务发现等），构成完整的 Gateway 监督体系
  - `api/` — Host API HTTP Server（port 13210），路由定义在 `api/routes/`（12 个模块：agents, app, channels, cron, files, gateway, logs, providers, sessions, settings, skills, usage），CORS + token 认证
  - `services/providers/` — AI Provider 管理（CRUD、验证、运行时同步、迁移、stale 清理）
  - `services/secrets/` — OS Keychain 安全存储
  - `services/skills/` — Skill 市场缓存
  - `preload/` — 安全 IPC Bridge，暴露有限 API 给 Renderer
  - `utils/` — 51 个工具模块，涵盖配置、日志、认证、OAuth、Token Usage、LibreOffice 集成、代理等
  - `shared/providers/` — Provider 注册表与类型定义，跨 Main/Renderer 共享

### shared（跨进程共享类型）

- **定位**：Main 进程与 Renderer 进程之间共享的 TypeScript 类型与常量定义，避免类型重复
- **技术栈**：TypeScript（纯类型/常量模块，零运行时依赖）
- **核心模块**：
  - `agent-execution.ts` — Agent 执行配置、Workflow 节点类型
  - `branding.ts` — 品牌配置（产品名、厂商名、中英标语）
  - `file-preview.ts` — 文件预览窗口请求类型
  - `inbound-user-text.ts` — 入站消息文本清洗与元数据提取逻辑
  - `language.ts` — 语言代码解析（en/zh）
  - `logging.ts` — 日志级别、审计模式、日志条目类型定义

### scripts（构建与工具脚本）

- **定位**：构建打包、资源准备与通信回归测试的脚本集合
- **技术栈**：Node.js + zx（Shell 脚本化 JS）+ Playwright（E2E）
- **核心模块**：
  - `bundle-openclaw.mjs` — 将 openclaw npm 包及其全量传递依赖打包为自包含目录
  - `bundle-openclaw-plugins.mjs` — 打包第三方 OpenClaw 插件（钉钉/企微/微信）
  - `bundle-preinstalled-skills.mjs` — 打包预装技能（pdf/xlsx/docx/pptx 等）
  - `download-bundled-uv.mjs` — 下载 uv Python 包管理器二进制
  - `download-bundled-node.mjs` — 下载嵌入式 Node.js 二进制（Windows）
  - `generate-icons.mjs` — 图标生成
  - `upload-release-to-cos.mjs` — 发布到腾讯 COS
  - `patch-openclaw-prompts.mjs` — OpenClaw prompt 补丁
  - `fresh.mjs` — 环境重置
  - `after-pack.cjs` — electron-builder 打包后钩子
  - `prepare-preinstalled-skills-dev.mjs` — 开发环境预装技能准备
  - `setup-zx-shell.mjs` — zx shell 环境配置
  - `crop_qr.py` — 二维码裁剪工具
  - `installer.nsh` — NSIS 安装程序自定义脚本
  - `linux/` — Linux 桌面集成文件
  - `manual/` — 用户手册资源
  - `comms/` — 通信回归测试套件（replay, baseline, compare, datasets）

### tests（测试）

- **定位**：应用逻辑的单元测试与 Electron E2E 集成测试
- **技术栈**：Vitest（单元）+ Playwright（E2E）+ Testing Library + jsdom
- **核心模块**：
  - `unit/` — 108 个单元测试文件，覆盖 Gateway 管理、Provider 服务、API 路由、聊天运行时、设置同步、Token Usage、技能管理等核心逻辑
  - `e2e/` — 47 个 E2E spec，覆盖 setup 向导、导航、聊天流、频道、定时任务、设置、Provider 生命周期、Dream 模式、文件预览等关键用户流程
  - `setup.ts` — 测试基础设施配置
  - `e2e/fixtures/` — Playwright Electron fixture 共享

### scratch（实验/临时）

- **定位**：临时实验与 API 探索脚本，不参与正式构建
- **技术栈**：Node.js / 临时脚本
- **核心模块**：仅包含 `api_result.json` 与 `test_convex_api.js`，为早期 API 验证残留

## 共享基础设施

### 数据持久化
- **本地存储**：`electron-store`（JSON 文件），存储应用设置（`~/.openclaw/openclaw.json` 与 `electron-store` 默认路径）
- **安全存储**：OS Keychain（macOS Keychain / Windows Credential Manager / Linux Secret Service），用于 Provider API Key 与 OAuth Token
- **会话转录**：OpenClaw `.jsonl` 会话转录文件，Dashboard 的 Token Usage 历史从这些结构化记录中解析

### 通信与代理
- **Host API Server**（Main 进程，port 13210）：Renderer → Main 的唯一 HTTP 通道，内置 token 认证，12 个路由模块
- **Gateway 通信**：Main 进程通过 WebSocket（port 18789）与 OpenClaw Gateway 通信，支持 IPC/WS/HTTP 三层传输回退
- **CORS 安全设计**：Renderer 不直接请求 Gateway HTTP，所有请求经 Main 代理

### AI Provider 体系
- Provider 注册表定义在 `electron/shared/providers/`，Main/Renderer 共享
- Provider 运行时由 `ProviderService`（`electron/services/providers/`）管理，支持多个 Provider（OpenAI、Anthropic、Custom-Compatible、Moonshot 等），含 OAuth 登录流程（OpenAI Codex、Gemini CLI、Device OAuth 等）
- Provider 配置双向同步：UI 编辑 → Main 存储 → Gateway 运行时

### Skill/Plugin 体系
- 内置预装技能（`bundle-preinstalled-skills.mjs`）：pdf、xlsx、docx、pptx、find-skills、self-improving-agent、tavily-search、brave-web-search
- 第三方 OpenClaw 插件打包：钉钉（`@soimy/dingtalk`）、企微（`@wecom/wecom-openclaw-plugin`）、微信（`@tencent-weixin/openclaw-weixin`）
- Skill Market 来源（`skill-sources.json`）：ClawHub + DeepSkillHub（具体技能列表以实际配置文件为准）

### 子项目依赖关系

```
src/ (Renderer)
  ├── imports shared/ (类型/常量)
  ├── imports @electron/shared/providers/ (Provider 注册类型)
  └── calls electron/ via IPC (host-api → api-client → contextBridge → Main)

electron/ (Main)
  ├── imports shared/ (类型/常量)
  ├── manages Gateway subprocess (openclaw npm package)
  └── serves Host API Server (api/) → Renderer

tests/
  ├── unit/ tests electron/ + src/ + shared/ logic
  └── e2e/ tests full Electron app via Playwright

scripts/
  └── invoked by pnpm scripts, not imported at runtime

scratch/
  └── standalone experiments, no dependencies to other subprojects
```
