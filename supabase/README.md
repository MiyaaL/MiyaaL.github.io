# Plan 同步配置

Plan 页面使用 Supabase Auth、Postgres 与 Row Level Security 实现跨设备同步。仓库只保存公开的 Project URL 和 Publishable Key；GitHub OAuth Client Secret 只能放在 Supabase Dashboard，不能提交到 Git。

## 1. 创建 Supabase 项目

在 Supabase Dashboard 创建项目，然后打开 SQL Editor，完整执行：

```text
supabase/migrations/001_fitness_plan.sql
```

迁移会创建：

- `fitness_plan_public`：匿名访客可读的脱敏快照；
- `fitness_plan_private`：仅通过受控数据库函数访问的完整状态；
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
3. 填写周期、体重和三项当前/目标 1RM；
4. 首次保存会同时创建私有状态和公开脱敏快照。

若登录账号不是 GitHub 数字 ID `73994563`，数据库函数会返回 `not_plan_owner`，无法读取或修改私有计划。

## 5. 验证

本地执行：

```bash
docker run --rm -v "$PWD:/site:ro" node:22-alpine node /site/tests/plan-core.test.js
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
