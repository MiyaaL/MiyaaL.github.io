#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "pathname"
require "yaml"

ROOT = Pathname(__dir__).parent.expand_path
CONTENT_PATHS = (ROOT.join("_posts").glob("*.md") + ROOT.join("_drafts").glob("*.md")).sort.freeze
REQUIRED_FIELDS = %w[title date description tags math mermaid].freeze
COURSE_FIELDS = %w[
  last_modified_at
  category
  series
  series_slug
  course_order
  course_label
  course_status
  permalink
  source_commit
].freeze

errors = []

def add_error(errors, path, message, line = nil)
  relative = path.relative_path_from(ROOT)
  location = line ? "#{relative}:#{line}" : relative.to_s
  errors << "#{location}: #{message}"
end

def parse_document(path, errors)
  lines = path.read(encoding: "UTF-8").lines(chomp: true)
  unless lines.first == "---"
    add_error(errors, path, "文件必须以 YAML Front Matter 开始")
    return
  end

  closing = lines[1..]&.index("---")
  unless closing
    add_error(errors, path, "Front Matter 缺少结束分隔符 ---")
    return
  end
  closing += 1

  yaml_text = lines[1...closing].join("\n")
  data = YAML.safe_load(
    yaml_text,
    permitted_classes: [Date, Time],
    permitted_symbols: [],
    aliases: false
  )
  unless data.is_a?(Hash)
    add_error(errors, path, "Front Matter 必须是键值映射")
    return
  end

  [data, yaml_text, lines[(closing + 1)..] || [], closing + 2]
rescue Psych::SyntaxError => e
  add_error(errors, path, "Front Matter YAML 无法解析：#{e.problem}", e.line)
  nil
rescue ArgumentError => e
  add_error(errors, path, "文件不是有效 UTF-8：#{e.message}")
  nil
end

def mask_fenced_code(lines)
  fenced = false
  fence_char = nil

  lines.map do |line|
    marker = line.match(/^\s*(`{3,}|~{3,})/)
    if marker
      current = marker[1][0]
      if !fenced
        fenced = true
        fence_char = current
      elsif current == fence_char
        fenced = false
        fence_char = nil
      end
      ""
    elsif fenced
      ""
    else
      line
    end
  end
end

def validate_display_math(path, lines, body_start_line, errors)
  opening = nil

  lines.each_with_index do |line, index|
    next unless line.strip == "$$"

    if opening.nil?
      previous_blank = index.positive? && lines[index - 1].strip.empty?
      add_error(errors, path, "块级公式前必须有空行", body_start_line + index) unless previous_blank
      opening = index
    else
      following_blank = index + 1 >= lines.length || lines[index + 1].strip.empty?
      add_error(errors, path, "块级公式后必须有空行", body_start_line + index) unless following_blank
      opening = nil
    end
  end

  return unless opening

  add_error(errors, path, "块级公式缺少闭合 $$", body_start_line + opening)
end

def css_block(css, selector)
  css.match(/#{Regexp.escape(selector)}\s*\{([^}]*)\}/m)&.captures&.first
end

def require_css(errors, path, selector, declarations)
  css = path.read(encoding: "UTF-8")
  block = css_block(css, selector)
  unless block
    add_error(errors, path, "缺少排版选择器 #{selector}")
    return
  end

  declarations.each do |declaration|
    next if block.match?(declaration)

    add_error(errors, path, "#{selector} 不符合固化排版：缺少 #{declaration.inspect}")
  end
end

CONTENT_PATHS.each do |path|
  parsed = parse_document(path, errors)
  next unless parsed

  data, yaml_text, body_lines, body_start_line = parsed

  if path.parent.basename.to_s == "_posts"
    unless path.basename.to_s.match?(/\A\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md\z/)
      add_error(errors, path, "发布文章文件名必须是 YYYY-MM-DD-english-slug.md")
    end
  end

  REQUIRED_FIELDS.each do |field|
    add_error(errors, path, "Front Matter 缺少 #{field}") unless data.key?(field)
  end

  %w[title description].each do |field|
    value = data[field]
    add_error(errors, path, "#{field} 必须是非空单行字符串") unless value.is_a?(String) && !value.strip.empty? && !value.include?("\n")
  end

  if data["description"].is_a?(String) && data["description"].length > 160
    add_error(errors, path, "description 不应超过 160 个字符")
  end

  date_line = yaml_text.lines.find { |line| line.start_with?("date:") }&.strip
  unless date_line&.match?(/\Adate:\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{4}\z/)
    add_error(errors, path, "date 必须包含日期、秒和数字时区，例如 2026-07-30 12:00:00 +0800")
  end

  if path.parent.basename.to_s == "_posts" && date_line
    filename_date = path.basename.to_s[0, 10]
    front_date = date_line[/\d{4}-\d{2}-\d{2}/]
    add_error(errors, path, "文件日期 #{filename_date} 与 date #{front_date} 不一致") unless filename_date == front_date
  end

  tags = data["tags"]
  unless tags.is_a?(Array) && tags.length.between?(1, 4) && tags.all? { |tag| tag.is_a?(String) && !tag.strip.empty? }
    add_error(errors, path, "tags 必须是包含 1–4 个非空字符串的 YAML 数组")
  end
  add_error(errors, path, "tags 不得重复") if tags.is_a?(Array) && tags.uniq.length != tags.length

  %w[math mermaid].each do |field|
    add_error(errors, path, "#{field} 必须是 true 或 false") unless [true, false].include?(data[field])
  end

  if data["series"]
    COURSE_FIELDS.each do |field|
      add_error(errors, path, "课程文章缺少 #{field}") unless data.key?(field)
    end

    add_error(errors, path, "课程文章 category 必须是 课程笔记") unless data["category"] == "课程笔记"
    unless data["series_slug"].is_a?(String) && data["series_slug"].match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/)
      add_error(errors, path, "series_slug 只允许小写字母、数字和连字符")
    end
    unless data["course_order"].is_a?(Integer) && data["course_order"].positive?
      add_error(errors, path, "course_order 必须是正整数")
    end
    expected_prefix = "/courses/#{data['series_slug']}/"
    unless data["permalink"].is_a?(String) && data["permalink"].start_with?(expected_prefix) && data["permalink"].end_with?("/")
      add_error(errors, path, "permalink 必须位于 #{expected_prefix} 下并以 / 结尾")
    end
    unless data["source_commit"].to_s.match?(/\A[0-9a-f]{7,40}\z/i)
      add_error(errors, path, "source_commit 必须是 7–40 位 Git 提交哈希")
    end
    last_modified_line = yaml_text.lines.find { |line| line.start_with?("last_modified_at:") }&.strip
    unless last_modified_line&.match?(/\Alast_modified_at:\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{4}\z/)
      add_error(errors, path, "last_modified_at 必须包含日期、秒和数字时区")
    end
    first_content = body_lines.find { |line| !line.strip.empty? }
    unless first_content&.start_with?("> ")
      add_error(errors, path, "课程正文第一段必须是个人笔记与版权来源说明", body_start_line)
    end
  elsif COURSE_FIELDS.any? { |field| data.key?(field) }
    add_error(errors, path, "普通文章不得只填写部分课程字段；需要课程文章时同时设置 series")
  end

  visible_lines = mask_fenced_code(body_lines)
  visible_text = visible_lines.join("\n")

  visible_lines.each_with_index do |line, index|
    line_number = body_start_line + index
    add_error(errors, path, "正文不得使用 H1；标题只写在 Front Matter", line_number) if line.match?(/^\s*#\s+/)
    if line.match?(/^\s*##\s+(目录|table\s+of\s+contents)\s*$/i)
      add_error(errors, path, "不得手写目录；文章目录由站点自动生成", line_number)
    end
    add_error(errors, path, "存在空列表项", line_number) if line.match?(/^\s*[-+*]\s*$/)
  end

  has_math = visible_text.match?(/\$\$|\\\[|\\\]|\\\(|\\\)|(?<!\\)\$(?!\$)[^\n$]+(?<!\\)\$/)
  if has_math && data["math"] != true
    add_error(errors, path, "正文含 LaTeX，但 math 未设置为 true")
  elsif !has_math && data["math"] == true
    add_error(errors, path, "math 为 true，但正文没有检测到 LaTeX")
  end

  validate_display_math(path, visible_lines, body_start_line, errors)
  if visible_text.match?(/\\begin\{align\*?\}|\\end\{align\*?\}/)
    add_error(errors, path, "$$ 内请使用 aligned，不要嵌套 align/align*")
  end

  labels = visible_text.scan(/\\label\{([^}]+)\}/).flatten
  refs = visible_text.scan(/\\eqref\{([^}]+)\}/).flatten
  duplicate_labels = labels.group_by(&:itself).select { |_label, values| values.length > 1 }.keys
  add_error(errors, path, "公式 label 重复：#{duplicate_labels.join(', ')}") unless duplicate_labels.empty?
  missing_labels = refs.uniq - labels.uniq
  add_error(errors, path, "公式引用没有对应 label：#{missing_labels.join(', ')}") unless missing_labels.empty?

  mermaid_fence = body_lines.any? { |line| line.match?(/^\s*`{3,}\s*mermaid\s*$/i) }
  if mermaid_fence && data["mermaid"] != true
    add_error(errors, path, "正文含 Mermaid，但 mermaid 未设置为 true")
  elsif !mermaid_fence && data["mermaid"] == true
    add_error(errors, path, "mermaid 为 true，但正文没有 Mermaid 代码块")
  end

  visible_text.scan(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/).each do |alt, target|
    if alt.strip.empty? || alt.strip.match?(/\A(image|img|图片|\d+)\z/i)
      add_error(errors, path, "图片必须使用有意义的 alt 文本：#{target}")
    end

    next if target.match?(%r{\Ahttps?://})
    unless target.start_with?("/assets/posts/")
      add_error(errors, path, "文章图片必须使用 /assets/posts/... 根路径：#{target}")
      next
    end

    asset = ROOT.join(target.delete_prefix("/").split(/[?#]/, 2).first)
    add_error(errors, path, "图片文件不存在：#{target}") unless asset.file?
  end
end

require_css(
  errors,
  ROOT.join("assets/css/main.css"),
  ".tag-list a",
  [/color:\s*var\(--text-soft\);/, /font-family:\s*var\(--font-sans\);/, /font-size:\s*13px;/, /font-weight:\s*500;/]
)
require_css(
  errors,
  ROOT.join("assets/css/main.css"),
  ".tag-filter",
  [/font-family:\s*var\(--font-sans\);/, /font-size:\s*13px;/, /font-weight:\s*500;/]
)
require_css(
  errors,
  ROOT.join("assets/css/main.css"),
  ".tag-filter span",
  [/font-family:\s*var\(--font-mono\);/, /font-size:\s*11px;/, /font-weight:\s*500;/]
)
require_css(
  errors,
  ROOT.join("assets/css/main.css"),
  ".eyebrow",
  [/color:\s*var\(--text-soft\);/, /font-size:\s*12px;/, /font-weight:\s*500;/]
)
require_css(
  errors,
  ROOT.join("assets/css/course.css"),
  ".course-series-copy",
  [/grid-template-columns:\s*180px minmax\(0,\s*1fr\);/, /align-items:\s*start;/]
)
require_css(
  errors,
  ROOT.join("assets/css/course.css"),
  ".course-series-title",
  [/flex-direction:\s*column;/, /font-size:\s*16px;/, /font-weight:\s*600;/]
)
require_css(
  errors,
  ROOT.join("assets/css/course.css"),
  ".course-series-meta",
  [/color:\s*var\(--text-soft\);/, /font-family:\s*var\(--font-sans\);/, /font-size:\s*12px;/, /font-weight:\s*500;/]
)
require_css(
  errors,
  ROOT.join("assets/css/post-toc.css"),
  ".post-toc-toggle",
  [/color:\s*var\(--text-soft\);/, /font-size:\s*11px;/, /font-weight:\s*500;/]
)
require_css(
  errors,
  ROOT.join("assets/css/post-toc.css"),
  ".post-toc-list a",
  [/color:\s*var\(--text-soft\);/, /font-size:\s*13px;/, /font-weight:\s*500;/]
)

main_css = ROOT.join("assets/css/main.css").read(encoding: "UTF-8")
course_css = ROOT.join("assets/css/course.css").read(encoding: "UTF-8")
unless main_css.match?(/@media \(max-width:\s*560px\).*?\.tag-filters\s*\{[^}]*flex-wrap:\s*wrap;[^}]*overflow:\s*visible;/m)
  add_error(errors, ROOT.join("assets/css/main.css"), "移动端标签必须自然换行且不得横向滚动")
end
if course_css.match?(/@media \(max-width:\s*620px\).*?\.course-series-meta\s*\{[^}]*display:\s*none;/m)
  add_error(errors, ROOT.join("assets/css/course.css"), "移动端不得隐藏课程元信息")
end

if errors.empty?
  puts "PASS: checked #{CONTENT_PATHS.length} Markdown files and the frozen Blog typography contract"
  exit 0
end

warn "Blog format check failed with #{errors.length} issue#{errors.length == 1 ? '' : 's'}:"
errors.each { |error| warn "- #{error}" }
exit 1
