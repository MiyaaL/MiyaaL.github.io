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

规则位于 `assets/js/plan-core.js`，所有新周期与现有周期共用，不在数据库中硬编码个人重量。

- `requestedEndDate` 保存用户设定的周期结束日期，`endDate` 只叠加用户明确执行的整体提前 / 顺延，以及不得丢失的已完成训练日期。目标预测不得改写这两个日期。私有状态当前为 schema v3；旧顺延记录首次读取时会迁移为带正负天数的 `scheduleAdjustments`，并从已顺延的 `endDate` 还原原设结束日期，避免重复顺延。
- `priorities` 决定哪些目标参与就绪判断、风险提示和目标测试资格，默认是卧推和深蹲；它不改变周期边界。设置中可选择其他优先项。
- 预计达标时间默认暂按每周 0.5% 的能力变化估计；有至少跨两周的近期有效记录时使用观测速度，并限制在 0.25%–1%/周。该预测只用于风险提示，不改周期边界或直接决定训练重量。
- 当前估算 1RM 只由有效记录更新；训练处方使用从周期基线逐周向目标 1RM 递进的独立基准。实际 RPE 过高或失败仍会下调下一次负荷；跳过的课不推进训练波次，同一主项间隔超过 10 天先恢复训练。
- 官方假期默认不排训练；如果假期照常训练，在“节假日覆盖”中把周模板对应日期设为“训练日（覆盖休假）”。整体提前 / 顺延只平移已有后续训练，不会自行补回被官方假期省略的课次。
- 训练详情中的“整体调整后续计划”会根据目标日期自动提前或顺延本次及其后的未完成训练，并同步调整周期结束日期。范围内的跳过记录恢复为待训练；已有正式记录时拒绝调整；整体提前不能越过此前最后一场训练，否则会拒绝并提示改期。
- 单次训练使用完成的 1–5 次、明确填写的实际 RPE 7–10 主项组估算，以较少次数组为优先，同日仅一条观察。辅助引体允许负的额外重量，只要体重加器械负荷仍为正。减量、减量准备和恢复训练不参与估算；缺失 RPE 不补成计划值。schema v3 迁移前没有来源标记的 RPE 不视为实测，迁移时以已保存的当前能力作为评估锚点。最近三次有效观察取中位数，只有一次观察时与固定基准平滑。
- 能力从原始记录重新计算，因此重复保存、改备注、补录旧训练不会重复累计。手动修改当前能力会创建带日期的新评估基准，保留周期初始基线和原始日志。
- 每个主项的最后一课安排周期目标，远期列出 90% / 95% / 100% 三档计划尝试。进入测试前 21 天，须有近期至少两个训练日的有效记录支持；未就绪或最近失败则改按当前能力做 2×3 评估，目标不变。每一档都必须在上一把稳定且仍有余力时继续。
- 普通递进课使用 4–5 组主训练，不再额外插入单组顶组；恢复、减量和测试阶段不安排辅助动作。辅助动作仅按该节主动作类型归类，改期与优先目标不会跨类型注入动作；容量推使用暂停卧推、绳索下压和侧平举。
- 辅助加重需要所有组达到次数上限、实际最高 RPE 合适且确认动作稳定。设备最小增量可记录；单次增量超过当前重量 10% 时保持重量。
- `generate(state, calendars, { asOfDate })` 支持固定评估日期，浏览器传上海当天，测试可使用确定日期。生成函数不修改输入；调用方保存其返回的 `state` 与对应公开快照。
- 私有日志、体重与引体训练负荷仍不进入公开快照。已记录训练的日期和处方快照保持不变；新规则在本人登录后重新生成，并随下一次“生成并保存”或训练记录保存同步到公开视图。

相关回归检查已包含在上面的 `plan-adaptive.test.js` 与 `plan-defer.test.js` 命令中；浏览器级用例还会覆盖跳过后顺延、再次提前和确认弹窗：

```bash
docker run --rm --network none \
  -v "$PWD:/site:ro" \
  -v "/path/to/jsdom/node_modules:/deps/node_modules:ro" \
  -e NODE_PATH=/deps/node_modules \
  node:22-alpine node /site/tests/plan-defer-smoke.test.js
docker run --rm --network none \
  -v "$PWD:/site:ro" \
  -v "/path/to/jsdom/node_modules:/deps/node_modules:ro" \
  -e NODE_PATH=/deps/node_modules \
  node:22-alpine node /site/tests/plan-repeat-defer-smoke.test.js
```

浏览器级用例需要先把安装了 `jsdom` 的 `node_modules` 路径替换进命令，并在 Jekyll 构建后执行。

训练原则参考：[ACSM 2026 指南](https://acsm.org/resistance-training-guidelines-update-2026/)、[力量测试前减量综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC7552788/)、[卧推 RIR/RPE 研究](https://pubmed.ncbi.nlm.nih.gov/28301439/)。上述具体日期策略与阈值属于本应用的可调整启发式。
