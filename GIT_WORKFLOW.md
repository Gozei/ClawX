# Git 分支与提交流程规范

本文档定义 Deep AI Worker 项目的分支管理、提交信息、Pull Request 和发布流程规范。

## 长期分支

- `main` 是生产发布分支，只保存已经充分测试并准备发布的稳定代码。
- `develop` 是 staging 总分支，用于集成日常开发改动并进行测试验证。
- 所有开发分支都应基于最新的 `develop` 创建。
- 日常功能、修复和维护改动通过 Pull Request 合并回 `develop`。
- 只有当 `develop` 分支经过充分测试后，才可以发布或合并到 `main`。

## 分支命名

分支命名使用以下格式：

```text
<owner>/<type>/<short-description>
```

示例：

```text
tommy/feat/dashboard
will/fix/audit-error-braces
fai/refactor-country-list
tommy/chore/update-fixture-data
```

## 分支类型

- `feat` - 新功能
- `fix` - 问题修复
- `chore` - 维护、配置、依赖或数据更新
- `refactor` - 代码重构，不改变预期行为
- `test` - 测试相关改动
- `poc` - 概念验证或实验性改动
- `doc` - 文档、说明更新
- `hotfix` - 线上紧急问题修复

## 描述规则

- 使用小写英文单词，并用连字符 `-` 分隔。
- 描述应简短但有明确含义。
- 优先描述业务或技术意图，不建议只使用 ticket 编号。

推荐：

```text
will/feat/internal-rate-rules
tommy/fix/save-shipment-pickup-time
```

避免：

```text
will/feat/work
tommy/fix/bug
```

## Pull Request 规则

- 每个分支只处理一个功能、修复或维护任务。
- 每个分支对应一个 Pull Request。
- 请求 review 前应先运行项目要求的检查。
- 不要在同一个分支中混入无关的格式化、清理或重构。
- 不要提交密钥、API Key、凭证或本地环境配置文件。
- 日常开发 Pull Request 的目标分支应为 `develop`。
- 发布 Pull Request 的目标分支应为 `main`，来源分支应为已经充分测试的 `develop`。
- Pull Request 名称应与 commit message 规范保持一致。

## 提交信息与 PR 名称

提交信息和 Pull Request 名称使用以下格式：

```text
<type>: <short summary>
```

示例：

```text
feat: add internal rate rules
fix: save shipment pickup time correctly
chore: update fixture data
refactor: simplify quotation handler
hotfix: fix payment callback error
```

规则：

- `type` 应与分支类型保持一致，例如 `feat`、`fix`、`chore`、`refactor`、`test`、`poc`、`doc`、`hotfix`。
- `short summary` 使用英文小写开头，简短描述本次改动。
- Pull Request 名称应优先使用主要 commit 的语义。
- 如果一个 Pull Request 包含多个 commit，整体 PR 名称应概括该分支的最终目的。

对应关系示例：

```text
分支名：will/feat/internal-rate-rules
提交信息：feat: add internal rate rules
PR 名称：feat: add internal rate rules
```

## 发布规则

- `develop` 对应 staging 环境或集成测试环境。
- 合并到 `develop` 后，应在 staging 环境完成必要的功能验证、回归测试和冒烟测试。
- `develop` 测试通过后，才允许发布到 `main`。
- `main` 应始终保持可发布状态。
- 不允许未经 `develop` 验证的普通开发分支直接合并到 `main`。

## Hotfix 规则

`hotfix` 用于处理线上生产环境的紧急问题，流程与普通 `fix` 不同。

### 分支命名

```text
<owner>/hotfix/<short-description>
```

示例：

```text
will/hotfix/payment-callback-error
tommy/hotfix/shipment-label-failed
```

### 处理流程

- `hotfix` 分支应从最新的 `main` 创建。
- 修复完成后，Pull Request 目标分支应为 `main`。
- 合并到 `main` 前，应完成最小必要验证，确保线上问题被修复且没有明显回归。
- 发布到 `main` 后，必须将修复同步回 `develop`。
- 可以通过 `main -> develop` 的 Pull Request 同步，也可以在确认安全的情况下将 `main` 合并回 `develop`。
- 不允许只修复 `main` 而不回合到 `develop`，否则后续从 `develop` 发布时可能覆盖线上修复。

创建 `hotfix` 分支：

```bash
git checkout main
git pull
git checkout -b <owner>/hotfix/<short-description>
```

修复并发布后，同步回 `develop`：

```bash
git checkout develop
git pull
git merge main
```

## 推荐工作流

```bash
git checkout main
git pull
git checkout develop
git pull
git checkout -b <owner>/<type>/<short-description>
```

完成开发后：

```bash
git status
git add .
git commit -m "<type>: <short summary>"
git push -u origin <owner>/<type>/<short-description>
```

然后创建 Pull Request，合并目标为 `develop`。

发布时，从已经充分测试的 `develop` 创建 Pull Request 到 `main`。
