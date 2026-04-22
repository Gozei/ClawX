# 对话式工具使用指南

本指南说明如何通过自然语言对话使用前端开发工具，无需手动运行命令。

---

## 🎯 使用方式

### 方式 1: 直接对话（推荐）

直接在对话中描述你的需求，AI 会自动调用相应工具。

### 方式 2: 命令行调用

使用 `frontend_tools.py` 脚本，支持自然语言输入。

---

## 📦 组件生成

### 对话示例

**简单组件**:
> "帮我生成一个按钮组件"

**带属性的组件**:
> "创建一个用户卡片组件，显示姓名、邮箱、头像，带编辑和删除按钮"

**指定框架**:
> "用 Vue 3 写一个产品列表组件，支持搜索和分页"

### AI 处理流程

1. **解析需求**: 从自然语言提取组件名、属性、框架
2. **生成代码**: 调用 `component_generator.py`
3. **输出结果**: 显示生成的文件和代码结构

### 输出示例

```
✅ 组件已生成：src/components/UserProfile

📁 生成的文件:
  - UserProfile.tsx
  - UserProfile.types.ts
  - UserProfile.module.css
  - UserProfile.test.tsx
  - index.ts

📝 组件信息:
  - 类型：REACT
  - 名称：UserProfile
  - Props: 3 个
    • name: string
    • email: string
    • avatar: string

💡 下一步:
  1. 在 src/components/UserProfile/UserProfile.tsx 中实现组件逻辑
  2. 运行测试：npm test -- UserProfile
  3. 在页面中导入使用
```

### 支持的属性识别

| 中文描述 | 生成的 Prop | 类型 |
|----------|------------|------|
| 姓名/名字 | name | string |
| 邮箱/邮件 | email | string |
| 头像 | avatar | string |
| 年龄 | age | number |
| 电话 | phone | string |
| 标题 | title | string |
| 内容/描述 | content/description | string |
| 编辑按钮 | onEdit | function |
| 删除按钮 | onDelete | function |
| 保存按钮 | onSave | function |
| 点击事件 | onClick | function |
| 加载状态 | loading | boolean |
| 禁用状态 | disabled | boolean |

---

## 🔍 代码审查

### 对话示例

**基础审查**:
> "帮我审查这段代码有什么问题"
> [粘贴代码]

**严格审查**:
> "严格审查这段代码，包括性能和安全"
> [粘贴代码]

**专项审查**:
> "检查这段代码的安全隐患"
> [粘贴代码]

### AI 处理流程

1. **接收代码**: 从对话中提取代码片段
2. **自动审查**: 调用 `code_reviewer.py` (50+ 规则)
3. **输出报告**: 按严重程度排序问题
4. **提供建议**: 给出具体修复方案

### 输出示例

```
📋 代码审查报告：代码片段

❌ [ERROR] security-no-dangerous-html
   dangerouslySetInnerHTML 有 XSS 风险，确保内容已净化

⚠️ [WARNING] no-explicit-any
   避免使用 any 类型，使用 unknown 或具体类型

⚠️ [WARNING] react-no-array-index-key
   避免使用数组索引作为 key

ℹ️ [INFO] react-component-name
   组件名 "myComponent" 应使用 PascalCase

总计：1 错误，2 警告，1 建议

🔧 修复建议:
  💡 使用 DOMPurify.sanitize() 净化 HTML 内容
  💡 将 `any` 替换为具体类型或 `unknown`
  💡 使用唯一 ID 作为 key，如 `item.id`
```

### 检查规则分类

**错误 (Error)**:
- 安全漏洞 (XSS、硬编码密钥)
- 严重语法问题

**警告 (Warning)**:
- 类型问题 (any 类型)
- 性能问题 (数组索引 key)
- 规范问题 (console.log)

**建议 (Info)**:
- 命名规范
- 代码长度
- 最佳实践

---

## 🏗️ 项目创建

### 对话示例

**React 项目**:
> "帮我创建一个 React 项目，用于后台管理系统"

**Next.js 项目**:
> "创建一个 Next.js 项目，要做 SaaS 仪表盘"

**Vue 项目**:
> "用 Vue 3 + Vite 创建一个电商前台项目"

### AI 处理流程

1. **理解需求**: 确定框架、项目类型
2. **选择模板**: 匹配合适的项目模板
3. **生成结构**: 调用 `project_scaffold.py`
4. **输出指南**: 提供下一步操作说明

### 输出示例

```
✅ 项目已创建：my-saas-dashboard

📁 项目结构:
  ├── package.json
  ├── tsconfig.json
  ├── vite.config.ts
  ├── src
  │   ├── main.tsx
  │   ├── App.tsx
  │   ├── components
  │   ├── hooks
  │   └── utils
  └── ...

⚙️ 技术栈:
  - 框架：REACT
  - 语言：TypeScript
  - 构建：Vite
  - 测试：Vitest + Testing Library

🚀 下一步:
  cd my-saas-dashboard
  npm install
  npm run dev

📦 可用命令:
  npm run dev      - 开发服务器
  npm run build    - 生产构建
  npm run test     - 运行测试
  npm run lint     - 代码检查
```

### 支持的项目类型

| 项目类型 | 推荐框架 | 默认配置 |
|----------|----------|----------|
| 后台管理系统 | React | Ant Design + React Query |
| SaaS 仪表盘 | Next.js | Tailwind + Recharts |
| 电商前台 | Vue 3 | Vant + Pinia |
| 组件库 | React | Rollup + Storybook |
| 文档站点 | Next.js | MDX + Nextra |
| 落地页 | React | Tailwind + Framer Motion |

---

## 📊 依赖检查

### 对话示例

**基础检查**:
> "检查项目的依赖有没有问题"

**安全审查**:
> "检查有没有安全漏洞"

**更新建议**:
> "看看哪些依赖需要更新"

### AI 处理流程

1. **定位项目**: 找到 package.json
2. **运行检查**: 调用 `dependency_checker.py`
3. **输出报告**: 过时依赖 + 安全漏洞
4. **提供建议**: 更新命令

### 输出示例

```
📦 依赖检查报告

⚠️  发现 8 个过时的依赖:
  - react: 18.2.0 → 18.3.1
  - react-dom: 18.2.0 → 18.3.1
  - axios: 1.6.0 → 1.6.5
  - @types/react: 18.2.43 → 18.3.1
  ... 还有 4 个

❌ 发现 3 个安全漏洞:
  🟠 HIGH: 1
  🟡 MODERATE: 2

💡 运行 `npm audit fix` 修复自动可修复的漏洞
```

---

## 🎨 高级用法

### 组合使用

**场景 1: 创建项目 → 生成组件 → 审查代码**

> "帮我创建一个 Next.js 项目"
> "生成一个仪表盘组件"
> "审查一下这个组件的代码"

**场景 2: 审查现有代码 → 生成新组件 → 检查依赖**

> "审查这段代码" [粘贴]
> "帮我修复这些问题"
> "检查项目依赖是否安全"

### 上下文理解

AI 会记住对话上下文，支持连续操作：

```
用户：创建一个用户管理组件
AI: ✅ 已生成 UserProfile 组件

用户：再帮我生成一个列表组件
AI: ✅ 已生成 UserList 组件（自动关联到 UserProfile）

用户：给列表组件添加搜索功能
AI: ✅ 已更新 UserList，添加搜索框和过滤逻辑
```

---

## 💡 最佳实践

### 1. 描述要具体

❌ "生成一个组件"  
✅ "生成一个产品卡片组件，显示图片、名称、价格，带购买按钮"

### 2. 提供上下文

❌ "审查代码"  
✅ "审查这段 React 组件代码，重点关注性能问题"

### 3. 指定技术栈

❌ "创建项目"  
✅ "用 Next.js 14 创建一个 SaaS 项目，需要用户认证和数据可视化"

### 4. 迭代优化

```
用户：生成一个按钮组件
AI: ✅ 已生成

用户：添加 loading 状态支持
AI: ✅ 已更新 Button 组件

用户：再添加图标支持
AI: ✅ 已更新，支持 leftIcon 和 rightIcon props
```

---

## 🔧 命令行模式

如果需要手动运行，支持以下命令：

```bash
# 组件生成（自然语言）
uv run python scripts/frontend_tools.py --action component --input "创建一个用户卡片，显示姓名和邮箱"

# 代码审查
uv run python scripts/frontend_tools.py --action review --input "代码内容..."

# 项目创建（JSON 配置）
uv run python scripts/frontend_tools.py --action project --config config.json

# 依赖检查
uv run python scripts/frontend_tools.py --action deps
```

---

## 📝 反馈和改进

如果工具没有正确理解你的需求：

1. **重试**: 换一种说法重新描述
2. **补充**: 提供更多细节
3. **指定**: 明确说明框架、属性等
4. **反馈**: 告诉 AI 哪里理解错了

示例：
```
❌ "生成那个组件"（太模糊）
✅ "生成一个产品列表组件，用 React，支持分页和排序"
```

---

## 🎯 完整示例

### 场景：从零开始创建功能

```
用户：帮我创建一个 Next.js 项目，用于电商后台

AI: ✅ 项目已创建：ecommerce-admin
    - 包含用户认证、商品管理、订单管理等模块
    - 技术栈：Next.js 14 + TypeScript + Tailwind CSS

用户：生成一个商品列表组件，带搜索和分页

AI: ✅ 组件已生成：ProductTable
    - 支持关键词搜索
    - 支持分页
    - 支持排序
    - 包含完整测试

用户：审查一下这个组件的代码

AI: 📋 代码审查报告
    - 发现 2 个警告
    - 提供修复建议
    - 已自动修复

用户：检查项目依赖是否安全

AI: 📦 依赖检查报告
    - 发现 3 个过时依赖
    - 无安全漏洞
    - 建议更新命令
```

---

通过对话式工具，你可以专注于业务逻辑，让 AI 处理重复性的代码工作！🚀
