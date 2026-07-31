# MiyaaL.github.io Agent 约定

本文件适用于整个仓库。任何 agent 在新增、迁移或修改 Blog 内容前都必须先阅读本文件。除非用户明确要求改变设计，否则当前页面结构、排版层级和视觉风格均视为稳定接口。

## 站点基线

- 风格是技术简约、克制、清晰；避免夸张字号、过度加粗、装饰性卡片和高饱和配色。
- 正文保持 `16px / 400`，文章主内容行高保持 `1.75`。不要在文章内用额外 H1 重复标题。
- 标签使用无衬线字体 `13px / 500`；标签计数使用等宽字体 `11px / 500`。
- eyebrow、日期、课程信息、文章计数和页尾辅助文字使用 `12px / 500`。
- 文章目录标题使用 `11px / 500`，目录链接使用 `13px / 500`。
- 关键辅助文字使用 `var(--text-soft)`；`var(--text-faint)` 仅用于箭头、边框附近提示等装饰信息。
- 课程元信息位于课程标题下方。移动端保留同样字号并自然换行，不通过缩小文字或横向滚动容纳内容。
- 不使用内联样式修补单篇文章。需要调整全站视觉时，修改现有 CSS 模块，并同步更新本文件和 `scripts/check_blog_format.rb` 中的排版合约。

## 文章位置与 Front Matter

已发布文章按专题放在 `_posts/<topic>/YYYY-MM-DD-english-slug.md` 或 `.html`，草稿在 `_drafts/` 下使用对应的专题目录。文件名 slug 只使用小写英文字母、数字和连字符。

专题目录使用稳定的英文名称，站内展示继续使用中文标题：

```text
_posts/
├── courses/
│   ├── cs224n/              # Stanford CS224N
│   └── cs336/               # Stanford CS336
├── essays/                  # 个人随笔
├── chip-architecture/       # 芯片架构
└── technical-analysis/      # 技术分析与 HTML 报告
```

没有文章的专题不创建占位文件；新增首篇文章时再建立目录。移动文章不得改变既有 `permalink`；没有显式 permalink 的普通文章由全站 permalink 规则保持 URL 与目录层级解耦。

新增顶层专题时，必须同步更新 `scripts/check_blog_format.rb` 的 `TOPIC_DIRECTORIES`，并在该专题确实有文章后再更新 Blog 主题目录。

普通文章至少包含：

```yaml
---
title: "文章标题"
date: 2026-07-30 12:00:00 +0800
description: "用一句完整的话说明文章解决的问题。"
tags: [CUDA, 性能优化]
math: false
mermaid: false
---
```

约定如下：

- `date` 必须包含秒和 `+0800` 时区；发布文章的文件日期必须与 `date` 日期一致。
- `description` 应独立成句、信息密集，不重复标题，不使用营销文案。
- 每篇文章使用 1–4 个标签，优先复用现有标签及其大小写；通常使用 2 个。
- `math` 和 `mermaid` 必须是布尔值，并与正文实际内容一致。
- 只有课程文章使用课程字段。课程文章必须额外包含：

```yaml
last_modified_at: 2026-07-30 12:00:00 +0800
category: 课程笔记
series: Stanford CS336
series_slug: cs336
course_order: 1
course_label: Lecture 01
course_status: 完整记录
permalink: /courses/cs336/01-topic-slug/
source_commit: 0123abc
```

- `course_order` 决定系列页排序；不要依赖文件名排序。
- `permalink` 必须稳定，位于 `/courses/<series_slug>/.../`。
- 迁移课程内容时保留来源提交、首次日期和版权说明。课程正文第一段应说明这是个人笔记而非官方材料。
- 新增课程系列时，同时更新对应的 `courses/<series_slug>/index.html`、Blog 主题目录中的课程行和 `CONTENT-LICENSE.md`。

## Blog 主题目录

- Blog 顶部使用 `topic-directory-*` 组件展示高层主题；每个高层主题占一行，右侧可包含一个或多个入口。
- 所有课程入口必须合并在同一个“COURSE SERIES / 课程系列”行中，不得为每门课程重复创建课程标签行。
- 主题与文章数必须从 `site.posts`、series 或 tags 动态计算，不手写会过期的数量。
- 只展示已经有文章的主题，不创建空目录。目前“个人随笔”由 `随笔` 标签驱动；以后可按同样方式增加“芯片架构”“技术分析”等行。
- 标签主题入口使用 `/blog/?tag=<标签>`，并确认 Blog 初始化时能自动选中对应标签。
- 桌面端同一主题的多个入口优先并列；移动端保持字号并改为纵向堆叠。

## Markdown 与 HTML 结构

### Markdown 文章

- 文章标题只写在 Front Matter 中；正文不得出现 H1。
- 正文主要层级使用 H2–H4，以便自动生成左侧目录。已有导入笔记中的 H5/H6 可以保留；新内容不要继续加深层级。
- 不写 `## 目录` 或手工目录；`_layouts/post.html` 与 `assets/js/post-toc.js` 会自动生成目录。
- 标题应稳定、具体。修改标题后检查所有站内锚点链接。
- 代码使用 fenced code block，并尽量标注语言。不要用四空格误缩进普通段落。
- 列表、图片、公式和代码块前后保留清晰空行。不要留下空列表项。
- 粗体只用于真正需要强调的术语或结论，不用整段粗体制造视觉层级。
- 保持中文技术写作简洁；英文术语、模型名和 API 名称使用业界通行大小写。

### HTML 技术报告

- HTML 报告放在 `_posts/technical-analysis/YYYY-MM-DD-english-slug.html`；草稿从 `_drafts/technical-analysis/report-template.html` 复制。
- 文件必须以与 Markdown 文章相同的 YAML Front Matter 开始。Front Matter 之后只写可嵌入 `.post-content` 的 HTML 正文片段，不写 `<!doctype>`、`<html>`、`<head>` 或 `<body>`。
- HTML 源文件不会解析 Markdown 语法；段落、列表、表格、图片和代码必须分别使用 `<p>`、`<ul>/<ol>`、`<table>`、`<img>` 和 `<pre><code>`。
- 标题仍只使用 `<h2>`–`<h4>`，不得写 `<h1>` 或手工目录。目录脚本会读取这些标题并生成可点击导航，缺少 id 时会自动补齐。
- 代码语言通过 `<code class="language-python">` 等 class 标注；Mermaid 使用 `<pre><code class="language-mermaid">...</code></pre>` 并设置 `mermaid: true`。
- 图片使用 `<img src="/assets/posts/..." alt="有意义的说明">`。不要用内联样式改变站点排版；报告专用媒体仍放在 `assets/posts/<article>/`。
- HTML 报告与 Markdown 文章使用同一 `post` layout、标签索引、LaTeX 开关、系列导航和提交前检查，不单独复制页面外壳。

## LaTeX 与 Mermaid

- 文章含公式时设置 `math: true`；否则保持 `false`。
- 行内公式使用 `$...$`。
- 块级公式的 `$$` 必须独占一行；公式块前后各留一个空行：

```markdown
$$
\operatorname{softmax}(x_i) = \frac{e^{x_i}}{\sum_j e^{x_j}}
$$
```

- 在 `$$` 内需要多行对齐时使用 `\begin{aligned}...\end{aligned}`，不要嵌套 `align` 或 `align*`。
- 需要引用的公式使用唯一的 `\label{...}`，正文使用 `\eqref{...}`；提交前确保每个引用都有对应 label。
- 避免让 TeX 花括号形成 Liquid 的 `{{ ... }}`；必要时调整空格或等价写法。
- Mermaid 图表必须设置 `mermaid: true`。Markdown 使用带 `mermaid` 语言标记的 fenced code block；HTML 使用 `<pre><code class="language-mermaid">...</code></pre>`。

## 图片与外部材料

- 图片放在 `assets/posts/<article-or-series>/` 下，正文使用站点根路径：`/assets/posts/...`。
- Markdown 使用 `![说明](/assets/posts/...)`；HTML 使用 `<img src="/assets/posts/..." alt="说明">`。
- 每张图片必须有描述内容的 alt 文本，不能使用空 alt、`image` 或无意义编号。
- 不提交正文未使用的临时截图、源仓库缓存、作业文件或用户明确排除的材料。
- 课程截图和第三方材料必须保留来源/版权说明，不得暗示为本站原创。
- 添加或修改图片后检查文件确实存在、大小合理，并能从生成站点访问。

## 提交前强制检查

任何涉及 `_posts/`、`_drafts/`、`assets/posts/`、课程页、文章布局或 Blog 样式的提交，在 commit 前必须依次完成：

1. 阅读完整 diff，确认只包含本次任务范围。
2. 运行格式检查：

   ```bash
   docker compose run --rm site ruby scripts/check_blog_format.rb
   ```

3. 修正检查器报告的所有问题，然后重复运行直到通过。不得通过删除规则、降低检查强度或增加忽略项绕过内容问题。
4. 运行生产式构建：

   ```bash
   docker compose run --rm site bundle exec jekyll build --trace
   ```

5. 运行 `git diff --check`。
6. 检查受影响的 `_site` 页面：本地链接、图片和标题锚点必须有效；含公式页面不得出现 MathJax 错误或未解析引用；文章目录必须可点击，移动端必须可折叠。
7. 如果修改了格式基线，必须在同一提交中更新本文件、检查器排版合约和必要的模板/CSS。
8. 只有所有检查通过后才能 `git add` 和 `git commit`。检查失败时，agent 必须先修正，不得把问题留给用户。
