---
name: frontend-dev
description: 专业前端开发技能，支持 React/Vue/Next.js 组件开发、TypeScript 编码、状态管理、API 集成、性能优化、代码审查、单元测试、CI/CD 配置、Docker 部署。使用场景：生成组件代码、审查代码质量、调试问题、架构设计、性能优化、测试编写、项目脚手架、CI/CD 配置。
---

# Frontend Development Skill

专业级前端研发技能，聚焦现代 Web 应用开发全流程。

## 核心能力

### 1. 组件开发
- React/Vue/Next.js 组件生成和重构
- TypeScript 类型定义和接口设计
- Hooks/Composables 封装
- 响应式设计和状态管理
- **自动生成测试文件** (Vitest + Testing Library)

### 2. 代码质量
- 代码审查（ESLint 规则、最佳实践）
- 性能优化建议（渲染优化、bundle 大小）
- 可访问性检查（WCAG 标准）
- 安全漏洞扫描（XSS、CSRF 防护）
- **增强的审查规则** (50+ 检查项)

### 3. 架构设计
- 项目结构规划
- 状态管理方案（Redux/Zustand/Pinia）
- API 集成模式（React Query/SWR）
- 微前端架构
- **5+ 完整项目案例参考**

### 4. 工程化
- 构建配置（Vite/Webpack/Next.js）
- 测试策略（Jest/Vitest/Cypress/Playwright）
- **CI/CD 流程** (GitHub Actions 模板)
- **Docker 部署配置** (多阶段构建)
- 代码规范配置

## 工作流程

### 组件开发流程
```
1. 需求分析 → 2. 接口设计 → 3. 组件实现 → 4. 测试编写 → 5. 文档生成
```

**对话式使用**:
> "帮我生成一个用户卡片组件，显示姓名、邮箱、头像，带编辑按钮"

AI 会自动调用 `component_generator.py` 生成完整代码（含测试）。

### 代码审查流程
```
1. 语法检查 → 2. 类型安全 → 3. 性能分析 → 4. 安全审计 → 5. 优化建议
```

**对话式使用**:
> "帮我审查这段代码" [粘贴代码]

AI 会自动调用 `code_reviewer.py` 进行审查并给出修复建议。

### 项目创建流程
```
1. 选择框架 → 2. 配置选项 → 3. 生成脚手架 → 4. 安装依赖
```

**对话式使用**:
> "帮我创建一个 Next.js 项目，用于 SaaS 仪表盘"

AI 会自动调用 `project_scaffold.py` 生成完整项目结构。

### 问题排查流程
```
1. 错误定位 → 2. 日志分析 → 3. 复现步骤 → 4. 根因分析 → 5. 修复方案
```

## 技术栈支持

### 核心框架
- **React 18+**: Hooks, Context, Server Components
- **Vue 3+**: Composition API, Pinia
- **Next.js 14+**: App Router, Server Actions
- **Angular 15+**: Standalone Components, Signals

### 语言
- TypeScript 5+ (严格模式)
- JavaScript ES2022+

### 样式
- Tailwind CSS
- CSS Modules
- Styled Components
- Sass/Less

### 构建工具
- Vite (首选)
- Webpack 5
- Turbopack
- Next.js Build

### 测试
- Vitest/Jest (单元测试)
- React Testing Library / Vue Test Utils
- Cypress/Playwright (E2E)

### 部署
- Docker (多阶段构建)
- Nginx (反向代理配置)
- Vercel/Netlify
- GitHub Pages

## 脚本工具

| 脚本 | 用途 | 示例 |
|------|------|------|
| `scripts/component_generator.py` | 生成组件模板（含测试） | `uv run python scripts/component_generator.py --type react --name UserProfile --props "name:string,email:string"` |
| `scripts/code_reviewer.py` | 代码审查（50+ 规则） | `uv run python scripts/code_reviewer.py --file src/components/Button.tsx --strict` |
| `scripts/project_scaffold.py` | 项目脚手架（支持 Next.js） | `uv run python scripts/project_scaffold.py --framework nextjs --name my-app` |
| `scripts/dependency_checker.py` | 依赖检查 | `uv run python scripts/dependency_checker.py` |

## 参考文档

| 文档 | 内容 |
|------|------|
| `references/coding_standards.md` | 编码规范、命名约定、代码风格 |
| `references/component_patterns.md` | 组件设计模式、最佳实践 (10+ 模式) |
| `references/performance_guide.md` | 性能优化清单、指标监控 (Core Web Vitals) |
| `references/security_checklist.md` | 安全检查清单、常见漏洞防护 (OWASP Top 10) |
| `references/testing_guide.md` | 测试策略、用例编写指南 (单元/集成/E2E) |
| `references/project_examples.md` | **5 个完整项目案例** (电商/SaaS/移动端/组件库/表单) |
| `references/dialogue_usage_guide.md` | **🆕 对话式工具使用指南** (自然语言调用) |

## 项目模板

`assets/templates/` 包含预配置的项目模板和配置：

### 框架模板
- `react-vite-ts/` - React + Vite + TypeScript
- `vue-vite-ts/` - Vue 3 + Vite + TypeScript
- `nextjs-app/` - Next.js 14 App Router

### CI/CD 配置
- `github-ci.yml` - GitHub Actions ( lint/test/build/deploy)
- `dockerfile` - Docker 多阶段构建
- `docker-compose.yml` - Docker Compose 配置
- `nginx.conf` - Nginx 生产配置

## 快速开始

### 生成新组件（含测试）
```bash
uv run python scripts/component_generator.py --type react --name Button --props "label:string,onClick:function,disabled:boolean"
```

生成文件:
- `Button.tsx` - 组件实现
- `Button.types.ts` - 类型定义
- `Button.module.css` - 样式
- `Button.test.tsx` - **单元测试**
- `index.ts` - 导出

### 审查代码
```bash
uv run python scripts/code_reviewer.py --file src/App.tsx --strict
```

### 创建新项目
```bash
# React + Vite
uv run python scripts/project_scaffold.py --framework react --name my-app --build vite

# Next.js 14
uv run python scripts/project_scaffold.py --framework nextjs --name my-app
```

### 使用 CI/CD 模板
```bash
# 复制 GitHub Actions 配置
cp assets/templates/github-ci.yml .github/workflows/ci.yml

# 复制 Docker 配置
cp assets/templates/Dockerfile .
cp assets/templates/docker-compose.yml .
```

## 触发场景

### 对话式使用（推荐）

直接用自然语言描述需求，AI 会自动调用工具：

**组件生成**:
> "帮我生成一个用户卡片组件，显示姓名、邮箱、头像，带编辑按钮"

**代码审查**:
> "帮我审查这段代码有什么问题" [粘贴代码]

**项目创建**:
> "创建一个 Next.js 项目，用于 SaaS 仪表盘"

**依赖检查**:
> "检查项目依赖有没有安全漏洞"

### 传统使用场景

使用此 skill 当需要：
- ✅ 生成 React/Vue/Next.js 组件代码（含测试）
- ✅ 审查前端代码质量（50+ 检查规则）
- ✅ 解决 TypeScript 类型问题
- ✅ 优化应用性能（Core Web Vitals）
- ✅ 设计组件架构（10+ 设计模式）
- ✅ 编写单元测试/集成测试/E2E 测试
- ✅ 配置构建工具（Vite/Webpack/Next.js）
- ✅ 排查运行时错误
- ✅ 创建新项目脚手架（React/Vue/Next.js）
- ✅ 配置 CI/CD 流程（GitHub Actions）
- ✅ Docker 部署配置
- ✅ 参考完整项目案例（5+ 实战案例）
- ✅ **对话式工具调用**（自然语言交互）

## 项目案例参考

查看 `references/project_examples.md` 获取完整案例：

1. **电商后台管理系统** - React + Ant Design + React Query
2. **SaaS 数据仪表盘** - Next.js 14 + Tailwind + Recharts
3. **移动端 H5 应用** - Vue 3 + Vant + Pinia
4. **组件库开发** - TypeScript + Rollup + Storybook
5. **表单密集型应用** - React Hook Form + Zod

每个案例包含：
- 完整项目结构
- 核心代码实现
- 性能优化方案
- 最佳实践建议

## 改进记录

### v2.1 (对话集成)
- ✅ 新增 `frontend_tools.py` 对话集成脚本
- ✅ 支持自然语言组件生成请求
- ✅ 支持对话式代码审查
- ✅ 支持对话式项目创建
- ✅ 支持对话式依赖检查
- ✅ 新增 `dialogue_usage_guide.md` 使用指南
- ✅ 智能属性识别（中文描述自动映射到 props）
- ✅ 上下文理解（支持连续对话操作）

### v2.0 (工程化增强)
- ✅ 增加 Next.js 14 项目模板支持
- ✅ 组件生成自动包含测试文件
- ✅ 添加 CI/CD 配置模板（GitHub Actions）
- ✅ 添加 Docker 部署配置（多阶段构建）
- ✅ 添加 Nginx 生产配置
- ✅ 增加 5 个完整项目案例
- ✅ 代码审查规则扩展到 50+ 项
- ✅ 增强测试生成（props 测试）
