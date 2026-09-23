# Plan 同步配置

Plan 页面使用 Supabase Auth、Postgres 与 Row Level Security 实现跨设备同步。仓库只保存公开的 Project URL 和 Publishable Key；GitHub OAuth Client Secret 只能放在 Supabase Dashboard，不能提交到 Git。

## 1. 创建 Supabase 项目

在 Supabase Dashboard 创建项目，然后打开 SQL Editor，完整执行：

```text
supabase/migrations/001_fitness_plan.sql
```

迁移会创建：

- `fitness_plan_public`：匿名访客可读的脱敏快照；
- `fitness_plan_private`：仅通过受控数据库函数访问的完整状态（健身与学习计划共用该状态载荷）；
- `load_private_fitness_plan()`：仅本人读取；
- `save_fitness_plan()`：带版本检查的原子保存；
- GitHub 数字账号 ID `73994563` 的写权限校验。

## 2. 配置 GitHub OAuth

1. 在 GitHub 的 Developer settings 中创建 OAuth App。
2. Homepage URL 使用 `https://miyaal.github.io`。
3. Authorization callback URL 使用 Supabase Dashboard 在 Authentication → Providers → GitHub 中显示的回调地址，格式为：
   `https://<project-ref>.supabase.co/auth/v1/callback`。
4. 将 GitHub Client ID 和 Client Secret 填入 Supabase 的 GitHub Provider。
5. Supabase Authentication → URL Configuration：
   - Site URL：`https://miyaal.github.io`
   - Redirect URLs：加入 `https://miyaal.github.io/plan/`
   - 本地预览时再加入 `http://localhost:4000/plan/`

Client Secret 不得写入 `_config.yml`、JavaScript 或 Git。

## 3. 配置站点公开参数

从 Supabase Project Settings → API 复制 Project URL 和 Publishable Key，填写：

```yaml
plan:
  supabase_url: "https://<project-ref>.supabase.co"
  supabase_publishable_key: "<publishable-key>"
  owner_github_login: MiyaaL
  owner_github_id: "73994563"
```

Publishable Key 设计为浏览器公开使用；真正的访问控制由迁移中的 RLS、权限回收和 GitHub identity 校验完成。不要使用或提交 `service_role` key。

## 4. 首次发布

完成配置并部署后：

1. 打开 `/plan/`；
2. 点击“管理计划”并使用 GitHub 账号 MiyaaL 登录；
3. 填写周期、体重和三项当前/目标 1RM，或从“学习计划”创建按日学习目标；
4. 首次保存会同时创建私有状态和公开脱敏快照。学习总结、感悟与上传附件只保存在私有状态，附件单个限制为 2 MB。

若登录账号不是 GitHub 数字 ID `73994563`，数据库函数会返回 `not_plan_owner`，无法读取或修改私有计划。

## 5. 验证

本地执行：

```bash
docker run --rm -v "$PWD:/site:ro" node:22-alpine node /site/tests/plan-core.test.js
docker run --rm -v "$PWD:/site:ro" node:22-alpine node /site/tests/plan-adaptive.test.js
docker run --rm -v "$PWD:/site:ro" node:22-alpine node /site/tests/plan-prescriptions.test.js
docker run --rm -v "$PWD:/site:ro" node:22-alpine node /site/tests/plan-replan.test.js
docker run --rm -v "$PWD:/site:ro" node:22-alpine node /site/tests/plan-defer.test.js
docker run --rm -v "$PWD:/site:ro" node:22-alpine node /site/tests/plan-chart.test.js
docker run --rm -v "$PWD:/site:ro" node:22-alpine node /site/tests/plan-store.test.js
docker compose run --rm site ruby scripts/check_blog_format.rb
docker compose run --rm site bundle exec jekyll build --trace
git diff --check
```

上线后分别验证：

- 未登录访客只能读取公开计划；
- MiyaaL 登录后可修改并跨设备读取；
- 其他 GitHub 账号无法调用私有读取和保存函数；
- 浏览器离线时只显示最近一次公开缓存，编辑入口不可用；
- 两台设备同时修改时会出现版本冲突提示。


## 6. 健身计划生成规则

`assets/js/plan-core.js` 只使用日历周线性递进：连续三周递进，第四周减量。所有主项共用同一周次，缺课不会重启波次。不再生成间隔恢复、额外测试前减量或就绪不足评估，也不再按 RPE、失败或辅助动作记录自动改写后续处方。

- 线性参考由 `cycle.progression.anchorDate`、固定的 `anchor1rm` 和目标决定，按周推进到截止周。没有显式起点时使用周期起始日和初始能力。参考值与实际 `current1rm` 分开；记录训练仍更新能力统计，但不改变固定的线性路径。
- 卧推强度与深蹲三周分别为 4×5、4×4、4×3，使用当周参考的 80%、82.5%、85%；容量推为 4×6、4×5、4×4，使用 70%、72.5%、75%。谷周统一为 3×5、62.5%。
- 引体按体重加额外负重的总重量计算，三周为 4×4 / 82.5%、4×3 / 85%、4×2 / 87.5%；谷周为 3×4 / 70%。所有负荷按设备增量取整。
- 各主项最后一课为目标测试，列出 90% / 95% / 100% 三档尝试；上一把稳定后再继续。其他末周训练仍执行所在波次，不附加减量。谷周和测试不排辅助动作，其他辅助动作使用固定模板。
- `requestedEndDate` 保留用户设定截止日。普通旧周期的 `endDate` 兼容明确执行的整体改期及已记录训练日期。`replanRemaining` 从指定日期重建剩余排期、清除旧整体顺延并锁定截止日；保留此前排期、所有日志、体重和目标。日志超出新截止日时拒绝重排。
- 设置中默认固定截止日、假期照常训练。修改排期参数才重新排期，仅改训练时间或能力统计不会清掉已有单次改期；已锁定的周期只能在截止日前单次改期。手动休息日优先于假期训练覆盖。
- 当前周期的已批准迁移配置位于 `_config.yml` 的 `plan.schedule_revision`。本人登录后仅在周期 ID、截止日、目标匹配且未应用该版本时自动重排，设置一次固定线性起点，并原子保存私有状态和公开快照。保存失败不会显示成功或替换为未保存的计划；版本冲突不强制覆盖。匿名仅显示已保存快照及必要的待同步提示。
- 有效的 1–5 次、实填 RPE 7–10 主项组仍参与实际能力统计；缺失 RPE 不补成计划值。谷周及历史恢复课不参与估算；旧 schema 没有实填标记的 RPE 不视为实测。同日仅一条观察，最近三次取中位数，仅一次时与固定评估基准平滑。重复保存或改备注不会累计提升能力。
- `generate(state, calendars, { asOfDate })` 不修改输入；调用方保存返回状态与对应快照。已记录训练的日期和处方快照保持不变；公开数据不含私有日志、体重或引体具体训练负荷。旧 `loadAdjustments` 字段兼容保留，但不再参与生成。
- 月历普通课显示组数最多的主训练组，测试日显示最终目标尝试；历史顶组在详情中保留。

本次起点、日期与重量示例见 [当前计划修订](plan-review-2026-09-23.md)。核心回归与浏览器自动迁移回归：

```bash
node tests/plan-linear.test.js
# 先完成 Jekyll 构建，并将 jsdom 路径替换为实际安装位置。
docker run --rm --network none \
  -v "$PWD:/site:ro" \
  -v "/path/to/jsdom/node_modules:/deps/node_modules:ro" \
  -e NODE_PATH=/deps/node_modules \
  node:22-alpine node /site/tests/plan-linear-migration-smoke.test.js
```
