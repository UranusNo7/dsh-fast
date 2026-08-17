# progress

## 2026-08-16 - Task: 极简模式（minimal preset）Windows 兼容性修复

### What was done

修复极简模式在原生 Windows 上完全不可用的问题：为 minimal 预设补齐与 standard/code/cordis 一致的平台门控，win32 下禁用持久 bash PTY 栈并改用一次性 pwsh 工具，POSIX 行为不变；同步更新了相关测试、参考文档与 Agent Note。

### Testing

- `apps/cli/tests/windows-shell.spec.ts`：6/6 通过（含新增的 minimal 预设平台门控断言）。
- win32 真机组合验证（真实 Web 组合 + 真实 preset 根）：minimal 挂载工具为 `["pwsh","str_replace_editor"]`，pwsh 真实执行并返回正确 cwd，`str_replace_editor` 可读取文件，组装提示词仅剩 `deployment:persona`。
- `verify-translation-pairing`：4 对文档一致。
- `verify-agent-note-format`：541 篇合规。
- `verify-cordis-config`：120 个配置通过。
- `verify-md-wrap`、`verify-doc-budgets`：通过。

### Notes

改动文件清单：

- `apps/cli/config/agent-presets/minimal/agent.cordis.yml`：核心修复。win32 下禁用 PTY 栈三行（`pty`/`terminal-bash`/`persistent-bash`），新增仅 win32 挂载的 `tool-pwsh` 行。
- `apps/cli/tests/windows-shell.spec.ts`：将「minimal 无任何 shell 工具行」断言改为「PTY 栈 POSIX-only、pwsh win32-only」的平台门控断言。
- `apps/cli/reference/README.md`、`apps/cli/reference/README.zh.md`、`apps/cli/reference/README.i18n.yaml`：极简模式描述更新为 POSIX 持久 bash / win32 一次性 pwsh，并重记录配对哈希。
- `.agents/notes/implemented/architecture/2026-08-11-loader-entry-disabled-interpolation.md`（及 `.zh.md`、`.i18n.yaml`）：原标注的「minimal 缺失 win32 PTY 栈」后续工作标记为已完成，并重记录配对哈希。
- `.agents/notes/implemented/bug-fix/2026-08-10-minimal-preset-owns-rl-composition.md`（及 `.zh.md`、`.i18n.yaml`）：「不支持 Windows agent」事实更新为 win32 一次性 pwsh 回退方案，新增备选方案记录，并重记录配对哈希。
- `.agents/notes/implemented/feature/2026-08-11-minimal-profiles-bare-two-tool-runtime.md`（及 `.zh.md`、`.i18n.yaml`）：双工具描述按平台更新，并重记录配对哈希。

回滚方式（本 checkout 无 git，采用文件级回滚）：

- `apps/cli/config/agent-presets/minimal/agent.cordis.yml`：删除三处 `disabled: !!js process.platform === 'win32'`（位于 `pty`、`terminal-bash`、`persistent-bash` 行）与整个 `tool-pwsh` 行，头部注释恢复为「仅组合持久 bash 和 str_replace_editor」原文，即回到修复前的固定双工具组合。
- `apps/cli/tests/windows-shell.spec.ts`：将新增的「minimal gates its PTY stack to POSIX and mounts one-shot pwsh on win32」用例替换回原「minimal mounts no shell tool row at all (its shell is the PTY stack)」用例。
- 文档与 Agent Note（README 双语及配对哈希、3 篇 Agent Note 双语及配对哈希）：恢复为修复前文本；若无法手工还原，可从本仓库上一发布版本（`apps/cli/reference/` 与 `.agents/notes/implemented/` 对应路径）取回原内容，再运行 `pnpm run verify-translation-pairing --write <文件>` 重记录配对哈希（需 git 环境）。
- 回滚后验证：`pnpm exec vitest run apps/cli/tests/windows-shell.spec.ts`、`pnpm run verify-cordis-config`、`pnpm run verify-translation-pairing`。

## 2026-08-16 - Task: 修复全访问模式下 pwsh 可选升级字段阻断执行

### What was done

当 effective sandbox mode 已为 danger-full-access 时，pwsh 把外层调用方实体化的 sandbox_permissions/justification 视为无效兼容字段，跳过配对/审批，按 standing policy 执行；read-only/workspace-write 仍严格配对和严格加宽；同步回归测试和双语 README。

### Testing

- `pnpm exec vitest run packages/shell/tool-pwsh/tests/tools.spec.ts`：1 file, 63 passed, exit 0。
- `pnpm run typecheck`：exit 0。
- `node node_modules/oxlint/bin/oxlint packages/shell/tool-pwsh/src/index.ts packages/shell/tool-pwsh/tests/tools.spec.ts`：0 warnings, 0 errors, exit 0。
- `pnpm run lint`：build:lib:host 成功，但包装后的 oxlint/tsx 进程以 -1/4294967295 异常终止且无 findings；目标文件直接 lint 已通过。
- `pnpm run doc-sync`：tsx 在门禁启动前以 -1/4294967295 异常终止，无文档诊断；README.i18n.yaml 已根据两个 README 的 Git blob OID 更新，但 checkout 无 .git，无法写 translation snapshot refs。
- 当前 GUI 运行时未热加载 plain package，本会话未做 live pwsh 复测；需重启/重新装载运行时后验证。

### Notes

改动文件清单逐项一句：

- `packages/shell/tool-pwsh/src/index.ts`：effective mode 为 danger-full-access 时将实体化的 escalation 字段视为兼容字段并跳过配对/审批。
- `packages/shell/tool-pwsh/tests/tools.spec.ts`：新增全访问模式跳过配对/审批的回归用例。
- `packages/shell/tool-pwsh/README.md`：更新全访问模式行为说明。
- `packages/shell/tool-pwsh/README.zh.md`：同步中文行为说明。
- `packages/shell/tool-pwsh/README.i18n.yaml`：按两个 README 的 Git blob OID 更新配对哈希。
- `progress.md`：追加本轮记录。

回滚点/方式：恢复本轮前的 index.ts（validatePwshArgs 始终验证 escalation、execute 无 danger-full-access 分支），删除两个新增测试并恢复 setupSandboxed 签名，恢复 README 双语与 sidecar 旧 hash；然后重跑聚焦 Vitest、typecheck、目标文件 oxlint。不要使用 git destructive commands，不运行任何命令。

## 2026-08-16 - Task: 更正 pwsh 修复的 doc-sync 验证记录

### What was done

说明收到完整 doc-sync 结果后，更正上一条“tsx 未启动门禁”的不完整记录；代码与 README 不变。

### Testing

准确记录 `pnpm run doc-sync` 自然完成并运行 28 个门禁，22 通过、6 失败。失败分类：translation pairing / config catalog 涉及 `docs/capability-seams.md`、`docs/config-catalog.md`、`docs/module-graph.md` 的既有失步/陈旧内容，与本轮 tool-pwsh 文件无关；public repository links、archived agent notes、documentation site checks 因 checkout 无 `.git` 失败；docs:build 主构建成功，但 verify-doc-site-fragments 在 Windows 以 -1/4294967295 终止。不要声称 doc-sync 通过。

### Notes

改动文件仅 progress.md；说明本追加块取代上一块第 48 行对 doc-sync 的判断，其他测试证据不变。回滚方式：仅删除本更正块会恢复到更正前日志状态，但那会重新暴露不准确记录；不建议回滚。不要运行命令，不改其他文件。

## 2026-08-17 - Task: 新增可选跨提供方逻辑模型策略插件

### What was done

新增独立、默认不加载的 `@deepseek-ai/dsh-llm-model-policy` 插件：以逻辑模型名统一候选路由、输出上限、推理等级、图片能力和 service tier，并在模型内容开始前执行有界故障转移；复用 pi-ai 的凭据、目录、附件、重放和协议转换。为 pi-ai 增加 `serviceTier` 配置和 `fast` 到 OpenAI-compatible `priority` 的线字段映射；补齐 Loader 真实组合测试、双语 README、生成目录与模块图，并将已被当前多模态实现取代的旧图片块 Agent Note 冻结归档。

### Testing

- `pnpm exec vitest run packages/llm/llm-model-policy/tests packages/llm/llm-pi-ai/tests/adapter.spec.ts --reporter=dot`：3 files、51 tests 通过。
- `pnpm run typecheck`：exit 0；包含 Host 类型构建与最终 bundle 构建。
- `node node_modules/oxlint/bin/oxlint packages/llm/llm-model-policy/src packages/llm/llm-model-policy/tests packages/llm/llm-pi-ai/src/index.ts packages/llm/llm-pi-ai/src/config.ts packages/llm/llm-pi-ai/src/adapter.ts packages/llm/llm-pi-ai/tests/adapter.spec.ts`：0 warnings、0 errors。
- `node --input-type=module -e ...`：重建后的策略包导出 smoke test 通过；`publint`、`verify-package-paths`、`verify-package-invariants`、`verify-cordis-config`、`verify-node-next-types`、`verify-runtime-closure`、`verify-vendored-links`、`verify-dsh-package-licenses` 均通过。
- 文档叶门禁通过：`doc-typecheck`、`gen-config-catalog --check`、`gen-module-graph --check`、`gen-doc-graphs --check`、`verify-md-links`、`verify-translation-pairing`（938 对）、README Model Experience/limitations、Agent Note format、export JSDoc、doc budgets；VitePress 片段测试 5/5 通过。
- 显式运行的 `doc-sync` 为 24 个门禁通过、4 个环境阻断：public repository links、archived Agent Notes、project-doc-site 的 Git 文件枚举均因 checkout 无 `.git` 失败；docs build 已完成渲染，但其末端校验同样受无 `.git` 影响。`verify-built-package-invariants` 还报告既有 client/extension 包缺少编译产物，未报告新策略包；`knip` 在仓库扫描时因 OOM 终止。

### Notes

改动文件清单：

- `packages/llm/llm-model-policy/package.json`：新增发布元数据、peer/dev 依赖和导出面。
- `packages/llm/llm-model-policy/tsconfig.json`：新增 Host 包 TypeScript 工程引用。
- `packages/llm/llm-model-policy/README.md`：记录逻辑路由、参数统一、Fast、图片/推理筛选、故障转移和 Model Experience。
- `packages/llm/llm-model-policy/README.zh.md`：同步中文包契约。
- `packages/llm/llm-model-policy/README.i18n.yaml`：记录 README 双语配对哈希。
- `packages/llm/llm-model-policy/src/types.ts`：定义逻辑模型、候选路由和解析后策略类型。
- `packages/llm/llm-model-policy/src/config.ts`：定义 schema、默认值、路由排序、重复路由和推理策略校验。
- `packages/llm/llm-model-policy/src/adapter.ts`：实现逻辑目录、参数下发、图片/推理能力筛选、重放来源重映射和输出前故障转移。
- `packages/llm/llm-model-policy/src/index.ts`：实现 named-export Cordis function plugin、物理 pi-ai adapter 缓存和 logical provider 注册。
- `packages/llm/llm-model-policy/src/invariant.ts`：提供无运行时关系的包级 invariant companion。
- `packages/llm/llm-model-policy/tests/adapter.spec.ts`：覆盖目录、推理、图片能力和前输出故障转移。
- `packages/llm/llm-model-policy/tests/composition.spec.ts`：覆盖 Loader、Include、真实 Cordis 配置、Fast 线字段、逻辑上限和跨提供方切换。
- `packages/llm/llm-pi-ai/src/config.ts`：增加 service tier、公开 profile/schema helper 与类型。
- `packages/llm/llm-pi-ai/src/adapter.ts`：校验 service tier 并注入 OpenAI-compatible `service_tier`。
- `packages/llm/llm-pi-ai/src/index.ts`：导出 service tier/profile helper 和可复用凭据解析函数。
- `packages/llm/llm-pi-ai/tests/adapter.spec.ts`：增加 Fast payload 回归和公开导出断言。
- `packages/llm/llm-pi-ai/README.md`：补充 service tier/helper 与输入模态契约。
- `packages/llm/llm-pi-ai/README.zh.md`：同步中文 pi-ai 契约。
- `packages/llm/llm-pi-ai/README.i18n.yaml`：更新 README 配对哈希。
- `packages/llm/README.md`：加入 model-policy 包索引。
- `packages/llm/README.zh.md`：同步 LLM 组索引。
- `packages/llm/README.i18n.yaml`：更新组 README 配对哈希。
- `tsconfig.host.json`：注册新包的 Host aggregate 引用。
- `pnpm-lock.yaml`：记录新 workspace importer。
- `docs/config-catalog.md`：由 generator 加入策略 Config 与 service tier 字段。
- `docs/config-catalog.zh.md`：同步中文配置目录及现有 Firecrawl/pi-ai 对侧条目。
- `docs/config-catalog.i18n.yaml`：更新配置目录配对哈希。
- `docs/module-graph.md`：由 generator 加入 model-policy 依赖边。
- `docs/module-graph.zh.md`：同步 model-policy 与 Firecrawl 依赖边。
- `docs/module-graph.i18n.yaml`：更新模块图配对哈希。
- `docs/capability-seams.zh.md`：同步现有 Firecrawl web provider 对侧节点和注册边。
- `docs/capability-seams.i18n.yaml`：更新 capability seams 配对哈希。
- `.agents/notes/implemented/architecture/2026-08-17-logical-model-policy-routing.md`：记录逻辑 provider ownership、参数/模态/重放安全和前输出故障转移决策。
- `.agents/notes/implemented/architecture/2026-08-17-logical-model-policy-routing.zh.md`：同步中文架构决策。
- `.agents/notes/implemented/architecture/2026-08-17-logical-model-policy-routing.i18n.yaml`：记录新 Agent Note 配对哈希。
- `.agents/notes/implemented/architecture/2026-06-21-bounded-llm-request-recovery.md`：说明基础恢复与逻辑候选恢复的 ownership 边界。
- `.agents/notes/implemented/architecture/2026-06-21-bounded-llm-request-recovery.zh.md`：同步恢复边界及归档链接。
- `.agents/notes/implemented/architecture/2026-06-21-bounded-llm-request-recovery.i18n.yaml`：更新恢复 Note 配对哈希。
- `.agents/notes/implemented/architecture/2026-06-11-content-block-vocabulary.md`：将当前图片块引用重定向到冻结历史 Note。
- `.agents/notes/implemented/architecture/2026-06-11-content-block-vocabulary.zh.md`：同步中文历史链接。
- `.agents/notes/implemented/architecture/2026-06-11-content-block-vocabulary.i18n.yaml`：更新配对哈希。
- `.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.md`：将历史图片块引用重定向到归档路径。
- `.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.zh.md`：同步中文历史链接。
- `.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.i18n.yaml`：更新配对哈希。
- `.agents/notes/implemented/feature/2026-07-22-web-multimodal-image-input-and-durable-attachments.md`：将历史图片块引用重定向到归档路径。
- `.agents/notes/implemented/feature/2026-07-22-web-multimodal-image-input-and-durable-attachments.zh.md`：同步中文历史链接。
- `.agents/notes/implemented/feature/2026-07-22-web-multimodal-image-input-and-durable-attachments.i18n.yaml`：更新配对哈希。
- `.agents/notes/archived/simplification/2026-07-04-drop-image-content-block.md`：移动冻结的旧图片块决策并加入归档日期。
- `.agents/notes/archived/simplification/2026-07-04-drop-image-content-block.zh.md`：移动冻结的中文旧图片块决策并加入归档日期。
- `.agents/notes/archived/simplification/2026-07-04-drop-image-content-block.i18n.yaml`：记录冻结归档 triplet 的 Git blob 配对哈希。
- `.agents/notes/archived/manifest.json`：追加归档 triplet 的 SHA-256 seal。
- `progress.md`：追加本轮实现、验证与回滚记录。

回滚方式（本 checkout 无 `.git`，采用文件级回滚）：删除整个 `packages/llm/llm-model-policy/`，移除 `tsconfig.host.json`、`packages/llm/README*`、`pnpm-lock.yaml` 中对应新增引用；恢复 `llm-pi-ai` 的 serviceTier/helper 代码、README 与测试；恢复本轮生成的 `docs/`、Agent Note 配对哈希及 active inbound link；将归档 triplet 移回 `.agents/notes/implemented/simplification/`、移除两侧 `Archived` 行并从 `archived/manifest.json` 删除三项；最后重跑聚焦 Vitest、`pnpm run typecheck`、目标文件 oxlint 和文档叶门禁。

## 2026-08-17 - Task: 将逻辑模型策略插件安装到源码 bundle（保持默认禁用）

### What was done

把逻辑模型策略包加入 base bundle 的安装闭包，并在默认 `cordis.patch.yml` 以 `disabled: true` 注册；这样当前源码运行时具备该插件，仍不会在没有明确逻辑模型/物理候选配置时改变默认行为。同步生成 CLI 组合图、锁文件和 base bundle 双语说明。

### Testing

- `pnpm install --lockfile-only --ignore-scripts --offline`：成功。
- `pnpm run typecheck`：exit 0。
- `verify-cordis-config`：120 个配置通过；`gen-doc-graphs --check`：8 个图文档最新；`verify-translation-pairing`：938 对一致。
- 已初始化本地 `main`，提交 `d9dac14`；因 `vendor/cosmokit/README.md:18` 的既有尾随空格，按用户确认使用 `--no-verify`，未修改供应商源码。
- GitHub Public 仓库已创建：`https://github.com/UranusNo7/dsh-llm-model-policy`；Git push 和 GitHub API tree upload 分别因 GitHub 网络连接失败/HTTP 503 尚未完成。

### Notes

改动文件清单：

- `packages/bundle/base/package.json`：加入逻辑模型策略包的 bundle 依赖。
- `packages/bundle/base/cordis.patch.yml`：添加默认禁用的 `llm-model-policy` 插件行。
- `packages/bundle/base/README.md`：说明已安装但默认禁用的策略行及启用条件。
- `packages/bundle/base/README.zh.md`：同步中文 base bundle 说明。
- `packages/bundle/base/README.i18n.yaml`：更新双语 README 配对哈希。
- `apps/cli/composition.md`：重新生成包含策略插件行的组合图。
- `pnpm-lock.yaml`：记录 base bundle 对策略包的 workspace 依赖。
- `progress.md`：追加本轮安装与上传状态。

回滚方式：从 `packages/bundle/base/package.json` 删除策略依赖；从 `packages/bundle/base/cordis.patch.yml` 删除 `llm-model-policy` 注释和禁用行；恢复 base bundle 双语 README 及 `README.i18n.yaml` 旧内容；重新运行 `pnpm install --lockfile-only --ignore-scripts --offline` 和 `gen-doc-graphs`，再运行 `verify-cordis-config`、`pnpm run typecheck`。

## 2026-08-17 - Task: 完成源码 bundle 安装并上传 GitHub

### What was done

完成源码 bundle 的默认禁用安装，并将完整 workspace 上传到用户确认的 Public GitHub 仓库。由于 `github.com:443` 的 Git smart-HTTP 连接持续失败，改用 GitHub Git Database API；远端 `main` 已指向提交 `c5a7745c7faa757c9a446bd43a003c495ea9171f`，上传 7433 个 blob 文件，远端 tree 与上传前本地提交 tree `3e68abd1a1d400b5649a9b43f9907e823b47cd23` 一致。

### Testing

- GitHub REST 校验：仓库为 Public、默认分支为 `main`；远端 ref、commit message、父提交和 tree 均可读取。
- GitHub recursive tree 校验：7433 个 blob 文件，与本地 `git ls-tree -r HEAD` 数量一致。
- `pnpm run typecheck`：安装 bundle 依赖后的源码构建 exit 0；`verify-cordis-config`、`gen-doc-graphs --check`、`verify-translation-pairing` 均通过。
- 直接 `git push -u origin main` 两次因 GitHub Git endpoint 网络连接失败；API 上传过程出现 HTTP 503，但重试后完成。没有绕过真实代码测试，也没有修改 packaged desktop core。

### Notes

改动文件清单：

- `progress.md`：追加 GitHub 上传成功的远端提交、tree 和文件数记录。

回滚方式：本地源代码不受远端提交影响；如需撤销发布，在 GitHub 仓库设置中删除 `UranusNo7/dsh-llm-model-policy`，或保留仓库并删除/替换 `main` 分支内容。不要执行本地工作区的破坏性 reset。
