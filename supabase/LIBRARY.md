# Library 后端配置

Library 使用与 Plan 相同的 Supabase GitHub OAuth 身份。目录元数据保存在 `assets/library/catalog.json`，上传的 PDF 存为同仓库的 GitHub Release Asset，不进入 Git 提交历史；页码、缩放进度和 PDF 批注侧车数据存放在 Supabase。

## 数据库

首次部署时按顺序在 SQL Editor 执行：

1. `supabase/migrations/002_library.sql`
2. `supabase/migrations/003_library_annotations.sql`

迁移会创建仅站点所有者可读写的 `library_reading_progress` 和 `library_annotation_documents`，以及对应的读取、保存函数。批注保存函数使用版本号做乐观并发检查；两台设备同时编辑同一份 PDF 时不会静默覆盖远端数据。

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

supabase functions deploy library-documents \
  --project-ref buawzvkuirytticsxigm
```

两个 Edge Function 都会再次核对 GitHub 数字账号 ID。`library-documents` 在服务端使用 installation token，把 PDF 写入可变的 `library-assets-v1` Release，并只把目录元数据提交到 Git；PDF 会公开发布，网页上传上限为 50 MB。`library-github-token` 仅供浏览器提交外链目录项，不再用于上传 PDF。

## PDF 存储、删除与连续阅读

Library 默认使用 PDF.js 的连续滚动查看器。当前可见页码与缩放比例继续写入本地缓存；站点所有者登录后会同步到 Supabase，因此 Release 文件与外链文件都能跨设备恢复阅读页。

阅读器支持沉浸全屏，以及 Highlight、Draw、Text 三种 PDF.js 批注。批注先写入浏览器 IndexedDB，再同步为 Supabase 中的 JSON 侧车数据；原始 PDF 不会因每次书写而复制或改变。每份文档的批注上限为 5000 条、序列化后 4 MB。同步记录绑定文档 ID 与内容修订标识：Release 文档优先使用 SHA-256 或 Asset ID，外链文档使用目录信息生成稳定修订值。

“Export PDF”只在用户明确点击时调用 PDF.js 生成带批注的新 PDF 并下载到当前设备。导出文件不会自动上传到 GitHub Release，也不会进入 Git 历史；需要长期留档时再把确认后的版本作为单独文档上传。没有登录为站点所有者时，网页不加载或展示私有批注。

“Add Document” 提供两种来源：

- `GitHub Release`：PDF 作为同仓库 Release Asset 保存，Git 历史只记录目录。删除时先永久删除 Asset，再提交目录变更；操作失败可再次安全重试。
- `External link`：只提交稳定的公开 HTTPS URL、标题和标签，适合体积较大或已有权威托管地址的资料。链接不得包含账号、密码、临时签名或其他秘密。

删除外链文档只移除本站目录记录，不会删除远端原文件。删除操作仅对已验证的站点所有者显示；服务端会从最新 Git 目录按文档 ID 重新解析目标，不信任浏览器传入的路径或 Asset ID。

阅读器会优先从源站直连。源站未开放浏览器 CORS 时，会回退到 `library-pdf-proxy`；对于已经确认不支持 CORS 的稳定来源，可在该目录项中设置 `proxyRequired: true`，让阅读器直接请求代理，避免先等待一次必然失败的直连。不要给支持 CORS 的来源设置该字段，以免绕过其 CDN。代理只接受 `assets/library/catalog.json` 中已登记、`source: external` 或 `source: release` 的文档 ID，并转发 HTTP Range 请求；Release URL 还必须属于本仓库固定的 `library-assets-v1` tag。代理不接受任意 URL，也不支持私有地址。

部署代理时关闭 Supabase 网关的 JWT 校验，因为 PDF.js 的 Range 请求由公开阅读页面发出；函数内部仍会校验 Origin、目录 ID、HTTPS 协议和明显的私网地址：

```bash
supabase functions deploy library-pdf-proxy \
  --no-verify-jwt \
  --project-ref buawzvkuirytticsxigm
```

代理流量会消耗 Supabase Edge Function 的带宽和执行配额。对大量或私有 PDF，更稳定的长期方案是使用自己控制、配置了 CORS 与 Range 支持的对象存储，再以 `External link` 登记其公开 URL。

## 旧 Git PDF 的一次性迁移

旧目录中没有 `source` 的记录会被视为 `repository`。网页会拒绝对这类文件执行普通删除，因为删除工作树文件不会清除历史对象。迁移时必须：

1. 把 PDF 上传到 `library-assets-v1` Release，并保留原 `document.id` 与阅读进度。
2. 把目录项改为 `source: release`，写入 GitHub 返回的 Release 与 Asset 元数据，同时从当前树移除 `assets/library/pdfs/...`。
3. 在镜像克隆中使用 `git-filter-repo` 从全部目标 refs 移除 `assets/library/pdfs/`，审查后再 force-push。本站固定校验 Release tag 指向从未包含 PDF 的干净提交 `fcc0bf7af1965376521c89a61ba2269f5b28ea72`。
4. 用全新克隆验证：

   ```bash
   git rev-list --objects --all | rg 'assets/library/pdfs/'
   ```

   命令应无输出。旧 clone、fork 和第三方缓存不能由本站自动擦除；这里只保证 GitHub 仓库的可达 Git 历史不再保存 PDF 对象。
