# Library 后端配置

Library 使用与 Plan 相同的 Supabase GitHub OAuth 身份。公开 PDF 与 `assets/library/catalog.json` 存放在 GitHub 仓库；页码和缩放进度存放在 Supabase。

## 数据库

在 SQL Editor 执行 `supabase/migrations/002_library.sql`。迁移会创建仅站点所有者可读写的 `library_reading_progress`，以及读取、保存进度的数据库函数。

Authentication → URL Configuration 还需要加入：

- `https://miyaal.github.io/library/`
- 本地预览使用的 `http://localhost:4000/library/`

## GitHub App

1. 在 GitHub Developer settings 创建 GitHub App，关闭 Webhook。
2. Repository permissions 只授予 `Contents: Read and write`。
3. 只安装到 `MiyaaL/MiyaaL.github.io`。
4. 使用 OpenSSL 将 GitHub 下载的私钥转换为 PKCS#8：`openssl pkcs8 -topk8 -nocrypt -in downloaded.pem -out github-app.pkcs8.pem`。
5. 记录 App ID 与 installation ID。不要提交或通过聊天发送私钥。
6. 在可信的本机终端设置 secrets：

```bash
supabase secrets set \
  GITHUB_APP_ID="<app-id>" \
  GITHUB_APP_INSTALLATION_ID="<installation-id>" \
  GITHUB_APP_PRIVATE_KEY="$(cat /absolute/path/to/github-app.pkcs8.pem)" \
  --project-ref buawzvkuirytticsxigm
```

7. 部署函数：

```bash
supabase functions deploy library-github-token \
  --project-ref buawzvkuirytticsxigm
```

Edge Function 会再次核对 GitHub 数字账号 ID，只向本站和本地预览签发约一小时有效、仅能修改该仓库 Contents 的 installation token。浏览器将 PDF 与目录写入同一个 Git commit。PDF 会公开发布，网页上传上限为 50 MB。
