---
name: legal-compliance-hub
description: 法务合规一体化技能中心。用于合同审查、合规审计、监管框架映射、风险评分、隐私与数据保护评估、跨境数据合规、企业法务与合规路线图输出。当用户提到合同审查、NDA、MSA、SaaS协议、供应商合同、劳动合同、合规审计、SOC 2、ISO 27001、GDPR、个人信息保护法、数据安全法、网络安全法、PCI DSS、跨境数据、监管框架、风险矩阵、修复路线图、隐私保护、法律战略建议时使用。
---

# Legal Compliance Hub

按以下流程处理法务/合规工作：

1. 先判断任务属于哪个模块：
   - 合同审查 → 读 `references/contract-review.md`
   - 合规审计 → 读 `references/compliance-audit.md`
   - 监管框架/跨境数据/隐私保护 → 读 `references/regulatory-frameworks.md`
   - 风险评分/修复路线图 → 读 `references/risk-scoring.md`
2. 先做框架选择，再做信息收集，不要直接给零散建议。
3. 只收集低敏感或经脱敏的信息；不要要求真实密码、完整证件号、生产密钥、完整个人信息。
4. 输出统一包含：概述、发现、风险评分、修复建议、附录/免责声明。
5. 始终附注：**本报告由 AI 辅助生成，仅供参考，不构成法律意见。具体法律问题请咨询持牌律师。**

## 通用工作流

### Step 1. 框架选择
根据场景选择适用框架或模块：
- 合同条款与谈判风险 → 合同审查
- 控制措施、证据、成熟度 → 合规审计
- 多司法辖区/跨境数据/隐私影响评估 → 监管框架
- 风险矩阵、优先级、90天整改 → 风险评分

### Step 2. 信息收集
优先收集以下低敏感信息：
- 行业、企业规模、业务区域、技术架构概况
- 数据类型概览、现有控制措施、已知差距
- 合同类型、审查目标、适用法律、相对方类型（可脱敏）

禁止主动索取：
- 真实账号密码、生产密钥
- 完整个人身份信息
- 未脱敏商业秘密或生产配置

### Step 3. 分析执行
按所选参考文件中的清单/模型执行：
- 合同审查用 CLAUSE-RISK
- 合规审计用 AUDIT-5P
- 监管分析用 MULTI-JURISDICTION
- 风险输出用 RISK-SCORE

### Step 4. 输出交付
默认输出结构：
1. 概述
2. 发现
3. 风险评分
4. 修复建议（短期/中期/长期）
5. 附录与免责声明

## 模块导航
- 合同审查：`references/contract-review.md`
- 合规审计：`references/compliance-audit.md`
- 监管框架与隐私保护：`references/regulatory-frameworks.md`
- 风险评分与路线图：`references/risk-scoring.md`
