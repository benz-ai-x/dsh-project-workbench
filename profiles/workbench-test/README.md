# Workbench test profile

这是 Project Workbench 的专用开发与验收 Profile，不是生产部署模板。它按固定顺序组合：

1. `@deepseek-ai/dsh-base`
2. `@deepseek-ai/dsh-web-app`
3. `@benz-ai-x/dsh-project-workbench-bundle`

`patchReload: live` 让开发时修改 Profile 或 `DSH_HOME` patch 后触发重载。

## 物化到 DSH_HOME

在仓库根目录执行：

```sh
pnpm install
pnpm build
node profiles/workbench-test/materialize.mjs
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/workbench-test"
pnpm --dir "$PROFILE_DIR" install
dsh --profile workbench-test --dump-config
dsh --profile workbench-test
```

先构建工作区，确保被链接的 Host、Client 与 Client bundle 已存在。物化脚本把工作区依赖改写成指向本仓库 Bundle 的绝对 `link:`，不会依赖复制后的目录结构。若目标 Profile 已存在，脚本会拒绝覆盖；只有确认它是可替换的测试 Profile 后才使用 `--force`。

数据库路径 `.dsh/project-workbench.sqlite` 相对于启动 Workbench 的当前项目目录解析，因此每个被测项目拥有独立数据文件。Profile 自身的 `cordis.patch.yml` 是最后一个项目内层，可用于测试覆盖；机器级 `$DSH_HOME/cordis.patch.yml` 仍具有更高优先级。
