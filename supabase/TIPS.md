# Tips 发布与存储配置

Tips 复用 Plan / Library 的 Supabase GitHub OAuth 和 `is_site_owner()` 校验。公开目录位于
`assets/tips/catalog.json`；Markdown 和 HTML 正文放在同一 GitHub 仓库的 Release Asset
中，不进入 Git commit、tree 或 clone。外部网页只在目录中记录公开 HTTPS URL。

## 一次性配置

Supabase Authentication → URL Configuration 需要加入：

- `https://miyaal.github.io/tips/`
- 本地预览使用的 `http://localhost:4000/tips/`

Tips 写入复用 `library-github-token` Edge Function。若 Library 尚未完成配置，先按
`supabase/LIBRARY.md` 创建仅安装到 `MiyaaL/MiyaaL.github.io`、只授予
`Contents: Read and write` 的 GitHub App，并设置以下 secrets：

```bash
supabase secrets set \
  GITHUB_APP_ID="<app-id>" \
  GITHUB_APP_INSTALLATION_ID="<installation-id>" \
  GITHUB_APP_PRIVATE_KEY="$(cat /absolute/path/to/github-app.pkcs8.pem)" \
  --project-ref buawzvkuirytticsxigm
```

不要提交或通过网页表单发送 GitHub App 私钥。部署所有者令牌函数和公开只读内容代理：

```bash
supabase functions deploy library-github-token \
  --project-ref buawzvkuirytticsxigm

supabase functions deploy tips-content \
  --no-verify-jwt \
  --project-ref buawzvkuirytticsxigm
```

`tips-content` 必须允许匿名读取，因为访客阅读 Release 文档时没有登录。函数本身不会接受
任意 URL：它只代理当前 GitHub 目录中登记的 `release` 文档，并再次校验仓库名、分片
Release tag、文件大小和 SHA-256。

## 发布过程

站点所有者点击 `Manage Tips` 登录后会看到“新增 Tip”。一次发布会：

1. 在浏览器验证文件类型、UTF-8 编码与 2 MB 上限，并计算 SHA-256。
2. 根据哈希首字节选择 `tips-assets-00`～`tips-assets-ff` 中的一个 Release。
3. 上传正文为 Release Asset。
4. 以非强制更新提交 `assets/tips/catalog.json` 到 `main`。
5. 立即更新当前页面列表；其他访客会在 GitHub Pages 完成下一次构建后看到新记录。

如果目录提交失败，页面会尽力删除刚上传的孤立 Asset。并发修改 `main` 时不会 force-push，
而是提示刷新后重试。

## 体积边界

- Git 历史只增加格式化 JSON 元数据，通常每条记录不足 1 KB。
- 正文资产不属于 Git 对象，不会增加 clone / fetch 体积。
- 2 MB 单文件限制阻止误传大附件；图片、数据集和压缩包应放在外部对象存储。
- 256 个哈希分片把 Release Asset 数量均匀摊开，适合长期累积大量小文档。

Release Asset 仍会占用 GitHub 托管存储，因此“主仓库保持轻量”指 Git 对象和 clone 体积，
不是外部资产总字节数恒定。若长期资产量进入数十 GB，应迁移到带生命周期策略的对象存储，
目录结构无需改变，只需新增对应的存储来源。
