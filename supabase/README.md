# Plan 同步配置

Plan 页面使用 Supabase Auth、Postgres 与 Row Level Security 实现跨设备同步。仓库只保存公开的 Project URL 和 Publishable Key；GitHub OAuth Client Secret 只能放在 Supabase Dashboard，不能提交到 Git。

## 1. 创建 Supabase 项目

在 Supabase Dashboard 创建项目，然后打开 SQL Editor，依次完整执行：

```text
supabase/migrations/001_fitness_plan.sql
supabase/migrations/004_fitness_plan_history.sql
```

`001` 创建：

- `fitness_plan_public`：匿名访客可读的脱敏快照；
- `fitness_plan_private`：仅通过受控数据库函数访问的完整状态；
- `load_private_fitness_plan()`：仅本人读取；
- `save_fitness_plan()`：带版本检查的原子保存；
- `is_fitness_plan_owner()`：GitHub 数字账号 ID `73994563` 的写权限校验。这个 ID 只写在 SQL 里，更换所有者时修改迁移中的字面量并重新执行。

`004` 在此基础上：

- 新增 `fitness_plan_history`，由 `save_fitness_plan()` 在同一事务内追加写入，保留最近 50 个版本；表启用 RLS 且不建策略，只能经函数访问；
- 执行时把当前线上版本写为第一条历史，之后的第一次保存即可回退；
- 为保存载荷加上大小上限（私有状态 4 MB、公开快照 1 MB），超出时返回 `plan_payload_too_large`；
- 新增仅本人可用的 `list_fitness_plan_history()` 与 `load_fitness_plan_history(version)`；
- 对所有私有函数显式 `revoke ... from anon`（Supabase 默认会把新函数授权给 `anon`，仅 `revoke from public` 去不掉）。

`004` 可重复执行。已有项目只需补跑这一份。

### 回退到历史版本

页面没有回退界面。两个 `*_fitness_plan_history` 函数要求以本人身份登录后经 `supabase-js` 调用；在 Dashboard 的 SQL Editor 里没有登录身份，直接查表即可：

```sql
-- 有哪些版本
select version, saved_at, octet_length(state::text) as bytes
from public.fitness_plan_history
where plan_key = 'fitness'
order by version desc;

-- 用第 120 版的内容覆盖当前内容。版本号保持为当前值，已打开的页面下一次保存不会冲突。
begin;
update public.fitness_plan_private as p
set state = jsonb_set(h.state, '{version}', to_jsonb(p.version)), updated_at = now()
from public.fitness_plan_history as h
where p.plan_key = 'fitness' and h.plan_key = 'fitness' and h.version = 120;

update public.fitness_plan_public as p
set snapshot = jsonb_set(h.snapshot, '{version}', to_jsonb(p.version)), updated_at = now()
from public.fitness_plan_history as h
where p.plan_key = 'fitness' and h.plan_key = 'fitness' and h.version = 120;
commit;
```

回退前建议先在页面里点 “Back up JSON” 备份当前版本；回退后刷新页面。

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

从 Supabase Project Settings → API 复制 Project URL 和 Publishable Key，填写 `_config.yml`：

```yaml
plan:
  supabase_url: "https://<project-ref>.supabase.co"
  supabase_publishable_key: "<publishable-key>"
```

Publishable Key 设计为浏览器公开使用；真正的访问控制由迁移中的 RLS、权限回收和 GitHub identity 校验完成。不要使用或提交 `service_role` key。`_config.yml` 里不再有所有者 ID 或一次性迁移配置：前者只在 SQL 中生效，后者均已执行完毕并删除。

## 4. 首次发布

完成配置并部署后：

1. 打开 `/plan/`；
2. 点击页头的 “Owner sign-in” 并使用 GitHub 账号 MiyaaL 登录；
3. 填写周期、体重和三项当前/目标 1RM；
4. 首次保存会同时创建私有状态和公开脱敏快照。

若登录账号不是 GitHub 数字 ID `73994563`，数据库函数会返回 `not_plan_owner`，无法读取或修改私有计划。

## 5. 验证

测试只依赖 Node 22 与 `package.json` 里的 `jsdom`，不需要 Docker 或 Jekyll 构建。浏览器测试通过 `tests/helpers/dom.js` 直接读取 `plan/index.html` 源文件：

```bash
npm ci
npm test                              # node --test "tests/**/*.test.js"
node --test tests/plan-feedback.test.js   # 只跑一个文件
```

| 文件 | 覆盖内容 |
| --- | --- |
| `plan-feedback.test.js` | 反馈式处方：能力上限、保持与回退、缺训、目标增速告警、测试周、引体第二次暴露、节假日、存量周期接入 |
| `plan-review.test.js` | 手动调整：缺训只打标签、预览不保存、确认后保存一次、可回到计划线 |
| `plan-sync.test.js` | 单一保存路径、冲突合并、取消冲突对话框、失败回滚、防重复提交 |
| `plan-chart.test.js` | 归一化进度图 |
| `plan-app-smoke.test.js` 等 `*-smoke` | 页面交互：抽屉、对话框、拖拽改期、整体提前/顺延、重排、全周期视图 |
| `plan-core`、`plan-fixed-wave`、`plan-linear`、`plan-prescriptions`、`plan-volume`、`plan-replan`、`plan-defer`、`plan-adjust-schedule`、`plan-unskip` | 旧周期（`programRevision: "legacy"`）的固定波浪与排期行为，通过 `tests/helpers/legacy-core.js` 构造 |
| `plan-store.test.js` | 存储适配器接口；内存替身位于 `tests/helpers/memory-store.js`，不随站点发布 |

站点本身的检查不变：

```bash
docker compose run --rm site ruby scripts/check_blog_format.rb
docker compose run --rm site bundle exec jekyll build --trace
git diff --check
```

上线后分别验证：

- 未登录访客只能读取公开计划；
- MiyaaL 登录后可修改并跨设备读取；
- 其他 GitHub 账号无法调用私有读取和保存函数；
- 浏览器离线时只显示最近一次公开缓存，编辑入口不可用；
- 两台设备同时修改时出现冲突对话框，“Merge and save” 后两边的训练记录都在。

## 6. 保存与冲突

- 所有写入都经过 `plan-app.js` 的 `commit(nextState, message)`：先生成计划与公开快照，服务端接受之后才替换页面上的状态。保存失败或冲突时，页面保持最近一次已保存的计划；训练记录、跳过、体重、改期、设置都走同一条路径。保存进行中再次点击不会发起第二次保存。
- 版本冲突时弹出对话框，三个选择：
  - **Merge and save**（默认）：`core.mergeStates(base, remote, local)` 做三方合并。训练记录按课次 ID、体重按日期、单次改期/跳过按课次 ID 逐条合并；同一条记录两边都改时取 `completedAt` 较新的一条。计划设置（起止日期、周模板、目标、整体顺延等）只允许一边修改；两边都改了同一项时拒绝自动合并并说明是哪一项。
  - **Discard mine and reload**：放弃本机修改，重新载入服务端版本。
  - **Overwrite the server version**：整份覆盖，仅作为明确的次要选项保留。
- 按 Esc 关闭冲突对话框等同于放弃本机这次修改，页面回到最近一次已保存的计划。
- 服务端每次保存追加一条历史（见第 1 节），误覆盖可以回退。

## 7. 健身计划生成规则

每个周期记录自己使用的处方版本 `activeCycle.programRevision`，与 `volumePrescription` 的做法相同：

- `feedback-v2`：新建周期的默认值，规则见下。
- `legacy`：没有该字段的存量周期与所有归档周期，按原来的“日历周三周递进、一周减量”固定波浪重新生成，保证历史不被改写。旧规则与当时的示例见 [docs/plan/plan-review-2026-09-23.md](../docs/plan/plan-review-2026-09-23.md) 和 [docs/plan/plan-review-2026-09-30.md](../docs/plan/plan-review-2026-09-30.md)。

**存量的进行中周期**在本人载入时由 `adoptFeedbackProgram(state, today)` 接入新规则，并写入 `programRevisionFromDate = 当天`：当天之前的课次和所有已记录的课次保持原处方不变，当天及之后的未记录课次改用新规则。接入只发生在内存中，随本人下一次保存落库；访客在那之前看到的仍是旧快照。

### 参考重量

- 参考 1RM 按周线性从起点走向目标，并受 `maxWeeklyGain`（默认每周 1%）限制。**默认情况下处方只跟这条计划线走**：缺训、没做满的组、偏高的 RPE 都不会自动改动后面的重量。原因是本人可能换了日子训练而没有同步日历，“某天没有记录”并不等于没练。
- 早于今天且没有记录的课次状态为 `missed`（界面显示 “Missed”），这只是一个标签。
- `current1rm`（进度卡片和图表上的估算值）始终来自训练记录：
  - 1–5 次、实填 RPE 7–10 的主项组按 RPE 表估算；最近三次取中位数，仅一次时与评估基准平滑；
  - 按处方完成强度课的全部主项组但没填 RPE，视为确认了该课的参考值（容量课不作为 1RM 的依据）；周期切换到本方案之前记录的课次同样计入；
  - 没达到处方次数的组按 RPE 10 计入估算；
  - 测试课的单次即使没填 RPE 也按 RPE 10 处理，完成的最重一把直接成为 `current1rm`。
- **手动调整（Adjust plan to my training）**：所有者点击后先看到预览（今天起哪些课次会变、从什么变成什么），确认才保存。它把“截至当天的执行情况”写入 `activeCycle.trainingReview = { date, estimates }`，从当天起的处方据此重算：
  - **能力上限**：调整当周的参考值不超过当时估算 1RM × 1.03（引体按“体重 + 负重”计算）；往后每远一周再放宽一个 `maxWeeklyGain`，所以后面的周次仍然逐周上涨。
  - **保持**：调整日之前的递进周强度课里，任一主项组没做满处方次数，或顶组实填 RPE ≥ 9.5，该主项下一周的参考值不递增。
  - **缺训**：某个主项在调整日之前连续缺训满 7 天，参考值按缺训的整周数暂停，恢复后的第一周波次回退一档，课次标注 “back from a layoff”。
  - 调整是一次快照：之后新出现的缺训或失败组在下一次手动调整之前不生效。已记录的课次永远不会被改写。
  - 同一个对话框里的 “Return to the programmed plan” 会删除 `trainingReview`，回到计划线。
- **重新锚定**：在设置里修改某个主项的“Current”，会以新数值、当天为起点重画该主项的参考线（`progression.liftAnchors`）。

### 周波次与测试

- 波次从各主项自己的测试日**向前倒数**：测试周之前依次是递进第 3、2、1 周、减量周、再往前循环。测试周占据减量周的位置，所以不会出现“减量周紧接测试周”。周期中途切换到本方案时，如果切换前的日历波次刚做完减量周，倒数恰好又落在减量周的那一周改为递进第 1 周，不连续减量两周。倒数落在周期第一周的减量周改为一个入门的递进第 1 周。
- 测试日的选择（`assignTestSessions`），优先级依次为：不排在周期最后一个训练日；测试之后还留有同一主项的课次用于补测（把测试提前，而不是把截止日推后）；尽量不让两项测试落在相邻两天；其余条件相同则尽量靠后。默认模板、周五截止的 13 周周期得到：引体周二、深蹲周六、卧推下周一，各自之后都有一次补测机会。
- 每个主项在自己测试前 6 天内（以及测试所在周）的课次为 “Taper”：强度课做开把单次 90% + 2×3 @ 75%，容量课只做轻量 3×5 @ 62.5%，不再叠加第二把重单次。引体的减量与轻量组为自重 3×4。
- 测试尝试为目标的 92% / 97% / 100%；做过手动调整时改为 `min(目标, 测试当周的能力上限)`。目标高于这个基数时，说明文字会指出尝试重量低于目标。
- 测试之后同一主项的课次为 “Retry or recovery”：测试未记录或未达到目标时给出同样的三档尝试，已达到目标时为轻量恢复组。
- 跳过测试课后，测试自动改到该主项其余未完成课次中符合上述规则的一次。
- 引体的处方负重不会低于 0（不出现需要辅助的负数）。

### 各课处方

- 卧推强度、深蹲强度：顶组 1×1 @ 88% / 90% / 92%（目标 RPE 8），主训练组 4×5 @ 80%、4×4 @ 82.5%、4×3 @ 85%。
- 引体：顶组同上，主训练组 4×4 @ 82.5%、4×3 @ 85%、4×2 @ 87.5%，百分比作用于“体重 + 负重”。
- 容量日（`moderate-volume-v1`）：卧推 4×10 @ 65%、4×9 @ 67.5%、4×8 @ 70%；深蹲 3×8 @ 67.5%、70%、70%；保留 2–3 次余力，不加顶组。旧周期的 `legacy` 容量为 4×6 / 4×5 / 4×4 @ 75% / 77.5% / 80%。
- **引体第二次暴露**：在周模板里离引体日最远、且不是深蹲强度日的那一天（默认模板为周五的卧推容量日）追加 “Pull-up back-off sets”：3×6 @ 70%、3×5 @ 72.5%、3×5 @ 75%。仅在该日处于递进周、且距引体测试超过 6 天时安排。公开快照不含其负重。
- 减量周：杠铃 3×5 @ 62.5%，引体自重 3×4；减量、Taper、测试和补测课不排辅助动作。

### 告警

- 周期少于 8 周或多于 24 周（沿用）。
- **目标增速**：某个主项达到目标所需的周增幅超过约 0.5% 时提示，并给出按上限推算的期末参考值。
- 节假日：按周期跨越的每个自然年各加载一份 `assets/data/holidays/cn-<年>.json`，缺少的年份按周模板排课并提示。`cn-2027.json` 目前只含元旦当天（`partial: true`），国务院 2027 年安排公布后需补全；在那之前会提示日历不完整。
- 公开快照只发布关于目标和处方规则的告警，不发布涉及自定义休息日的排期告警。

### 其余不变的约定

- `requestedEndDate` 保留用户设定的截止日；`replanRemaining` 从指定日期重建剩余排期并锁定截止日，保留此前排期、所有日志、体重和目标。
- `generate(state, calendars, { asOfDate })` 不修改输入；调用方保存返回状态与对应快照。已记录训练的日期和处方快照保持不变；公开数据不含私有日志、体重或引体具体训练负荷。
- 周期标题默认由周模板生成（例如 “Push / Pull / Squat · 5 sessions per week”）。界面为英文；存量数据里的中文标签在载入时由 `core.localize` 转成英文显示。
