# Project Workbench V1 设计方案

> - 状态：待人工审核
> - 目标平台：DeepSeek Harness（DSH）Cordis 插件
> - 目标版本：V1，单人使用的 AI Native 项目驾驶舱
> - 更新日期：2026-08-31
> 本文档通过多轮需求澄清和 grilling 压力测试形成；审核通过前不进入功能开发。

## 1. 摘要

Project Workbench 是运行在 DeepSeek Harness 上的 AI Native 项目驾驶舱。它不是单纯的任务看板，也不是聊天机器人套壳，而是把项目治理、飞书协同、项目文件、证据化记忆、AI Agent Team 和人工审批组合成一个可追溯的工作系统。

产品内核不限定项目类型，通过版本化项目模板适配知识工作、软件/产品研发及通用项目。V1 先交付并验证“知识工作项目”模板，但核心领域模型和扩展接口不得写死为知识工作专用。

V1 先由 Owner 一个人使用，但项目中可以配置两类成员：

- 不登录 Workbench 的真实人类成员，可绑定飞书身份并承担任务。
- 具备明确职责、模型、工具、预算和权限的 AI 项目成员。

AI 不只负责总结，还作为受控项目成员执行 Mission、生成交付物草稿、跟踪日程、识别风险、整理课题和提出项目变更。所有自动化都必须服从证据、权限、预算、评审和审计规则。

## 2. 产品目标与边界

### 2.1 V1 核心目标

V1 必须完成以下闭环：

1. 建立项目、目标、里程碑、交付物、风险、课题和决策的统一治理视图。
2. 以飞书任务作为执行任务事实源，以飞书日历作为正式时间事实源。
3. 统一浏览和检索 Workbench 托管文件、本地目录与飞书资料。
4. 由六角色 AI Agent Team 受控执行项目工作。
5. 自动生成项目进度摘要、风险雷达、课题整理、决策和行动建议。
6. 所有 AI 事实都能追溯到证据，所有正式副作用都能追溯到授权。
7. 在一个真实知识工作项目上连续运行至少 14 天并通过验收门槛。

### 2.2 V1 明确不做

- 不开放多人 Workbench 登录、公开注册或账号邀请；这些属于二阶段。
- 不实现 SaaS 原生多租户；一套实例服务一个组织。
- 不把 DSH 的实验性 Agent Teams 状态作为项目事实源。
- 不把 Workbench 设计成任意实体关系的完整低代码平台。
- 不做任意系统之间的无约束双向同步。
- 不提供 Office 文件的完整在线编辑或像素级浏览器渲染。
- 不允许 Agent 自动删除、移动或重命名宿主文件。
- V1 个人使用阶段不做业务数据库和 AI 审计的应用层静态加密。

### 2.3 交付策略

V1 作为一个完整版本交付，不向用户拆分为多个阶段性版本。工程实现仍需按依赖顺序、feature flag 和内部集成里程碑推进，但只有本文档的完整范围通过验收后才能标记 V1 完成。

## 3. 设计原则

### 3.1 一个领域只能有一个事实源

Workbench 采用联邦事实源，而不是让所有数据都复制到本地后互相覆盖。每个领域只允许一个权威来源，其他系统保存投影、索引或引用。

### 3.2 AI 建议与正式事实分离

AI 提取的内容默认进入观察层或建议层。只有权威系统事件、人工确认或预先批准的有限自动化才能形成正式事实或外部副作用。

### 3.3 权限和数据外发是两套边界

Agent 有权读取某项内容，不等于可以把该内容发送给任意模型提供商。来源权限、数据分级和模型信任区必须同时满足。

### 3.4 确定性规则负责安全和计算

权限、幂等、预算、调度、风险严重度、概率排期、循环防护和版本冲突由代码决定。LLM 负责语义理解、解释和建议，不承担安全门禁或数值真相。

### 3.5 所有重要结论均可追溯

事实、推断和建议必须分开表达。事实性主张必须引用证据；下游产物要能追踪到来源、模型、Agent Profile 和批准记录。

## 4. 用户、组织与成员模型

### 4.1 租户与账号

V1 使用“单组织、多团队”的数据模型，但运行时只有一个可登录的 Owner：

- 首次启动创建唯一 Owner。
- 不开放自助注册、邀请或其他登录账号。
- Owner 使用密码登录，密码使用 Argon2id 哈希。
- 初始化时生成只显示一次的离线恢复码。
- 提供仅本机可执行的凭据重置流程。
- 会话使用 HttpOnly、Secure、SameSite Cookie。
- 登录、登出、失败尝试和恢复操作全部进入安全审计。

所有业务记录预留 `organizationId`，但 V1 不提供跨组织管理界面或多租户配额。

### 4.2 统一成员身份

所有责任主体统一建模为 `ProjectMember`：

```ts
type ProjectMemberKind = 'human' | 'agent'

interface ProjectMember {
  id: string
  organizationId: string
  kind: ProjectMemberKind
  displayName: string
  status: 'active' | 'inactive'
  userId?: string
  larkOpenId?: string
  externalContact?: ExternalContact
  agentProfileVersionId?: string
}
```

- 人类成员可以不绑定 Workbench 账号。
- 有飞书身份的人类成员可直接成为飞书任务负责人。
- 无飞书身份的外部联系人仍可进入成员名册，但必须指定可追踪的人类 Sponsor。
- 二阶段成员注册或受邀登录后，可认领已有成员身份，历史责任、评论和审计不变。
- Agent 成员绑定具体 Agent Profile 版本、模型路由、能力策略和预算。

### 4.3 责任规则

飞书任务、Risk、Deliverable、Mission 等可执行对象采用：

- 唯一 `accountableMemberId`
- 多个 `contributorMemberIds`
- 可选 `humanSponsorMemberId`

Agent 可以成为执行任务的唯一 Accountable，但必须有一个人类 Sponsor。Sponsor 负责权限扩展、异常升级、正式验收和业务后果。

## 5. 联邦事实源架构

### 5.1 领域权威矩阵

| 领域 | 权威来源 | Workbench 的职责 |
|---|---|---|
| Goal、Outcome、Project、Milestone | Workbench | 保存、治理、审计 |
| Topic、Risk、Decision、Deliverable | Workbench | 保存、评审、关联证据 |
| 计划基线、依赖、容量、预测 | Workbench | 计算和版本化 |
| Mission、Agent 产物、项目记忆 | Workbench | 持久化和审计 |
| 执行任务、子任务、负责人、完成状态 | 飞书任务 | 同步投影、增强分析 |
| 会议、提醒、里程碑日期、关键截止日 | 飞书日历 | 同步投影、风险计算 |
| 飞书文档、妙记、群聊、审批正文 | 飞书 | 授权读取、索引和引用 |
| Workbench 托管文件 | Workbench 文件库 | 保存和版本化 |
| 本地挂载文件 | 宿主文件系统 | 安全读写、索引和冲突检测 |

### 5.2 每个项目的绑定

创建项目时必须完成：

1. 选择项目模板版本。
2. 指定主 Goal 和项目 Owner。
3. 新建或绑定一个飞书主任务清单。
4. 新建或绑定一个飞书项目日历。
5. 配置项目成员和飞书身份映射。
6. 选择要绑定的飞书文档树、群聊、妙记和审批范围。
7. 可选配置 Workbench 文件库和本地目录挂载。
8. 配置 Agent Team、数据分级、模型路由和提醒策略。

### 5.3 同步模型

- 飞书事件订阅负责低延迟更新。
- 周期性 reconciliation 负责发现漏事件和修复漂移。
- 本地写入业务事务、outbox 和审计事件必须原子提交。
- 外部写入使用稳定幂等键、版本令牌、有限重试和死信状态。
- 外部事件进入 inbox，按资源版本和事件 ID 去重。
- 权限不足与资源 ACL 不可见必须区分，禁止静默切换 Bot/User 身份绕过。
- 同步冲突不采用最后写入者自动覆盖，必须遵守该领域的权威来源。

## 6. 项目领域模型

### 6.1 目标与项目

- 一个 Project 必须有一个主 Goal。
- Project 可以关联多个辅助 Goal。
- 一个 Goal 可以由多个 Project 共同贡献。
- Goal 包含一个或多个可衡量 Outcome。
- AI 报告必须区分任务完成、交付验收和 Outcome 变化。

### 6.2 里程碑

Milestone 由 Workbench 保存业务语义，但正式日期关联飞书日历事件。飞书日历事件版本是日期权威；Workbench 保存绑定关系、同步状态和历史快照。

### 6.3 Deliverable

Deliverable 是一等实体，不是飞书任务的一种类型：

- 名称、说明和验收标准
- Accountable、Contributor 和验收人
- 正式截止日对应的飞书日历事件
- 关联飞书任务、Topic、Decision 和 Risk
- 候选产物、正式文件版本和发布记录
- 评审状态和最终验收结果

执行 Deliverable 所需的动作仍由飞书任务承载。

### 6.4 Risk

Risk 是独立风险台账：

- 风险事件描述
- 类别和触发器
- 概率区间、影响区间和置信度
- 计算得到的暴露等级
- 风险 Owner、状态和复审日期
- 证据、假设和依赖
- 缓解任务和应急任务引用

AI 发现先形成 `RiskCandidate`。人工确认后才创建正式 Risk。严重度由确定性规则基于概率和影响计算，LLM 不直接决定红黄绿。

### 6.5 Topic

Topic 统一承载两类项目课题：

- `research`：需要研究和验证的问题。
- `issue`：已经发生、需要解决的执行问题。

两类 Topic 共享以下内容：

- 事实和证据
- 假设和反证
- 未决问题
- 结论
- 关联 Decision、Risk 和任务
- 行动和复审时间

两种类型使用不同状态机，但不拆成重复的领域模块。

### 6.6 Decision

Decision 是独立决策日志：

- 所解决的问题
- 候选方案
- 最终选择
- 决策理由和反对意见
- 证据和假设
- 决策人、生效时间和复审条件
- 对 Goal、Topic、Risk、Milestone、Deliverable 和任务的影响

### 6.7 评论和外部确认

评论随对象的事实源保存：

- 飞书任务评论保存在飞书，Workbench 只同步展示和索引。
- Workbench 自有对象的评论保存在本地。
- 跨系统引用保存 canonical URL、资源 ID 和证据快照。

线下成员的评审或验收采用“带证据的代录证明”：

```ts
interface ExternalAttestation {
  assertedByMemberId: string
  recordedByUserId: string
  assertedAt: string
  recordedAt: string
  result: 'approved' | 'rejected' | 'needs_changes'
  evidenceRefs: string[]
}
```

系统不得将代录显示成线下成员亲自登录操作。

## 7. 模板、工作流与计划

### 7.1 版本化模板

模板不是持续强制继承，也不是一次性无记录初始化，而是版本化基线：

- 项目创建时保存模板版本和独立快照。
- 项目可在权限范围内调整流程状态、可选字段、视图和 AI 策略。
- 核心实体关系、系统字段、权限、审计和安全不变量不可修改。
- 模板升级先生成差异预览，再由 Owner 选择应用。
- 已被项目或飞书任务使用的字段和状态选项不得被破坏性删除。

### 7.2 V1 模板编辑器

V1 提供受控模板编辑器，可配置：

- 领域术语
- 飞书任务类型和自定义字段
- 多状态工作流
- 默认视图和驾驶舱组件
- 项目创建向导
- 默认 Agent Team
- AI 数据源与运行策略
- PMO 提醒节奏
- 自动化规则

不支持通过模板创建任意新实体或任意关系。

### 7.3 飞书任务工作流

- 每个项目绑定一个飞书主任务清单。
- 模板中的多状态工作流写入飞书任务自定义字段。
- 自定义字段值以飞书为权威。
- Workbench 负责字段 schema、选项映射、校验和升级差异。
- 进入终态可以提出飞书任务完成动作，但实际完成必须由 Owner 确认。
- 飞书任务智能体只作为一个 `Project Workbench` 应用门面，内部 Agent 角色由 Workbench 记录。

### 7.4 飞书日历权威

飞书日历对所有正式时间承诺拥有权威：

- 会议和例会
- PMO 提醒
- Milestone 日期
- Deliverable 截止日
- 关键任务的开始与截止承诺

Workbench 业务对象通过 `CalendarBinding` 关联飞书事件。飞书事件发生变更时，Workbench 更新投影、计划预测和风险信号。飞书任务的日期字段作为投影由预授权同步规则保持一致，不形成第二套时间真相。

### 7.5 容量与排期

V1 使用轻量容量模型：

- 人类：每周可用量、工作日历、休假。
- Agent：并发槽、Token、费用和墙钟时间。
- 飞书任务：工作量区间、最可能值和置信度。

Workbench 使用确定性蒙特卡洛模拟计算：

- P50、P80、P90 完成日期
- 里程碑按期概率
- 关键依赖和敏感任务
- 容量过载和缓冲消耗

LLM 只解释驱动因素和建议，不负责生成概率。

### 7.6 计划基线与进度

- Owner 可以批准不可变 PlanBaseline。
- 基线保存任务网络、日期、估算、容量和日历版本。
- 重排形成候选基线，展示差异、原因和风险影响。
- 历史报告可重放当时的基线与证据快照。

项目进度分三个独立维度：

1. 执行完成度
2. Deliverable 验收度
3. Goal Outcome 达成度

不得合成为一个容易误导的总百分比。

项目健康状态由确定性引擎提出建议，Owner 确认后才成为正式红黄绿状态。人工覆盖必须记录理由。

## 8. AI Agent Team

### 8.1 默认六角色

知识工作模板默认提供可克隆的六个 Agent Profile：

| 角色 | 核心职责 |
|---|---|
| Project Lead | 形成执行计划、拆解 Mission、协调专家、汇总交付 |
| PMO | 日程、里程碑、依赖、提醒、例会、状态报告和升级建议 |
| Research Analyst | 课题研究、来源比较、证据整理和未知项识别 |
| Risk Analyst | 风险识别、概率/影响、触发器和应对方案 |
| Knowledge Curator | 文件整理、项目记忆、事实冲突、决策与行动提取 |
| Deliverable Reviewer | 按验收标准独立复核候选产物 |

每个 Profile 显式定义：

- 职责和禁止事项
- 可信指令源
- provider/model、推理强度和回退链
- 工具白名单
- 数据信任区
- 文件和外部系统权限
- Token、费用、并发和时间预算

### 8.2 Workbench 自有编排

Workbench 自己保存 Mission DAG，不依赖 DSH 实验性 Agent Teams：

- `Mission` 是可追踪的工作单元。
- `ExecutionPlan` 保存执行包络和批准快照。
- `Handoff` 保存结构化交接。
- DSH `ctx.subagents` 只作为执行后端适配器。
- 后端可以使用 in-process、Codex、Claude Code 或其他 DSH provider。

### 8.3 计划批准

复杂任务由 Lead 先提交整包计划：

- 目标和成功标准
- Mission DAG 和依赖
- Agent 分工
- 数据源和模型
- 工具与可写路径
- 外部目标
- 时间和费用预算
- 交付物与验收标准

Owner 一次批准后，包内工作可以自主推进。以下情况必须暂停并重新批准：

- 新增数据源、模型、Agent 或工具
- 新增外部目标或可写路径
- 超出时间、费用、Token 或并发预算
- 改变验收标准
- 将低风险动作升级为高风险动作

包内排序调整、同权限重试和负载重分配无需重新批准。

### 8.4 委派与团队记忆

- 只有 Lead 可以创建一级子 Mission。
- 专家不得继续递归委派，只能向 Lead 提交计划变更请求。
- 默认最多同时运行 3 个专家 Mission。
- 正式事实、观察层、正式对象和批准产物可共享。
- Mission 草稿上下文保持私有。
- Agent 之间通过 Handoff 传递结论、证据、未知项、风险和下一步，不复制完整运行历史。

### 8.5 Agent 产物

Agent 修改文档时使用“草稿分支—差异审阅—发布”流程：

- 草稿记录 Agent、Profile、模型、Mission 和来源证据。
- Reviewer 只读取验收标准、正式证据和候选产物，不读取作者的私有过程。
- 普通产物由一个独立 Reviewer 复核。
- 重大 Decision、受限数据、宿主文件自动写和外部动作使用两个独立模型路由复核。
- Reviewer 只能提出质量结论，不能替代人类验收。

## 9. AI Native 功能

### 9.1 Project Pulse

- 每日生成项目摘要草稿。
- 每周生成趋势报告草稿。
- 报告固定使用输入截止序列 `cutoffSequence`，避免前后数据不一致。
- 区分执行进度、交付验收和目标结果。
- 展示变化、阻塞、风险、决策、下一步和待确认项。

### 9.2 Risk Radar

确定性信号引擎先发现候选，再由 LLM 解释：

- 排期和缓冲
- 依赖阻塞
- 负责人缺失或过载
- 范围增长
- 评审等待
- 信息陈旧
- 目标不对齐
- 决策悬而未决
- 文档和交付质量
- 沟通中断

被拒绝或暂缓的风险保存条件指纹。只有证据、概率、影响、截止日或依赖发生实质变化时才重新打开。

### 9.3 Topic Studio

自动聚合研究课题和执行问题：

- 识别相关文档、任务、会议、消息和决策
- 区分事实、假设、未知项和建议
- 发现重复课题和相互矛盾的结论
- 提议研究问题、解决路径和行动任务

### 9.4 Decision & Action Mining

从文档、妙记、群聊、评论和审批中提取：

- 决策候选
- 承诺和负责人
- 截止时间
- 待办行动
- 复审条件

提取结果先进入 Review Center，不自动生成正式 Decision 或更新飞书任务。

### 9.5 Document Intelligence

- 文件摘要和结构化目录
- 两版本差异及影响
- 术语、实体和事实提取
- 决策、风险和行动识别
- 证据冲突与过期提醒
- 受影响下游对象追踪

### 9.6 Plan Builder

根据 Goal、Outcome、Deliverable 和约束生成：

- Milestone 候选
- 飞书任务候选
- 依赖关系
- 工作量区间
- 成员分工
- 风险和验收标准

生成结果作为整体 SuggestedChange 审核，不直接写入正式系统。

### 9.7 Ask Project

上下文 Copilot 可在任意项目页面被唤起：

- 自动继承当前项目和对象上下文。
- 只读取当前授权范围。
- 回答区分事实、推断和建议。
- 事实必须带证据定位。
- 结果可转换为 Topic、Risk、Decision、Deliverable、Mission、任务建议或文档草稿。

### 9.8 Project Hygiene

持续发现：

- 无负责人
- 无日期或日期冲突
- 无验收标准
- 长期无更新
- 任务完成但交付物未验收
- 交付物完成但 Outcome 无变化
- 无来源的项目事实
- 已失效但仍被引用的报告或决策

## 10. 证据化项目记忆

### 10.1 两层记忆

`MemoryClaim` 分为：

- `observation`：AI 自动提取，可用于提问和风险提示。
- `fact`：来自权威系统事件或人工确认，可驱动正式计划。

未确认观察不得自动晋升为事实。

### 10.2 记忆结构

```ts
interface MemoryClaim {
  id: string
  projectId: string
  layer: 'observation' | 'fact'
  kind: 'fact' | 'commitment' | 'assumption' | 'term' | 'constraint'
  subject: string
  predicate: string
  value: unknown
  validFrom?: string
  validUntil?: string
  confidence?: number
  evidenceRefs: string[]
  status: 'active' | 'conflicted' | 'superseded' | 'revoked'
}
```

### 10.3 冲突与纠错传播

- 多来源冲突不得按“最新时间”自动覆盖。
- 系统保留所有断言和证据，生成 `ConflictRecord`。
- 冲突解决由 Owner 选择、合并或标记待核实。
- 依赖图记录证据 → 主张 → 记忆 → 风险/决策/报告/文档关系。
- 上游失效后，下游自动标记 `stale` 并进入复核队列。
- 已批准正式内容不得自动重写。

## 11. AI 安全与治理

### 11.1 数据分级与模型信任区

来源和记忆使用以下等级：

- `public`
- `internal`
- `sensitive`
- `restricted`

每个模型路由声明：

- 允许的数据等级
- 服务地域
- 是否允许供应商保留数据
- 是否允许图像或文件上传
- 可使用的最大上下文

上下文组装器必须在运行前计算来源权限、数据等级和模型路由的交集。不兼容时切换到已批准回退路由或拒绝运行，禁止静默放宽。

### 11.2 上下文最小化与 DLP

- 只召回完成 Mission 所需的最小证据块。
- 密钥、令牌和凭据模式永久阻断外发。
- PII 和敏感模式按来源策略脱敏或拒绝。
- DLP 日志记录规则命中和删减范围，但不得复制秘密本身。
- 模型只看到授权后的上下文清单。

### 11.3 指令信任与 Prompt Injection

- 项目文件、飞书内容和网络页面默认是不可信数据。
- 只有项目配置中显式登记的规则文件可以成为 Agent 指令。
- 可信指令也不能扩大模型、工具、预算、路径或数据权限。
- 后台模型不得直接拥有未批准工具。
- 文档中的命令、链接或“忽略规则”文本只作为内容处理。

### 11.4 网络研究

- 互联网访问按 Mission 授权。
- 执行计划声明研究目的、范围、预算和允许的数据外发。
- 默认不使用个人登录态浏览器。
- 项目可配置优先和禁止域名。
- 高影响事实至少由两条独立可信来源交叉验证。
- 单一来源例外必须明确标注。
- 保存引用、抓取时间、canonical URL 和内容指纹。

### 11.5 输出约束

- 模型输出使用 JSON Schema/Zod 验证。
- 允许一次结构修复，第二次失败则关闭运行。
- 每条事实性主张必须引用 `EvidenceRef`。
- 输出必须区分 `fact`、`inference`、`recommendation`。
- 证据不足时必须弃答或标记未知。
- 不请求或存储隐藏 chain-of-thought。
- 保存可见输出、工具调用、证据、结果和决策摘要。

### 11.6 权限分级

Agent 能力分为：

1. 读取授权上下文
2. 生成草稿、观察和洞察
3. 建议正式内部变更
4. 执行预授权内部变更
5. 调用预授权外部动作
6. 高风险或不可逆动作

新项目默认只启用前两级。Owner 在观察期后按 Agent 和能力逐项激活。

### 11.7 预算

预算按四级取最严格值：

- 全局
- 项目
- Agent
- Mission

分别限制费用、Token、并发和墙钟时间：

- 80% 触发软提醒。
- 100% 硬暂停并请求扩额。
- 提供商不返回费用时按配置单价估算。
- 即使费用未知，Token 和时间硬限制仍然生效。

### 11.8 Kill Switch

提供三级紧急停止：

- 全局
- 项目
- Mission

停止操作必须：

1. 关闭新任务准入。
2. 取消运行中的 Agent 和工具调用。
3. 撤销写入租约。
4. 停止重试和定时触发。
5. 等待处置收敛。
6. 保存最后安全检查点。

取消不得被记录成成功。

### 11.9 自动循环防护

- 所有自动事件携带 `causationId` 和链深度。
- 同一规则不得在同一因果链重复触发。
- 自动派生 Mission、外部动作和重试均有硬上限。
- 达到上限立即暂停并告警。
- 循环判断、去重和幂等不得交给模型决定。

### 11.10 Agent Profile 升级

- Profile 不可原地覆盖，只能发布新版本。
- 改进来源可以是人工编辑或系统基于反馈生成的变更建议。
- Owner 批准后，新版本成为所有项目的默认版本。
- 运行中的 Mission 固定原版本到结束。
- 旧版本永久保留并支持一键回滚默认版本。

## 12. Review Center

Review Center 统一处理：

- SuggestedChange
- Mission 执行计划
- 风险候选
- Topic 和 Decision 候选
- 记忆冲突
- Deliverable 评审
- 文档发布
- 飞书写入动作
- Webhook 动作
- 权限和 Agent Profile 变更

同一运行、同一动作类型可以形成批次，并支持逐项差异和多选接受/拒绝。以下动作禁止批量放行：

- 权限变化
- 未预授权外部写入
- 删除、移动和重命名
- 宿主文件覆盖
- 敏感数据外发

接受、编辑后接受、拒绝和暂缓都要保存反馈原因。反馈不会自动改写 Agent 规则，只会生成可审核的 Profile 或模板改进建议。

## 13. PMO 与通知

### 13.1 PMO 职责

PMO Agent 负责：

- 维护项目节奏和日历视图
- 跟踪 Milestone、Deliverable 和依赖
- 发现逾期、过载和计划漂移
- 准备例会议程和状态材料
- 汇总待评审、待审批和待确认事项
- 提醒风险变化和自动化失败
- 生成每日摘要和每周报告

Risk Analyst 负责风险分析，PMO 负责过程治理和升级，两者职责不得混为一体。

### 13.2 通知分层

- 严重安全事件、当天硬截止和自动化失败即时提醒。
- 普通逾期、待确认、资料变化进入每日摘要。
- 趋势、目标偏离和容量问题进入周报。

项目支持静默时段：

- 普通通知延后到下一允许窗口。
- 只有越权、误外写、凭据暴露或数据损坏风险可突破静默。
- 项目红色风险默认不突破静默，除非 Owner 显式配置。

### 13.3 飞书提醒

应用内提醒自动产生。飞书提醒可通过预授权规则自动发送，规则必须限定：

- 私聊或群目标
- 消息模板类别
- 触发条件
- 频率上限
- 生效和失效时间

自由文本、换目标或超频必须重新确认。

## 14. 飞书连接器

### 14.1 双身份

使用 Bot 和 User 两类身份：

- Bot：后台同步、索引、任务智能体、规则提醒和任务步骤。
- User：个人日历、个人资源和明确代表 Owner 的动作。

每次调用必须显式选择身份并进入审计。由某身份取得的资源 ID 后续必须沿用相同身份，不允许因权限错误静默换身份重试。

### 14.2 数据范围

V1 接入：

- 飞书任务和任务清单
- 飞书日历
- Wiki/Docx
- 妙记
- 指定群聊
- 审批

后台任务只允许读取项目已绑定源。交互式 AI 可以全局搜索 Bot/User 当前可见范围，但流程必须是：

1. 只检索并展示候选元数据。
2. Owner 选择允许使用的来源。
3. 系统才读取正文并加入本次上下文。
4. 记录授权快照和证据清单。

### 14.3 任务智能体

飞书任务智能体以应用 `app_id` 注册，因此 V1 只注册一个 `Project Workbench` 门面：

- 内部六角色继续使用独立 Workbench 身份。
- 飞书任务步骤显示实际角色、阶段、Mission ID 和产物链接。
- 项目可预授权向已绑定任务写入四类结构化步骤：开始、阶段完成、阻塞、交付。
- 不写内部推理、原始提示或未授权证据。
- Agent 完成 Mission 后只能提出任务完成动作，Owner 确认后才更新飞书状态。

### 14.4 文档组件

- 飞书文档优先通过官方 Docs Component 嵌入 Workbench。
- 人类编辑继续使用飞书官方能力，Workbench 不重写飞书正文。
- 组件不支持、身份未授权或文档类型不兼容时，回退到 canonical URL 新窗口打开。

### 14.5 写入规则

飞书默认只读，写入逐次确认。允许的预授权例外只有：

- PMO 固定规则提醒
- 已绑定任务的结构化 Agent 步骤
- 项目日历与任务日期的受控同步
- 预注册 Webhook 规则

所有例外都必须有明确范围、有效期、幂等和撤销开关。

## 15. 文件中心与文档能力

### 15.1 统一虚拟树

文件中心显示不同来源根：

- `Managed`
- `Local Mount`
- `Feishu`

支持跨来源搜索，但每项必须显示来源、权限、版本语义和允许操作。跨来源“移动”实际执行带来源链的导入/复制，不静默删除原件。

### 15.2 Managed 文件库

支持：

- 文件夹创建和层级浏览
- 上传、新建、重命名、移动、复制、下载和归档
- Markdown/文本在线编辑
- 文件版本、差异、恢复和发布
- Agent 草稿分支

### 15.3 Local Mount

管理员只能从配置 allowlist 中挂载真实根目录：

- 所有访问执行 realpath containment。
- 阻止路径穿越和越界符号链接。
- 默认拒绝 `.git`、`.env`、凭据目录、`node_modules` 和隐藏敏感文件。
- Markdown 和文本支持在线编辑。
- 保存使用临时文件、fsync 和原子替换。
- 写前比较内容哈希，外部已修改则停止并显示冲突。
- 写前保存可恢复版本。

Agent 自动写入默认关闭。授权粒度为：

`Agent × Mount × PathRule × Operation`

自动写只允许创建和修改，并同时满足：

1. 路径和操作在预授权范围内。
2. 两个独立 Reviewer 均通过。
3. 预算和运行包络未越界。
4. 目标哈希未变化。

删除、移动和重命名始终需要逐次确认。

### 15.4 预览与解析

V1 在线预览：

- Markdown
- UTF-8 文本和代码
- 图片
- PDF

安全要求：

- Markdown 禁止原始 HTML。
- 禁止危险 URL scheme。
- 文本和代码不得作为 HTML 执行。
- 图片和 PDF 读取必须重新校验权限。

本地解析范围：

- Markdown、文本和代码直接解析。
- PDF 保留页码定位。
- DOCX 保留段落和标题定位。
- XLSX 保留工作表和单元格范围定位。
- PPTX 保留幻灯片定位。

Office 文件 V1 提供元数据、文本提取和下载，不承诺完整在线渲染或编辑。

图片和扫描 PDF 默认不发送模型。项目可按来源启用：

- 本地 OCR
- 经批准的视觉模型处理

视觉外发记录文件、页码、内容哈希、模型和授权来源。

### 15.5 搜索

- SQLite FTS5 始终启用。
- 可选配置 Workbench 自有 embedding provider。
- 配置后使用关键词和向量混合召回与重排。
- DSH 当前没有稳定公共 embeddings seam，因此不得依赖适配器内部实现。
- 索引块携带来源、对象版本、权限标签、提取器和模型版本。
- 来源撤权或删除后立即从可检索集合排除。

## 16. 自动化脚本与 Webhook

### 16.1 脚本沙箱

用户可编辑自动化脚本运行在 capability-only 的 QuickJS/WASM 沙箱：

- 无宿主文件系统
- 无任意网络
- 无进程执行
- 无环境变量
- 无 Node.js API
- 无未受控时钟和定时器

脚本只可调用版本化 Workbench Automation API，例如读取事件快照、计算条件、创建建议或请求白名单动作。

DSH `workflow-worker-thread` 官方只提供 containment，不是安全边界，因此只能用于内部受信编排，不承载用户脚本。

### 16.2 Webhook

Owner 预注册 Webhook Endpoint：

- 只允许 HTTPS。
- 固定域名和请求 schema。
- 密钥只保存 credential reference。
- 阻止私网地址、重定向绕过和动态 URL。
- 配置超时、速率、最大响应和重试。
- 规则必须单独获准使用某个 Endpoint。
- 所有请求使用幂等键和审计记录。

### 16.3 循环与副作用

- 自动化事件必须携带 `causationId`。
- 同一规则不得在同一因果链再次触发。
- 自动链深度和派生动作数有硬上限。
- 外部动作完成前不得把本地状态伪装成成功。
- 无法确认远端结果时进入 `unknown`，由 reconciliation 决定，不盲目重试。

## 17. 存储与运行时

### 17.1 Repository

V1 使用 `node:sqlite` 和 Workbench 自有关系仓库，不使用 DSH 单进程 KV 保存核心业务数据。

```ts
interface ProjectRepository {
  transaction<T>(fn: (tx: ProjectTransaction) => Promise<T>): Promise<T>
  migrate(): Promise<void>
  readProjection<T>(query: ProjectQuery<T>): Promise<T>
  appendAudit(event: AuditEventInput): Promise<AuditEvent>
  claimJobs(request: JobClaimRequest): Promise<ClaimedJob[]>
}
```

要求：

- SQLite 开启 WAL、foreign keys 和 busy timeout。
- 所有业务写命令支持乐观并发。
- 核心 Repository 契约不得泄露 SQLite 专用语义。
- 后续 PostgreSQL provider 复用相同领域和命令接口。

### 17.2 调度器

Workbench 自有持久调度器负责：

- 每日/每周 Intelligence Run
- 飞书周期对账
- PMO 提醒
- 索引更新
- Webhook 重试
- 备份和恢复验证

使用数据库租约、幂等 job key、有限重试和过期回收。服务停机期间的重复周期任务只补跑最新一次，不制造历史任务风暴。

### 17.3 AI 审计

永久保存：

- 输入对象和版本清单
- 最终发送的证据片段
- 系统/Agent/Profile 版本
- 可见提示和可见原始输出
- 模型路由与用量
- 工具调用和结果
- Reviewer 结论
- 人工反馈和最终处置

V1 不做应用层静态加密，但模型密钥、飞书令牌和恢复凭据必须保存在 DSH credentials 或系统密钥存储，禁止进入业务数据库。

关键审计事件只追加并形成哈希链。每次备份保存链头，可检测事件被修改、删除或重排，但不宣称能抵抗拥有主机权限的攻击者。

### 17.4 备份

- 每日生成一致性 SQLite 快照。
- 托管文件使用内容寻址，避免重复复制。
- 默认保留 7 个每日、4 个每周、12 个每月恢复点。
- 定期实际执行恢复验证，而不只检查文件存在。
- 支持导出完整项目包和校验清单。
- 导出包不包含可直接使用的外部服务密钥。

## 18. 权限与安全底座

V1 虽只有 Owner，仍完整实现统一授权策略层：

```ts
interface AuthorizationPolicy {
  authorize(input: AuthorizationRequest): Promise<AuthorizationDecision>
  filterProjection<T>(principal: Principal, projection: T): Promise<T>
  intersectAudiences(sources: EvidenceSource[]): Audience
}
```

所有以下路径必须调用同一策略层：

- 业务命令
- Remote 查询
- 文件读取和预览
- 搜索结果
- AI 上下文召回
- Agent 工具调用
- 导出和备份恢复

AI 产物的可见范围不得宽于其所有证据来源权限的交集。二阶段增加 Owner、Manager、Member、Viewer 等角色时，不修改业务访问架构。

## 19. 公共配置与接口

### 19.1 Config

公共 `Config` 必须同时提供同名 TypeScript 类型和运行时 Schema：

```ts
interface Config {
  database: DatabaseConfig
  auth: OwnerAuthConfig
  lark: LarkConfig
  files: FilesConfig
  search: SearchConfig
  intelligence: IntelligenceConfig
  agents: AgentRuntimeConfig
  automation: AutomationConfig
  backup: BackupConfig
  security: SecurityConfig
}
```

关键字段：

- `database`：SQLite 路径、WAL、busy timeout、provider。
- `auth`：Owner 初始化、密码、会话和恢复策略。
- `lark`：Bot credential、用户 profile、同步和预授权策略。
- `files`：托管根、挂载 allowlist、大小、解析器、OCR。
- `search`：FTS 和可选 embedding provider。
- `intelligence`：模型信任区、模型路由、时间表和预算。
- `agents`：Profile、并发、委派深度和默认权限。
- `automation`：脚本限制、Webhook、因果链和重试。
- `backup`：目录和 7/4/12 轮换。
- `security`：publicBaseUrl、trustedHosts、Cookie、DLP 和审计。

### 19.2 核心服务

- `ProjectRepository`
- `AuthorizationPolicy`
- `FederationService`
- `MissionOrchestrator`
- `ContextAssembler`
- `ReviewService`
- `AutomationRuntime`
- `AuditLedger`
- `DocumentIndex`
- `DurableScheduler`

### 19.3 Agent 工具

按命令层提供具名工具，至少覆盖：

- 查询项目、Goal、Outcome、Deliverable、Risk、Topic 和 Decision
- 查询飞书任务和日程投影
- 搜索项目证据和文件
- 创建草稿、观察和 SuggestedChange
- 提交 Mission 计划和 Handoff
- 请求评审和外部动作
- 查询预算、运行和同步状态

正式变更工具必须携带 `expectedVersion` 或外部版本令牌，并在执行时重新校验授权、工作流、批准包络和幂等键。

## 20. 客户端信息架构

产品采用“驾驶舱 + 上下文 Copilot”，不是聊天优先。

### 20.1 全局导航

- Home / PMO Inbox
- Goals
- Projects
- Calendar
- My Work
- Reviews
- Agent Team
- Intelligence Runs
- Templates
- Settings

### 20.2 项目导航

- Overview
- Timeline
- Deliverables
- Tasks
- Risks
- Topics
- Decisions
- Files
- Intelligence
- Activity
- Settings

### 20.3 Intelligence Hub

- Pulse
- Risk Radar
- Topics
- Suggestions
- Ask Project
- Runs & Audit

Copilot 在任何页面继承当前对象上下文，但所有输出仍需通过统一命令层转成正式对象。

## 21. 实施顺序

尽管 V1 单次完整交付，内部按以下顺序实施：

1. 插件骨架、共享 `AGENTS.md`、配置 Schema、SQLite Repository、迁移和授权策略层。
2. Owner 认证、组织/成员、模板、Goal 和 Project 基础领域。
3. 飞书双身份连接器、任务清单、项目日历、outbox/inbox 和 reconciliation。
4. Topic、Risk、Decision、Deliverable、Review Center 和 PlanBaseline。
5. 文件中心、本地挂载、飞书内容源、解析、FTS 和可选向量索引。
6. 证据记忆、冲突、依赖图和 Intelligence Pipeline。
7. 六角色 Agent Team、Mission 编排、预算、Kill Switch 和独立评审。
8. PMO、风险雷达、项目摘要、概率预测和上下文 Copilot。
9. QuickJS/WASM 自动化、Webhook 和飞书预授权动作。
10. 备份、哈希链、恢复、可观测性、性能和真实项目试运行。

开发过程中不得依赖修改 DSH 核心才能完成插件功能。如发现宿主契约缺口，先通过插件拥有的 Repository、Remote、工具或适配器隔离；只有独立提案获批后才考虑上游改动。

## 22. 测试策略

### 22.1 领域与存储

- 模板版本、受控自定义和升级差异
- Goal/Outcome、Risk、Topic、Decision、Deliverable 状态机
- 唯一 Accountable、人类 Sponsor 和成员认领
- 乐观并发、事务、崩溃恢复和迁移
- SQLite/PostgreSQL Repository 契约一致性

### 22.2 飞书联邦

- Bot/User 身份不混用
- scope 缺失与资源 ACL 不可见
- 任务、任务步骤、日历和 Webhook 幂等
- 事件重复、乱序、丢失和限流
- reconciliation 最终收敛
- 飞书工作流字段迁移
- 日期权威和任务日期投影

### 22.3 文件与搜索

- 路径穿越、符号链接和隐藏敏感文件
- 哈希写冲突和原子保存
- Markdown XSS 和危险 URL
- PDF/Office 解析失败、恶意文档和超大文件
- OCR/视觉外发授权
- 来源撤权后的索引清除
- 跨项目权限隔离

### 22.4 AI 与 Agent

- 数据分级和模型信任区
- 最小上下文和 DLP
- Prompt Injection
- claim-level evidence 完整性
- Schema 修复失败后关闭
- Mission 包络扩权和预算耗尽
- 禁止递归委派
- 独立 Reviewer 和双审分歧
- 风险条件指纹抑制
- 事实冲突和下游 stale 传播
- Profile 升级只影响新 Mission
- Kill Switch 达到完全停稳

### 22.5 自动化安全

- QuickJS/WASM 沙箱无法访问宿主能力
- Webhook SSRF、重定向和密钥隔离
- 因果链循环和派生上限
- 幂等、超时、未知结果和死信恢复
- HMR/dispose 后无进程、订阅、租约和写操作残留

### 22.6 备份与审计

- 7/4/12 轮换
- 一致性快照
- 项目包导出
- 实际恢复验证
- 审计哈希链修改、删除和重排检测

## 23. AI 离线评估集

建立固定评估数据集，覆盖：

- 项目进度总结
- 风险发现与去重
- 课题聚类
- 决策和行动提取
- 文档问答
- 计划拆解
- 证据冲突
- Prompt Injection
- 权限和数据外发
- PMO 提醒
- 交付物独立评审

硬性质量规则：

- 事实引用覆盖率必须为 100%。
- 未授权来源使用次数必须为 0。
- 未确认正式写入必须为 0，预授权动作除外。
- 所有评估运行固定输入快照、Profile 和模型版本。

## 24. V1 验收标准

自动测试全部通过后，选择一个真实知识工作项目连续试运行至少 14 天，连接真实：

- 飞书主任务清单
- 飞书项目日历
- 文档、妙记、群聊和审批范围
- Workbench 托管文件或本地目录
- 六角色 Agent Team

通过门槛：

| 指标 | 门槛 |
|---|---:|
| 越权读取 | 0 |
| 未批准或超规则外部写入 | 0 |
| 数据丢失 | 0 |
| 重复外部动作 | 0 |
| 联邦同步 | 最终可收敛 |
| AI 事实证据覆盖率 | 100% |
| 被采纳或明确保留的建议 | ≥ 70% |
| 人工标注的关键提醒漏报 | 0 |
| Kill Switch、备份恢复、审计验证 | 全部通过 |

## 25. 默认值与后续演进

### 25.1 V1 默认值

- 基于已核对的 DSH `v0.1.2-alpha.1` 插件契约开发。
- 使用专用 DSH Profile。
- 服务通过内部/VPN TLS 反向代理访问。
- 默认项目时区为 `Asia/Shanghai`，项目可覆盖。
- PMO 默认每日生成摘要、每周一生成周报，具体时间由模板配置。
- 新项目 Agent 默认处于观察模式。
- Agent 自动本地写入默认关闭。
- 背景运行只读取项目已绑定来源。
- AI 审计永久保存，不做 V1 应用层静态加密。
- 备份默认采用 7 日、4 周、12 月轮换。

### 25.2 二阶段

二阶段重点：

- 多人账号、邀请和成员认领
- Owner、Manager、Member、Viewer 等 RBAC
- 对象级 ACL 和团队通知
- PostgreSQL provider
- 业务数据与 AI 审计静态加密迁移
- 更完整的多人 Review 和协作体验
- 软件/产品研发及通用项目模板

## 26. 研究与设计参考

本方案参考了以下产品能力和官方资料，但不复制其具体交互或数据模型：

- [Linear Projects](https://linear.app/docs/projects)、[Project Updates](https://linear.app/docs/initiative-and-project-updates)、[Pulse](https://linear.app/docs/pulse)
- [Plane Projects](https://docs.plane.so/core-concepts/projects/overview)、[Workflows](https://docs.plane.so/workflows-and-approvals/workflows)
- [OpenProject Work Packages](https://www.openproject.org/docs/user-guide/work-packages/)、[Agile Boards](https://www.openproject.org/docs/user-guide/agile-boards/)
- [Jira Approval Steps](https://support.atlassian.com/jira-software-cloud/docs/set-up-approval-steps/)
- [Asana AI Project Management](https://asana.com/product/ai/project-management)
- [monday.com Portfolio Risk Insights](https://support.monday.com/hc/en-us/articles/22551628427666-The-portfolio-Risk-Insights)
- [Microsoft Project Manager Agent](https://support.microsoft.com/en-us/office/frequently-asked-questions-about-project-manager-agent-ab2bc39a-edec-4d4d-8e86-2cc927870096)
- [Notion Custom Agents](https://www.notion.com/en-gb/help/custom-agents?nxtPslug=custom-agents)
- [飞书 Docs Component](https://open.feishu.cn/web-component/docs-component/?source=open_platform)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## 27. 审核清单

人工审核时重点确认：

- 联邦事实源是否符合预期，特别是飞书任务和日历的权威地位。
- V1 单次完整交付范围是否仍可接受。
- 六角色 Agent Team 的职责是否需要调整。
- Agent 自动写本地文件的双审规则是否足够。
- 飞书预授权提醒和任务步骤的边界是否合适。
- V1 永久保存且不做静态加密的风险是否可接受。
- 14 天真实项目验收门槛是否需要修改。

审核通过后，应先冻结本文档版本，再生成实施任务分解；不得在同一次审核动作中直接开始开发。
