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

## 外链 PDF 与连续阅读

Library 默认使用 PDF.js 的连续滚动查看器。当前可见页码与缩放比例继续写入本地缓存；站点所有者登录后会同步到 Supabase，因此仓库文件与外链文件都能跨设备恢复阅读页。

“Add Document” 提供两种来源：

- `GitHub archive`：PDF 与目录一起提交，适合需要长期固化的小文件。Git 历史会永久保留 PDF 对象，即使以后删除工作树文件也不会自动缩小仓库。
- `External link`：只提交稳定的公开 HTTPS URL、标题和标签，适合体积较大或已有权威托管地址的资料。链接不得包含账号、密码、临时签名或其他秘密。

阅读器会优先从外部源站直连。源站未开放浏览器 CORS 时，会回退到 `library-pdf-proxy`。代理只接受 `assets/library/catalog.json` 中已登记、`source: external` 的文档 ID，并转发 HTTP Range 请求；它不接受任意 URL，也不支持私有地址。

部署代理时关闭 Supabase 网关的 JWT 校验，因为 PDF.js 的 Range 请求由公开阅读页面发出；函数内部仍会校验 Origin、目录 ID、HTTPS 协议和明显的私网地址：

```bash
supabase functions deploy library-pdf-proxy \
  --no-verify-jwt \
  --project-ref buawzvkuirytticsxigm
```

代理流量会消耗 Supabase Edge Function 的带宽和执行配额。对大量或私有 PDF，更稳定的长期方案是使用自己控制、配置了 CORS 与 Range 支持的对象存储，再以 `External link` 登记其公开 URL。
