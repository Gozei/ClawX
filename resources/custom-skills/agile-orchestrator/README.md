# 敏捷开发 Skill 体系

> 创世神敏捷研发助手 | 围绕敏捷闭环的"小而专"Skill 集合

## 一、体系概览

### 设计理念

**先 Skill，后 Agent；先闭环，后编排；先高频，后复杂。**

- ✅ **先 Skill 后 Agent**：先做可复用的标准动作，再组合成 Agent
- ✅ **先闭环后编排**：先做需求→拆解→开发→测试最小闭环，再做总控
- ✅ **先高频后复杂**：先做每天都能用的高频场景，再做复杂治理

### 体系架构

```
敏捷开发 Skill 体系
│
├── 总控层
│   └── agile-orchestrator    任务路由 + 状态管理 + 用户引导
│
├── 执行层（核心 4 个）
│   ├── agile-requirement     需求澄清（用户故事 + AC）
│   ├── agile-backlog         任务拆解（故事点估算）
│   ├── agile-code-review     代码审查（质量 + 安全）
│   └── agile-qa              测试验收（用例生成）
│
├── 扩展层（后续扩展）
│   ├── agile-dev             开发实现（代码生成）
│   └── agile-retro           发布复盘（总结改进）
│
└── 方法论层
    ├── 用户故事拆解规范
    ├── 任务拆解与估算指南
    ├── 代码审查清单
    ├── 测试用例设计规范
    └── 迭代复盘模板
```

---

## 二、Skill 清单

### 2.1 总控 Skill

| Skill | 文件位置 | 核心能力 | 触发词 |
|-------|---------|---------|--------|
| **agile-orchestrator** | `skills/agile-orchestrator/SKILL.md` | 意图识别、任务路由、状态管理、用户引导 | 计划、站会、迭代、sprint、看板 |

### 2.2 执行层 Skill

| Skill | 文件位置 | 核心能力 | 触发词 |
|-------|---------|---------|--------|
| **agile-requirement** | `skills/agile-requirement/SKILL.md` | 用户故事生成、验收标准编写、风险识别 | 需求、用户故事、PRD、验收标准、AC |
| **agile-backlog** | `skills/agile-backlog/SKILL.md` | 任务拆解、故事点估算、依赖识别 | 拆解、任务、backlog、估算、故事点 |
| **agile-code-review** | `skills/agile-code-review/SKILL.md` | 代码审查、安全识别、PR 审查报告 | 审查、review、代码审查、PR、merge |
| **agile-qa** | `skills/agile-qa/SKILL.md` | 测试用例生成、边界设计、验收报告 | 测试、用例、QA、验收、bug、回归 |

### 2.3 扩展层 Skill（待创建）

| Skill | 核心能力 | 优先级 |
|-------|---------|--------|
| **agile-dev** | 代码生成、PR 描述、变更说明 | P2 |
| **agile-retro** | 发布检查清单、复盘总结、改进行动 | P3 |

---

## 三、触发词总表

### 需求类（路由到 agile-requirement）

| 触发词 | 示例句式 |
|--------|---------|
| 需求 | "帮我分析这个需求" |
| 用户故事 | "写个用户故事" |
| PRD | "这个 PRD 帮我理清一下" |
| 功能说明 | "功能说明是这样的..." |
| 验收标准 | "验收标准是什么" |
| AC | "生成 AC" |

### 拆解类（路由到 agile-backlog）

| 触发词 | 示例句式 |
|--------|---------|
| 拆解 | "把这个需求拆解一下" |
| 分解 | "分解成任务" |
| 任务 | "生成任务列表" |
| backlog | "生成 sprint backlog" |
| sprint | "下轮 sprint 怎么排" |
| 估算 | "估算多少故事点" |
| 故事点 | "这个任务多少故事点" |

### 审查类（路由到 agile-code-review）

| 触发词 | 示例句式 |
|--------|---------|
| 审查 | "帮我审查这段代码" |
| review | "review 这个 PR" |
| 代码审查 | "代码审查一下" |
| PR | "这个 PR 能合并吗" |
| merge | "merge 请求审查" |
| pull request | "pull request 审查" |

### 测试类（路由到 agile-qa）

| 触发词 | 示例句式 |
|--------|---------|
| 测试 | "生成测试用例" |
| 用例 | "测试用例怎么写" |
| QA | "QA 验收" |
| 验收 | "怎么验收这个功能" |
| bug | "这个 bug 怎么复现" |
| 回归 | "回归测试范围" |

### 总控类（路由到 agile-orchestrator）

| 触发词 | 示例句式 |
|--------|---------|
| 计划 | "sprint 计划" |
| 站会 | "每日站会" |
| 迭代 | "迭代总结" |
| sprint | "sprint 规划" |
| 看板 | "看板管理" |
| 燃尽 | "燃尽图" |

---

## 四、使用流程

### 4.1 典型使用场景

#### 场景 1：需求→拆解→开发→测试 完整流程

```
1. 用户说："帮我写个用户故事，用户能上传头像"
   → 触发 agile-requirement
   → 输出：用户故事 + AC + 风险项

2. 用户说："拆解一下这个需求"
   → 触发 agile-backlog
   → 输出：任务列表 + 故事点估算

3. 用户说："生成测试用例"
   → 触发 agile-qa
   → 输出：测试用例清单

4. 开发完成后，用户说："review 这段代码"
   → 触发 agile-code-review
   → 输出：审查报告
```

#### 场景 2：单独使用某个 Skill

```
用户说："帮我 review 这个 PR：[粘贴代码]"
→ 触发 agile-code-review
→ 输出：审查报告
```

### 4.2 引导系统

**首次触发**：显示完整引导卡片（能力说明 + 使用方式 + 执行流程）

**后续触发**：显示精简提示

**执行中**：显示进度提示（进度条 + 预计剩余时间）

**完成后**：显示完成提示 + 下一步选项

---

## 五、方法论整合

### 5.1 通用方法论调用

| Skill | 调用方法论 | 调用方式 |
|-------|-----------|---------|
| agile-requirement | 穿透式发散审查 v3.0-Final | 六维展开分析需求 |
| agile-backlog | 主动思考 v3.0-Final | 三层思维估算故事点 |
| agile-code-review | Critical Thinking v3.0-Final | 审视问题判断准确性 |
| agile-orchestrator | CREAC v2.0 | 结构化输出审查结论 |

### 5.2 敏捷方法论

| 方法论 | 文件位置 | 用途 |
|--------|---------|------|
| 用户故事拆解规范 | `methodologies/agile/用户故事拆解规范.md` | 需求分析标准 |
| 任务拆解与估算指南 | `methodologies/agile/任务拆解与估算指南.md` | 任务规划标准 |
| 代码审查清单 | `methodologies/agile/代码审查清单.md` | 代码审查标准 |
| 测试用例设计规范 | `methodologies/agile/测试用例设计规范.md` | 测试设计标准 |
| 迭代复盘模板 | `methodologies/agile/迭代复盘模板.md` | 复盘总结标准 |

---

## 六、向量库存储设计

### 6.1 存储集合

| 集合 | 用途 | 存储内容 |
|------|------|---------|
| `execution_memory` | 执行记忆 | 需求分析、任务拆解、代码审查记录 |
| `outputs` | 输出结果 | 最终版用户故事、Backlog、审查报告 |
| `keywords` | 关键词 | 触发词、任务分类、路由决策 |

### 6.2 存储触发点

| 节点 | 存储内容 | 集合 |
|------|---------|------|
| 需求澄清完成 | 用户故事 + AC + 风险项 | execution_memory |
| 任务拆解完成 | 任务列表 + 估算 + 依赖 | execution_memory |
| 代码审查完成 | 审查报告 + 问题清单 | execution_memory |
| 测试验收完成 | 测试用例 + 验收报告 | outputs |

---

## 七、文件结构

```
C:\Users\likew\.openclaw\workspace-agent-3\
├── skills/
│   ├── agile-orchestrator/
│   │   ├── SKILL.md                    # 总控技能
│   │   ├── user-guide-templates.md     # 用户引导模板
│   │   ├── routing-config.md           # 路由配置
│   │   └── README.md                   # 本文件
│   ├── agile-requirement/
│   │   └── SKILL.md                    # 需求澄清
│   ├── agile-backlog/
│   │   └── SKILL.md                    # 任务拆解
│   ├── agile-code-review/
│   │   └── SKILL.md                    # 代码审查
│   └── agile-qa/
│       └── SKILL.md                    # 测试验收（待创建）
│
└── methodologies/
    └── agile/
        ├── 用户故事拆解规范.md
        ├── 任务拆解与估算指南.md          # 待创建
        ├── 代码审查清单.md
        ├── 测试用例设计规范.md            # 待创建
        └── 迭代复盘模板.md                # 待创建
```

---

## 八、版本信息

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-21 | 初始版本（创世神） |
| - | - | 已创建：agile-orchestrator、agile-requirement、agile-backlog、agile-code-review |
| - | - | 待创建：agile-qa、agile-dev、agile-retro |

---

## 九、下一步行动

### 待创建 Skill

1. **agile-qa**（P2）- 测试验收
2. **agile-dev**（P2）- 开发实现
3. **agile-retro**（P3）- 发布复盘

### 待创建方法论

1. **任务拆解与估算指南** - 配合 agile-backlog
2. **测试用例设计规范** - 配合 agile-qa
3. **迭代复盘模板** - 配合 agile-retro

### 配置工作

1. **路由配置** - 在 agent-3 配置中注册触发词路由规则
2. **会话状态管理** - 实现会话状态机
3. **向量库集成** - 配置 execution_memory 集合访问

---

**体系创建者**：创世神  
**审核状态**：待大雄确认  
**最后更新**：2026-04-21
