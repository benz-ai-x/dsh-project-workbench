# Project Workbench for DeepSeek Harness

Project Workbench 是一个外置 DeepSeek Harness Cordis 插件，目标是把项目状态、证据、文档、协作和 AI 原生项目分析组织成可追溯的项目驾驶舱。

当前实现阶段是 T01 walking skeleton：一条由 Host 持久化、通过 Typert Remote 投影并在浏览器编辑的最小项目状态。它刻意不提前实现 Project、Goal、权限、飞书、文件或 AI 分析领域。

## Workspace layout

- `packages/workbench-host`：Host 权威状态、SQLite、`WorkbenchScenario` 和生成的 Typert Remote。
- `packages/workbench-client`：浏览器状态模型、可访问 UI、`conversation` Slot 和 lazy-CJS Client bundle。
- `packages/workbench-bundle`：插入 Host/Client 稳定行的 DSH Bundle。
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

## Verification boundary

`pnpm verify` 覆盖 Config/Scenario/SQLite、真实 Loader、Client 状态与生命周期、Profile 组合、浏览器重启旅程、built exports 和三个真实 tarball。当前三个 Workbench 包仍是 `private`，DSH 依赖仍绑定到经审计源码；因此这些结果证明本地源码兼容和产物完整性，不代表已完成纯 registry 发布闭包。

协作代理在修改前应先阅读 [AGENTS.md](./AGENTS.md) 和 [Project Contract](./docs/agent/PROJECT_CONTRACT.md)。
