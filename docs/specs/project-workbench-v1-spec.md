# Spec: Project Workbench V1

> Status: Ready for agent implementation
>
> Source design: Project Workbench V1 设计方案
>
> Target: DeepSeek Harness Cordis plugin

## Problem Statement

项目负责人需要同时在任务系统、日历、文档、会议纪要、本地文件和 AI 对话之间维护项目。任务和日期容易失真，项目事实散落在不同来源，进度汇报依赖人工整理，风险通常在临近延期时才被发现，研究课题、决策依据和行动承诺也难以持续追踪。

现有项目管理工具大多把 AI 作为摘要按钮或聊天助手，不能把 AI 作为具备明确角色、责任、权限、预算和审计记录的项目成员。通用 Agent 工具虽然可以执行工作，却缺少项目级事实源、审批、版本、证据、日程、风险和治理边界，无法安全地持续参与真实项目。

V1 的用户首先是一个独立管理项目的 Owner。Owner 需要在保持飞书任务和飞书日历为协作权威的前提下，通过一个统一驾驶舱管理目标、交付物、风险、课题、决策、资料和 AI Agent Team；同时仍能把任务分配给不登录 Workbench 的真实人类成员。系统必须让 AI 主动工作，但不能让模型绕过数据权限、人工审批、外部写入规则或宿主文件安全边界。

## Solution

构建一个 DeepSeek Harness Cordis 插件形式的 Project Workbench。它采用联邦事实源：Workbench 保存项目治理、证据记忆和 Agent 运行状态；飞书任务保存执行任务；飞书日历保存正式时间承诺；飞书、本地目录和托管文件库分别保存内容正文。Workbench 通过事件订阅、周期对账、投影、索引和证据引用提供统一驾驶舱。

V1 提供模板化项目模型、单 Owner 认证、统一成员身份、目标与结果、里程碑、独立 Deliverable、Risk、Topic 和 Decision，以及文件中心、全文/语义搜索、Review Center、持久调度、自动化脚本和 Webhook。知识工作模板内置 Project Lead、PMO、Research Analyst、Risk Analyst、Knowledge Curator 和 Deliverable Reviewer 六个 AI 角色。

AI 工作通过 Workbench 自有 Mission DAG 管理。Lead 先提交包含来源、工具、模型、预算、路径和验收标准的执行计划，Owner 整包批准后才允许自主推进。AI 产出先进入观察、草稿或建议层；正式状态、任务完成、决策和验收仍由人确认，只有范围明确的预授权通知、任务步骤、日期同步、Webhook 和双重评审后的本地文件写入可以自动执行。

系统以证据化项目记忆、确定性风险信号、概率排期、权限/数据外发双重策略、DLP、独立评审、预算、Kill Switch、因果链循环防护和只追加审计提供 AI 治理。最终必须在一个真实知识工作项目上连续运行至少 14 天，并满足零越权、零误外写、零数据丢失、100% 事实证据覆盖等验收门槛。

## User Stories

1. As an Owner, I want to initialize the first Workbench account, so that only I can operate the V1 instance.
2. As an Owner, I want my password stored with a modern password hash, so that a database leak does not expose the original password.
3. As an Owner, I want an offline recovery code, so that I can regain access without an email service.
4. As an Owner, I want secure browser sessions, so that another website or script cannot steal my login session.
5. As an Owner, I want authentication events audited, so that I can investigate failed logins and recovery actions.
6. As an Owner, I want the instance to represent one organization with multiple teams, so that future projects are organized without introducing SaaS multi-tenancy.
7. As an Owner, I want to create a project from a versioned template, so that every project starts from a consistent model.
8. As an Owner, I want a built-in knowledge-work template, so that I can start using V1 without designing a template first.
9. As an Owner, I want to clone and customize a template, so that I can adapt terminology, workflow and AI roles to my way of working.
10. As an Owner, I want template versions to be immutable, so that existing projects remain reproducible.
11. As an Owner, I want template upgrade differences previewed, so that I can decide whether an active project should adopt them.
12. As an Owner, I want project-level controlled customization, so that a project can adapt without changing core security or audit invariants.
13. As an Owner, I want the template editor to configure task fields and statuses, so that different project types can use appropriate workflows.
14. As an Owner, I want the template editor to configure default views and Agent roles, so that new projects are immediately useful.
15. As an Owner, I want template automation and reminder policies versioned, so that behavior changes are traceable.
16. As an Owner, I want every project to record the exact template snapshot used at creation, so that its original assumptions can be reconstructed.
17. As an Owner, I want a project to have one primary Goal, so that its main purpose is unambiguous.
18. As an Owner, I want a project to contribute to additional Goals, so that cross-goal work is represented without duplicating projects.
19. As an Owner, I want Goals to contain measurable Outcomes, so that task completion is not confused with actual results.
20. As an Owner, I want Milestones linked to official calendar events, so that their dates have one authoritative source.
21. As an Owner, I want Deliverables modeled separately from tasks, so that outcomes, artifacts and acceptance can be managed explicitly.
22. As an Owner, I want Deliverables to reference exact document versions, so that the accepted output cannot silently change.
23. As an Owner, I want execution, Deliverable acceptance and Outcome attainment shown separately, so that progress is not reduced to a misleading percentage.
24. As an Owner, I want the system to recommend project health while requiring my confirmation, so that health is timely without becoming an unreviewed AI opinion.
25. As an Owner, I want human and AI participants represented by one ProjectMember model, so that assignments and audit use a consistent identity.
26. As an Owner, I want to add a real human without giving them a Workbench login, so that V1 can reflect the actual project team.
27. As an Owner, I want to bind a human member to a Feishu open_id, so that they can be assigned authoritative Feishu tasks.
28. As an Owner, I want to record external contacts without Feishu accounts, so that outside contributors still appear in the project roster.
29. As an Owner, I want each executable object to have one Accountable member, so that responsibility is never ambiguous.
30. As an Owner, I want multiple Contributors on an object, so that collaboration is represented without diluting accountability.
31. As an Owner, I want an AI member to own an execution task, so that the system reflects real Agent workload.
32. As an Owner, I want every AI-owned task to have a human Sponsor, so that authority escalation and final accountability remain human.
33. As an Owner, I want to record an offline member's approval with evidence, so that external decisions are represented honestly.
34. As an Owner, I want assertedBy and recordedBy kept separate, so that the system never impersonates an offline member.
35. As an Owner, I want every project bound to one primary Feishu task list, so that execution scope has a clear boundary.
36. As an Owner, I want to create a new Feishu task list or bind an existing one, so that I can adopt Workbench without discarding current work.
37. As an Owner, I want Feishu task status and assignment treated as authoritative, so that Workbench does not create a competing task system.
38. As an Owner, I want Workbench workflow states stored in Feishu custom fields, so that richer workflows remain visible in the authoritative system.
39. As an Owner, I want task workflow field changes migrated safely, so that template upgrades do not invalidate existing tasks.
40. As an Owner, I want external tasks included only through explicit links, so that search results do not silently expand project scope.
41. As an Owner, I want task comments to remain in Feishu, so that participants working there see the complete discussion.
42. As an Owner, I want Workbench objects to keep their own comments, so that Risks, Topics and Decisions do not need artificial Feishu containers.
43. As an Owner, I want a single Project Workbench Feishu task-agent identity, so that the app can report Agent work without maintaining six Feishu applications.
44. As an Owner, I want Feishu task steps to identify the internal Agent role and Mission, so that the single facade remains traceable.
45. As an Owner, I want pre-authorized Agent progress steps posted to linked tasks, so that Feishu shows starts, progress, blockers and delivery.
46. As an Owner, I want an Agent to suggest task completion rather than close it, so that authoritative task completion remains a human decision.
47. As an Owner, I want every project bound to one Feishu calendar, so that formal dates have one authoritative source.
48. As an Owner, I want meetings, Milestones, Deliverables and key task dates represented in that calendar, so that PMO sees one schedule.
49. As an Owner, I want task date fields synchronized from authoritative calendar events, so that Feishu does not show contradictory dates.
50. As an Owner, I want one file center for managed, local and Feishu sources, so that project material is discoverable in one place.
51. As an Owner, I want each file to show its source and allowed operations, so that a unified view does not hide different ownership rules.
52. As an Owner, I want folders in the managed file library, so that project documents can be organized hierarchically.
53. As an Owner, I want to upload, create, rename, move, copy, download and archive managed files, so that the library supports daily work.
54. As an Owner, I want Markdown and text files editable online, so that common project notes can be maintained without another editor.
55. As an Owner, I want managed documents versioned and restorable, so that accidental changes are recoverable.
56. As an Owner, I want to mount approved local directories, so that existing project folders can be used without importing everything.
57. As an Owner, I want local access constrained by real paths and allowlisted roots, so that path traversal cannot expose unrelated files.
58. As an Owner, I want sensitive local paths excluded by default, so that credentials and repository internals are not indexed accidentally.
59. As an Owner, I want local text saves to use hash conflict detection and atomic replacement, so that external edits are not overwritten.
60. As an Owner, I want Markdown, text, code, images and PDF previewed safely, so that I can review common project documents in Workbench.
61. As an Owner, I want DOCX, XLSX and PPTX text extracted locally, so that Office content can participate in search and AI without cloud parsing.
62. As an Owner, I want image and scanned-PDF OCR enabled per source, so that sensitive visual documents are not automatically sent to a model.
63. As an Owner, I want keyword search to work without an embedding service, so that the project remains usable offline.
64. As an Owner, I want optional hybrid semantic search, so that conceptually related evidence can be found across sources.
65. As an Owner, I want revoked sources removed from search immediately, so that stale authorization cannot leak content through an index.
66. As an Owner, I want Project Pulse to draft daily updates, so that I can understand changes without manually compiling them.
67. As an Owner, I want weekly trend reports, so that I can see trajectory rather than isolated events.
68. As an Owner, I want reports to use a fixed cutoff snapshot, so that their facts do not change during generation.
69. As an Owner, I want Risk Radar to detect schedule, dependency, ownership, scope and review signals, so that problems surface early.
70. As an Owner, I want formal Risks separate from action tasks, so that uncertain events and mitigation work have correct lifecycles.
71. As an Owner, I want rejected risk candidates suppressed until conditions change, so that repeated scans do not create alert fatigue.
72. As an Owner, I want Topic Studio to organize research questions and execution issues, so that project课题 remain structured over time.
73. As an Owner, I want research and issue Topics to share evidence and decisions while retaining distinct states, so that the model stays coherent.
74. As an Owner, I want Decisions kept in a dedicated log, so that choices, alternatives, reasons and review conditions remain traceable.
75. As an Owner, I want AI to extract decisions, commitments and actions from project content, so that important outcomes are not lost in conversation.
76. As an Owner, I want extracted items reviewed before becoming formal records, so that discussion is not mistaken for commitment.
77. As an Owner, I want Document Intelligence to summarize and compare document versions, so that changes and downstream impact are visible.
78. As an Owner, I want Plan Builder to propose Milestones, tasks, dependencies and estimates, so that planning starts from a coherent draft.
79. As an Owner, I want Ask Project to answer with evidence, so that project questions are trustworthy and auditable.
80. As an Owner, I want Project Hygiene to find missing owners, dates, criteria and stale facts, so that project data stays usable.
81. As an Owner, I want project memory separated into observations and facts, so that AI extraction cannot silently become truth.
82. As an Owner, I want authoritative external events to enter the fact layer, so that confirmed task and calendar changes are immediately usable.
83. As an Owner, I want conflicting claims preserved together, so that the system does not resolve disagreement by arbitrary last-write-wins rules.
84. As an Owner, I want to adjudicate memory conflicts, so that the canonical project understanding remains human-controlled.
85. As an Owner, I want evidence-to-artifact dependency tracking, so that revoked facts reveal every affected report, risk and document.
86. As an Owner, I want downstream artifacts marked stale rather than overwritten, so that approved content is not silently rewritten.
87. As an Owner, I want a Project Lead Agent to prepare an execution plan, so that complex AI work is understandable before it starts.
88. As an Owner, I want the plan to declare Agents, sources, models, tools, paths, budget and acceptance criteria, so that approval has a precise boundary.
89. As an Owner, I want to approve an entire Mission plan once, so that autonomous work does not require constant interruption.
90. As an Owner, I want expansion beyond the approved envelope to pause, so that Lead cannot grant itself new authority.
91. As an Owner, I want only Lead to delegate one level to specialists, so that the Mission graph cannot recurse without control.
92. As an Owner, I want Agent concurrency capped, so that one project cannot overwhelm models or the host.
93. As an AI Project Lead, I want to assign research, risk, knowledge and review work to specialists, so that each task uses an appropriate role.
94. As an AI specialist, I want to send a structured Handoff to Lead, so that evidence, conclusions and open questions are transferred cleanly.
95. As an Owner, I want private Mission scratch context excluded from shared memory, so that noise and mistakes do not spread between Agents.
96. As an Owner, I want Agent artifacts created as drafts, so that formal documents remain stable during AI work.
97. As an Owner, I want document differences shown before publishing, so that I can understand exactly what AI changed.
98. As an Owner, I want an independent Reviewer to assess a Deliverable, so that the author does not approve its own work.
99. As an Owner, I want high-risk work reviewed by two independent model routes, so that one model failure cannot directly produce a dangerous side effect.
100. As an Owner, I want Reviewer conclusions to remain advisory, so that AI cannot replace business acceptance.
101. As an Owner, I want new project Agents to begin in observation mode, so that I can assess behavior before granting tools.
102. As an Owner, I want Agent authority divided into explicit levels, so that read, draft, internal change and external action are not one permission.
103. As an Owner, I want model routes configured per Agent role, so that quality, cost and trust can match the task.
104. As an Owner, I want global, project, Agent and Mission budgets, so that both individual runs and cumulative use remain bounded.
105. As an Owner, I want soft budget warnings and hard stops, so that unexpected usage is visible before it becomes expensive.
106. As an Owner, I want global, project and Mission Kill Switches, so that I can stop automation at the right scope.
107. As an Owner, I want a Kill Switch to cancel work, revoke leases and stop retries, so that stopping is a real safety boundary.
108. As an Owner, I want cancelled work recorded as cancelled rather than successful, so that audit and progress remain truthful.
109. As an Owner, I want Project Lead Profile upgrades versioned, so that every Mission remains reproducible.
110. As an Owner, I want approved Profile upgrades applied to new Missions across projects, so that improvements propagate consistently.
111. As an Owner, I want immediate rollback to an older Profile version, so that a bad global upgrade is recoverable.
112. As an Owner, I want source data classified as public, internal, sensitive or restricted, so that model access follows data risk.
113. As an Owner, I want model routes assigned trust zones, so that switching providers cannot silently change where sensitive data goes.
114. As an Owner, I want only the minimum relevant evidence sent to a model, so that unnecessary project content is not exposed.
115. As an Owner, I want credentials and secret patterns blocked by DLP, so that a source authorization cannot accidentally leak secrets.
116. As an Owner, I want project content treated as untrusted data, so that embedded prompt injections cannot grant tools or paths.
117. As an Owner, I want only explicitly registered instruction sources to guide Agents, so that legitimate project rules remain usable.
118. As an Owner, I want internet research authorized per Mission, so that data egress and research budget remain deliberate.
119. As an Owner, I want high-impact web facts corroborated by independent sources, so that linked misinformation is not treated as truth.
120. As an Owner, I want every factual AI claim linked to EvidenceRefs, so that I can inspect its basis.
121. As an Owner, I want malformed model outputs rejected after one repair attempt, so that invalid structures do not reach the command layer.
122. As an Owner, I want facts, inferences and recommendations labeled separately, so that model interpretation is not presented as source fact.
123. As an Owner, I want a unified Review Center, so that plans, changes, conflicts, documents and external actions are handled consistently.
124. As an Owner, I want low-risk similar suggestions reviewed in batches, so that human confirmation remains practical.
125. As an Owner, I want high-risk actions reviewed individually, so that bulk acceptance cannot hide dangerous changes.
126. As an Owner, I want accept, edit, reject and defer feedback retained, so that future Profile improvements are evidence-based.
127. As an Owner, I want feedback to generate a proposed Profile update rather than self-modify an Agent, so that behavior changes stay auditable.
128. As an Owner, I want a PMO Agent to maintain project cadence, so that schedule governance is continuous rather than reactive.
129. As an Owner, I want PMO to prepare meeting agendas and status material, so that recurring project rituals require less manual preparation.
130. As an Owner, I want urgent safety failures delivered immediately, so that dangerous automation can be stopped quickly.
131. As an Owner, I want ordinary overdue and review reminders summarized daily, so that notifications remain useful rather than noisy.
132. As an Owner, I want trend and capacity issues included in a weekly report, so that long-term drift is visible.
133. As an Owner, I want configurable quiet hours, so that routine project messages do not interrupt personal time.
134. As an Owner, I want only security incidents to bypass quiet hours by default, so that project risk does not become uncontrolled nighttime paging.
135. As an Owner, I want pre-authorized Feishu reminder rules, so that PMO can send useful recurring notifications without per-message approval.
136. As an Owner, I want interactive global Feishu search to show candidate metadata first, so that I control which external content enters AI context.
137. As an Owner, I want background jobs limited to bound Feishu sources, so that unattended AI cannot explore the entire tenant.
138. As an Owner, I want Feishu Bot and User identities kept explicit, so that the connector never gains access by silently switching actors.
139. As an Owner, I want Feishu documents embedded through the official component, so that I can read and edit with native permissions.
140. As an Owner, I want a canonical-link fallback, so that unsupported Feishu content remains accessible.
141. As an Owner, I want trusted Agents to create or modify specifically authorized local files, so that AI can complete real document work.
142. As an Owner, I want automatic local writes to require path authorization, two independent reviews and hash preconditions, so that host changes remain bounded.
143. As an Owner, I want file deletion, move and rename to require explicit approval, so that AI cannot break external references automatically.
144. As an Owner, I want user automation scripts, so that project-specific rules can go beyond built-in PMO behavior.
145. As an Owner, I want automation scripts isolated from host files, network, processes and environment variables, so that customization does not become arbitrary code execution.
146. As an Owner, I want scripts to call only versioned business capabilities, so that automation remains stable and reviewable.
147. As an Owner, I want Webhook endpoints pre-registered with schemas and credential references, so that external actions have explicit boundaries.
148. As an Owner, I want Webhooks protected from SSRF and redirect bypass, so that automation cannot reach internal services unexpectedly.
149. As an Owner, I want every automatic event to carry a causation chain, so that self-triggering loops can be detected deterministically.
150. As an Owner, I want derived-action and chain-depth limits, so that an Agent/automation loop stops before exhausting the budget.
151. As an Owner, I want durable scheduling, so that summaries, reconciliation and reminders survive service restarts.
152. As an Owner, I want missed recurring runs coalesced, so that downtime does not create a storm of historical jobs.
153. As an Owner, I want idempotent external writes and reconciliation, so that retries cannot duplicate tasks, messages or Webhooks.
154. As an Owner, I want unknown external outcomes represented explicitly, so that the system does not blindly retry an action that may have succeeded.
155. As an Owner, I want permanent AI audit records, so that I can investigate and improve long-running project behavior.
156. As an Owner, I want audit records hash-chained, so that later modification or deletion can be detected.
157. As an Owner, I want credentials excluded from the business database and exports, so that permanent audit does not preserve reusable secrets.
158. As an Owner, I want daily consistent backups, so that SQLite and managed project files are recoverable.
159. As an Owner, I want 7 daily, 4 weekly and 12 monthly restore points, so that I can recover from recent or older corruption.
160. As an Owner, I want backups periodically restored in a test path, so that backup success means recoverability rather than file existence.
161. As an Owner, I want a complete project export with checksums, so that I can archive or migrate my data.
162. As an Owner, I want a dedicated DSH Profile, so that the team service exposes only Workbench and necessary Agent capabilities.
163. As an Owner, I want the plugin to shut down and hot-reload cleanly, so that no Agent, lease, subscription or write survives disposal.
164. As an Owner, I want the client to use explicit Host projections, so that browser code never becomes the authority for permissions or truth.
165. As an Owner, I want one dashboard plus contextual Copilot, so that structured project state remains primary while AI is available everywhere.
166. As an Owner, I want a PMO Inbox, Reviews, Agent Team and Intelligence Runs view, so that attention and automation are observable.
167. As an Owner, I want project views for Timeline, Deliverables, Tasks, Risks, Topics, Decisions and Files, so that each domain has an appropriate workspace.
168. As an Owner, I want every Copilot result converted through the normal command layer, so that chat cannot bypass workflow or authorization.

## Implementation Decisions

### Platform and module boundaries

- Implement Project Workbench as a Cordis contribution inside a dedicated DeepSeek Harness Profile. Do not create a second root application or Context.
- Keep business truth, authorization and side effects in the Host. The browser consumes explicit Remote projections and invokes command APIs.
- Use the pinned DSH plugin contracts as the compatibility baseline. Avoid modifying Harness core; isolate missing capabilities behind Workbench-owned adapters.
- Workbench owns persistent Mission orchestration. DSH subagent providers are execution adapters; the experimental Agent Teams service is not a source of truth.
- Public configuration must have matching TypeScript and runtime-schema definitions.
- Lifecycle disposal closes admission, cancels work, revokes leases, unregisters contributions and waits for quiescence.

### Identity, authorization and responsibility

- V1 has one local Owner account with Argon2id password hashing, offline recovery, secure Cookie sessions and security audit.
- Persist organization and team identifiers from the first migration, while exposing only one organization in V1.
- Represent humans and Agents with ProjectMember. Human members may bind a future Workbench user, a Feishu open_id or an external-contact record.
- Require exactly one Accountable member for executable objects; allow multiple Contributors. AI accountability requires a human Sponsor.
- Implement one authorization policy seam for commands, queries, Remote projections, file access, search, AI context, tools and exports. V1 policy resolves to Owner but must not be bypassed.
- Derive AI artifact visibility from the intersection of all supporting evidence audiences.

### Federated source-of-truth model

- Workbench is authoritative for governance domains: Goal, Outcome, Project, Milestone semantics, Deliverable, Risk, Topic, Decision, plan baselines, dependencies, capacity, memory, Missions, reviews and audit.
- Feishu Tasks is authoritative for execution task identity, hierarchy, assignees, comments and completion.
- Feishu Calendar is authoritative for all formal time commitments. Business objects keep stable event bindings and local projections.
- Feishu content and local/managed files remain authoritative for their own document bodies and versions.
- Each project binds exactly one primary Feishu task list and one primary project calendar. Additional external tasks are explicit references only.
- Store template workflow state in Feishu task custom fields. Workbench owns schema mapping and migration, not a competing local task status.
- Synchronize calendar-authoritative dates into task date projections under an explicit project rule.
- Use event subscriptions for low latency and durable reconciliation for missed, duplicated, reordered or partial events.
- Use transactional outbox/inbox, resource versions, idempotency keys, leases, bounded retry and an explicit unknown outcome state.

### Domain model and planning

- A Project has one primary Goal and optional secondary Goals; Goals contain measurable Outcomes and may aggregate multiple Projects.
- Model Deliverable, Risk, Topic and Decision as first-class entities rather than task types or report fragments.
- Topic has research and issue variants that share evidence, hypotheses, questions, conclusions, Decisions and action links but use distinct states.
- Keep Risk probability, impact, trigger, owner, exposure and treatment separate from mitigation tasks.
- Store external attestations with separate assertedBy and recordedBy identities plus evidence.
- Use immutable template versions and per-project snapshots. Project customization may alter optional fields, states, views and AI policies but not security, audit or core relationships.
- Store immutable PlanBaselines. Replanning produces a diff and requires approval before a new baseline becomes official.
- Model human availability and Agent capacity lightly. Store work estimates as ranges with confidence.
- Compute P50/P80/P90 schedule outcomes with deterministic Monte Carlo simulation. LLMs may explain but not calculate the probabilities.
- Present execution, Deliverable acceptance and Outcome attainment as separate progress dimensions.

### Files, documents and search

- Expose one virtual file tree with explicit Managed, Local Mount and Feishu roots. Cross-source moves are provenance-preserving copies/imports, never silent deletions.
- Provide managed folders, Markdown/text editing, versioning, restoration and Agent draft branches.
- Constrain local mounts by configured roots, realpath containment, sensitive-path exclusions, atomic writes, content hashes and recoverable prior versions.
- Grant Agent file writes by Agent, mount, path rule and operation. Automatic writes only create or modify and require two independent reviews plus an unchanged target hash.
- Preview Markdown, UTF-8 text/code, images and PDF safely. Extract structured text locally from PDF, DOCX, XLSX and PPTX.
- Keep OCR and visual-model processing disabled per source until explicitly enabled.
- Always provide SQLite FTS5. Add an optional Workbench-owned embedding provider for hybrid semantic retrieval because DSH does not expose a stable public embedding seam.
- Every index chunk carries source, version, permissions, extractor and model metadata; source revocation removes it from retrieval immediately.

### Agent Team and intelligence

- Ship cloneable Project Lead, PMO, Research Analyst, Risk Analyst, Knowledge Curator and Deliverable Reviewer Profiles in the knowledge-work template.
- Each Profile versions role instructions, trusted instruction sources, model route, tool filter, data trust zone, file/external permissions and budgets.
- Lead submits an immutable ExecutionPlan envelope covering DAG, roles, sources, models, tools, paths, external targets, budgets, outputs and acceptance.
- Owner approves the plan as a bundle. New authority, data, routes, targets, paths, budget or acceptance criteria invalidate the envelope and pause the Mission.
- Only Lead may delegate one level to configured specialists. Default specialist concurrency is three.
- Share formal facts, observations, approved artifacts and structured Handoffs; keep Mission scratch context private.
- Agent document work uses draft, diff, review and publish. Reviewers see criteria, evidence and candidate artifacts, not author scratch context.
- Ordinary work requires one independent Reviewer. Major Decisions, restricted data, host writes and external actions require two independent routes.
- Implement Project Pulse, Risk Radar, Topic Studio, Decision & Action Mining, Document Intelligence, Plan Builder, Ask Project and Project Hygiene as projections over one evidence/intelligence pipeline.
- Use a fixed cutoff sequence for every IntelligenceRun. Outputs distinguish fact, inference and recommendation and reference EvidenceRefs at claim level.
- Validate structured model output against runtime schemas; allow one repair attempt, then fail closed.

### Project memory and AI governance

- Split MemoryClaim into observation and fact layers. Only authoritative events or explicit confirmation create fact-layer claims.
- Preserve conflicting claims and require adjudication; never resolve project facts by last-write-wins.
- Maintain an evidence/provenance dependency graph. Revoked or superseded evidence marks downstream artifacts stale without overwriting approved content.
- Classify sources as public, internal, sensitive or restricted. Classify model routes by permitted data level, region and retention behavior.
- Context assembly applies authorization, minimum necessary retrieval, DLP and route compatibility before any model call.
- Treat project content and web results as untrusted data. Only explicitly registered instruction sources can guide Agents, and instructions cannot increase authority.
- Authorize internet research per Mission. Prefer primary sources and require independent corroboration for high-impact web claims.
- Do not request or persist hidden chain-of-thought. Persist visible prompts, outputs, evidence manifests, tool activity, usage and decisions.
- Provide global, project, Agent and Mission limits for cost, Token, concurrency and wall time. Warn at 80% and pause at 100%.
- Provide global, project and Mission Kill Switches that stop admission, cancel work, revoke leases, stop retries and reach quiescence.
- Profile upgrades create immutable versions. An approved version becomes the default for new Missions across projects; active Missions stay pinned and rollback remains available.
- Use causation IDs, rule re-entry prevention, derivation limits and depth limits to prevent Agent/automation feedback loops.

### Review, PMO and external effects

- Use one Review Center for plans, SuggestedChanges, risk/topic/decision candidates, memory conflicts, Deliverables, document publishing, external actions, permissions and Profile changes.
- Allow batching only for homogeneous low-risk actions. Permissions, sensitive egress, host-file overwrite and unapproved external writes remain individual approvals.
- Store accept, edited accept, reject and defer feedback. Feedback may propose a Profile/template revision but cannot self-modify runtime behavior.
- PMO owns cadence, calendar overview, dependency tracking, overdue escalation, meeting preparation, status reporting and attention summaries. Risk Analyst owns substantive risk analysis.
- Deliver security incidents immediately; summarize routine alerts daily and trends weekly. Quiet hours delay everything except security events unless Owner overrides.
- Default Feishu access to read-only. Pre-authorized exceptions are bounded PMO messages, structured linked-task steps, date synchronization and registered Webhooks.
- Use one Feishu application task-agent facade. Preserve the actual internal role and Mission in task-step records.
- Use explicit Bot and User identity routes and never switch identity to bypass a permission failure.
- Interactive tenant-wide Feishu search returns metadata first and reads selected bodies only after confirmation. Background work uses bound sources only.
- Embed Feishu documents with the official component and fall back to canonical links.

### Automation, persistence and operations

- Run user automation in a capability-only QuickJS/WASM sandbox with no ambient file, network, process, environment or Node authority.
- Expose only a versioned Automation API. Do not treat the DSH worker-thread workflow engine as a security boundary.
- Require pre-registered HTTPS Webhook endpoints, fixed schemas, credential references, SSRF defenses, rate limits, timeouts, idempotency and bounded retry.
- Use a Workbench-owned durable scheduler for intelligence, reconciliation, reminders, indexing, retry, backup and restore verification.
- Use a relational ProjectRepository over node:sqlite with WAL, foreign keys, busy timeout, transactions and optimistic concurrency. Keep the interface portable to a future PostgreSQL provider.
- Permanently retain AI audit inputs, evidence, visible prompts/outputs, routes, usage, tool calls, reviews and feedback in V1. Keep reusable credentials outside the business database.
- Append critical audit events to a hash chain and checkpoint the head in backups.
- Create daily consistent backups with 7 daily, 4 weekly and 12 monthly restore points. Verify by performing restoration and support checksummed project export.

### Client experience

- Make the structured dashboard primary and provide contextual Copilot on every relevant view rather than using a chat-first application shell.
- Provide global Home/PMO Inbox, Goals, Projects, Calendar, My Work, Reviews, Agent Team, Intelligence Runs, Templates and Settings views.
- Provide project Overview, Timeline, Deliverables, Tasks, Risks, Topics, Decisions, Files, Intelligence, Activity and Settings views.
- Route all Copilot conversions through the same command, authorization, review and concurrency paths as direct UI actions.

## Testing Decisions

- The primary test seam is a highest-level WorkbenchScenario harness around the public command/query surface. It injects deterministic clock, IDs, repository, Feishu adapter, file adapter, model/subagent adapter and scheduler, then asserts externally observable projections, external requests, audit and lifecycle outcomes.
- Prefer scenario tests over tests of private classes or SQL layout. A good test describes an Owner, external event or Agent action and verifies the resulting Workbench view, authoritative external intent and audit trail.
- Keep the number of secondary seams small. Add connector-contract tests only where Workbench crosses an independently versioned boundary: Feishu, DSH subagents/LLM, local filesystem, embedding provider, QuickJS/WASM and Webhook transport.
- Reuse DeepSeek Harness prior art for Cordis composition, Remote behavior, managed subprocess lifecycle, plugin disposal and invariant tests.
- Test repository behavior through one shared contract suite and run it against SQLite from V1; reuse it unchanged for PostgreSQL later.
- Test federation with duplicate, missing, reordered and delayed events; rate limits; expired credentials; scope failures; ACL failures; retry; ambiguous response; reconciliation and identity continuity.
- Test domain behavior for template versions, safe migration, Goal/Outcome relationships, Deliverable acceptance, Risk lifecycle, Topic variants, Decision review, responsibility and external attestation.
- Test schedule behavior with fixed seeds and clocks. Assert probability outputs, dependency sensitivity, capacity changes, baseline drift and Feishu calendar authority without asserting Monte Carlo implementation details.
- Test files through public read/write/preview/search behavior. Cover path traversal, symlink escape, excluded paths, hash conflicts, atomic recovery, XSS, parser failures, oversized/malicious documents, OCR consent and source revocation.
- Test AI through recorded deterministic adapters and an offline evaluation set. Assert fixed cutoff, evidence coverage, fact/inference separation, schema failure, route/data incompatibility, DLP, prompt injection, conflicts and stale propagation.
- Test Mission governance for envelope expansion, delegation depth, concurrency, budgets, single/dual review, cancellation, profile pinning, rollback and all three Kill Switch scopes.
- Test Review Center batching by action risk. Verify that high-risk actions cannot be bulk accepted and every final effect retains its approval provenance.
- Test automation as an adversarial boundary: sandbox escape attempts, forbidden capabilities, SSRF, redirect bypass, dynamic targets, secret isolation, causation loops, derivation limits, idempotency and unknown outcomes.
- Test scheduler persistence across process restarts, lease expiry, duplicate workers, missed intervals, coalescing and clean Cordis disposal.
- Test backup rotation, checksums, full restore, audit hash-chain verification and exports without reusable credentials.
- Run browser-level scenarios for Owner setup, project creation, source binding, dashboard, Review Center, file preview/edit, Copilot conversion, Agent observation/activation and Kill Switch.
- Run contract tests against a dedicated Feishu test environment before the real pilot. Avoid mutating personal production resources during automated tests.
- Complete a 14-day real-project acceptance run. Hard gates are zero unauthorized reads, zero unapproved or out-of-policy external writes, zero data loss, zero duplicate external effects, convergent federation, 100% evidence coverage for factual AI claims, at least 70% accepted-or-retained suggestions, zero missed human-labeled critical alerts, and successful Kill Switch, backup restore and audit verification.

## Out of Scope

- Multiple Workbench login accounts, invitations, self-registration and collaborative account lifecycle.
- Full V1 role matrix for Owner, Manager, Member and Viewer; V1 implements the policy seam with Owner only.
- SaaS multi-tenancy, cross-organization administration, tenant billing or tenant-specific encryption keys.
- PostgreSQL runtime support in V1; only a portable repository contract is required.
- Application-level encryption at rest for business data and permanent AI audit in V1.
- Full online rendering or editing of DOCX, XLSX and PPTX.
- Arbitrary bidirectional synchronization across Workbench and every Feishu product.
- Treating Feishu chats, documents or approvals as alternate task or project-governance authorities.
- More than one primary Feishu task list or primary project calendar per project.
- Automatic Agent deletion, move or rename of host files.
- Unrestricted host scripts, shell automation, dynamic Webhook destinations or ambient network access in user automation.
- Recursive specialist delegation or unrestricted Agent swarms.
- AI approval of formal Deliverables, Decisions or authoritative task completion.
- Automatic fact promotion based only on model confidence.
- Automatic rewriting of approved artifacts when evidence changes.
- Hidden chain-of-thought collection or display.
- Full low-code entity/relationship modeling.
- Software/product-development and generic project templates beyond preserving the extension model; the knowledge-work template is the V1 validated template.
- Changes to DeepSeek Harness core unless a separate upstream proposal is approved.

## Further Notes

- This Spec is synthesized from the reviewed V1 design and the complete design discussion. Domain terms such as Goal, Outcome, Deliverable, Risk, Topic, Decision, Mission, Handoff, SuggestedChange and EvidenceRef are normative.
- The repository currently contains design documentation only. The WorkbenchScenario seam, public command/query surface and connector interfaces are new seams and should be created before feature modules proliferate.
- V1 is intentionally delivered as one complete product release even though implementation must proceed internally in dependency order behind feature flags.
- The dedicated DSH Profile is expected to run behind an internal/VPN TLS reverse proxy. Standard browser/session access alone is not treated as a business identity.
- Feishu integration uses Bot and User identities with explicit continuity. Credentials remain in DSH credential storage rather than Workbench business tables.
- V1 permanently retains AI audit data without application-level encryption because it is a personal deployment. Multi-user rollout is blocked until an encryption migration is designed and completed.
- The default project timezone is Asia/Shanghai but is configurable per project.
- New Agents start in observation mode. Local file auto-write, internet research, sensitive-model routes and pre-authorized external effects are opt-in.
- Profile updates are globally promoted after Owner approval, affect only new Missions, retain all old versions and support immediate default rollback.
- GitHub issue triage for this Spec uses only the `ready-for-agent` label as required by the project engineering workflow.
