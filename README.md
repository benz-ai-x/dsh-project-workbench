# Project Workbench for DeepSeek Harness

Project Workbench 是一个外置 DeepSeek Harness Cordis 插件，目标是把项目状态、证据、文档、协作和 AI 原生项目分析组织成可追溯的项目驾驶舱。

当前实现阶段是 T02：在 T01 的 Host 持久化、Typert Remote 与浏览器状态链路上，加入唯一 Owner 初始化、密码登录、可撤销会话、离线恢复和统一授权闸门。Project、Goal、审计、飞书、文件与 AI 分析仍由后续票据逐步实现。

## Workspace layout

- `packages/workbench-host`：Host 权威状态、SQLite、Owner 认证/授权、离线恢复 CLI、`WorkbenchScenario` 和生成的 Typert Remote。
- `packages/workbench-client`：认证先行的 Owner Shell、浏览器状态模型、可访问 UI、`conversation` Slot 和 lazy-CJS Client bundle。
- `packages/workbench-bundle`：按 Auth → Host → Client 顺序插入稳定行的 DSH Bundle。
- `profiles/workbench-test`：组合 `dsh-base → dsh-web-app → workbench` 的专用开发/验收 Profile。
- `docs/design`、`docs/specs`：产品设计与规范。

## Prerequisites

- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.7.0`
- 经审计的 DSH baseline：`dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- 本机 Chrome、Chromium 或 Edge（完整 `pnpm verify` 的真实浏览器验收使用；非标准路径可通过 `DSH_PLAYWRIGHT_EXECUTABLE_PATH` 指定）

默认从相邻目录 `../deepseek-harness-baseline` 解析 DSH 源码；也可设置 `DSH_HARNESS_BASELINE_ROOT` 指向同一干净提交。

```sh
node scripts/verify-dsh-context.mjs --require-source
pnpm install
pnpm verify
```

## Run the test Profile

```sh
pnpm build
node profiles/workbench-test/materialize.mjs
profile_dir="${DSH_HOME:-$HOME/.dsh}/profiles/workbench-test"
pnpm --dir "$profile_dir" install
dsh --profile workbench-test --no-open
```

物化脚本默认拒绝覆盖已有 Profile。只有确认目标是可替换的测试 Profile 时才传 `--force`。

首次打开页面时，Workbench 只提供“初始化唯一 Owner”，不会读取项目投影。密码至少 15 个 Unicode 字符；初始化成功后，离线恢复码只显示一次，请在进入工作台前保存到安全位置。后续启动只提供 Owner 登录，不会再创建第二个身份。

如需重置密码，先完整停止 Workbench Web Host，再从已安装的测试 Profile 运行本机恢复命令；恢复会立即撤销所有旧会话，并将旧恢复码替换为只输出一次的新码：

```sh
pnpm --dir "$profile_dir" exec dsh-workbench owner recover
```

交互模式不会回显恢复码或密码。`--stdin` 仅供能安全提供三行有界输入的自动化环境使用；不要把秘密放入参数或环境变量。

Workbench 会话 Cookie 使用 `__Host-` 前缀、`Secure`、`HttpOnly`、`SameSite=Strict` 和 `Path=/`。开发 Profile 绑定 loopback；非 loopback 的生产部署仍需要后续票据提供 TLS 与部署加固。

## Verification boundary

`pnpm verify` 覆盖 Config/Scenario/SQLite、Owner credential/session/recovery、真实 Loader、Client 状态与生命周期、Profile 组合、真实 Chrome 的设置/登录/登出/恢复/重启旅程、built exports、恢复 CLI 和三个真实 tarball。当前三个 Workbench 包仍是 `private`，DSH 依赖仍绑定到经审计源码；因此这些结果证明本地源码兼容和产物完整性，不代表已完成纯 registry 发布闭包。

协作代理在修改前应先阅读 [AGENTS.md](./AGENTS.md) 和 [Project Contract](./docs/agent/PROJECT_CONTRACT.md)。
