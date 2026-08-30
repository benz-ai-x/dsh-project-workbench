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

先构建工作区，确保被链接的 Host、Client 与 Client bundle 已存在。物化脚本把 Bundle 和提供恢复命令的 Host 依赖改写成指向本仓库的绝对 `link:`，不会依赖复制后的目录结构。Host 是非 Bundle 依赖，不会增加 Profile 层；直接依赖它是为了让 pnpm 在物化 Profile 中安装 `dsh-workbench` 命令。若目标 Profile 已存在，脚本会拒绝覆盖；只有确认它是可替换的测试 Profile 后才使用 `--force`。

数据库路径 `.dsh/project-workbench.sqlite` 相对于启动 Workbench 的当前项目目录解析，因此每个被测项目拥有独立数据文件。Owner credential、恢复码摘要和可撤销会话由 DSH Credentials 保存在 `$DSH_HOME/.credentials.yaml`，不会写入项目业务数据库。Profile 自身的 `cordis.patch.yml` 是最后一个项目内层，可用于测试覆盖；机器级 `$DSH_HOME/cordis.patch.yml` 仍具有更高优先级。

首次打开时设置唯一 Owner，并立即离线保存只显示一次的恢复码。之后页面只显示登录入口。开发 Profile 只监听 loopback；现代 Chromium 会把 loopback 视为潜在可信来源，因此仍能接受 Workbench 的 `Secure`、`HttpOnly`、`SameSite=Strict`、`__Host-` Cookie。

离线恢复必须先停止正在运行的 Web Host，然后执行：

```sh
pnpm --dir "$PROFILE_DIR" exec dsh-workbench owner recover
```

命令默认通过 TTY 隐藏输入，并只在标准输出写一行替换恢复码。恢复成功会重置密码、撤销全部会话并永久作废旧恢复码。
