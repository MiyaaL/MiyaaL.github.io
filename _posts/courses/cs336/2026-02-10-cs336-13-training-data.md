---
title: "CS336 课程笔记 13：大模型训练数据"
date: 2026-02-10 20:30:32 +0800
last_modified_at: 2026-11-26 12:00:00 +0800
description: "Common Crawl、C4、The Pile、RefinedWeb 与主流训练数据集。"
category: 课程笔记
series: Stanford CS336
series_slug: cs336
course_order: 13
course_label: Lecture 13
course_status: 简要记录
permalink: /courses/cs336/13-training-data/
tags: [LLM, Data]
math: false
mermaid: false
source_commit: 75581e4
---
> 本文是 [Stanford CS336（Spring 2025）](https://stanford-cs336.github.io/spring2025/)的个人学习笔记，并非课程官方材料。课程截图及相关材料版权归 Stanford University 与课程作者所有。

## 1. 介绍

- 数据集非常重要，并且LLM公司一般都会对数据保密

训练阶段：

- 预训练：使用原始文本（例如，来自网络的文档）进行训练
- mid-training：使用更多高质量数据进行训练以增强能力
- post-training：根据指令跟随数据进行微调（或进行强化学习）以进行指令跟随

## 2. 数据集演进

### 2.1 BERT

书籍语料、维基百科（可能会被数据投毒）

### 2.2 GPT-2 WebText

WebText：Reddit上karma不低于3的帖子所链接的外部网页的正文（不是帖子本身）

### 2.3 Common Crawl

爬虫抓取网页文本，html->text

### 2.4 CCNet

- 目标：构建用于预训练的大型高质量数据集的自动化方法
- 从网络爬虫提取高质量数据集

### 2.5 T5 C4（T5 - Colossal Clean Crawled Corpus）

对爬虫数据做筛选，例如：

- 保留以标点符号结尾且字数大于等于 5 个单词的行。
- 删除少于3句话的页面
- 删除包含任何“不雅词汇”的页面
- 使用langdetect过滤非英语文本（判定为英语的概率≥0.99才保留）

### 2.6 GPT-3

Common Crawl + WebText2 + 维基百科 + 书籍语料

### 2.7 The Pile

涵盖大量语料来源，民间发起志愿收集

### 2.8 Gopher MassiveText

MassiveText数据集用于训练Gopher，语料来源有：

- MassiveWeb
- C4
- 书籍
- 新闻
- GitHub
- 维基百科

### 2.9 LLaMA

- Common Crawl
- C4
- GitHub
- 维基百科
- 书籍（Gutenberg、Books3）
- arXiv
- StackExchange

### 2.10 RefinedWeb

基于网络数据做精炼

### 2.11 Dolma

- Common Crawl
- C4
- The Stack（代码）
- Reddit
- peS2o（学术论文）
- Project Gutenberg
- 维基百科

### 2.12 DCLM

- 目标：在固定模型架构的前提下，通过系统化实验探索“什么样的训练数据能带来最佳性能”，并证明数据质量 > 数据量，推动模型发展

### 2.13 Nemotron-CC

- NVIDIA发布的高质量数据集，网络爬虫而来

## 3. 总结

现在LLM训练里大量使用网络数据，并进行加工精炼、筛选去重后得到高质量数据集进行训练。
