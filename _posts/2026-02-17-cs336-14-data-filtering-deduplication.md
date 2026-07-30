---
title: "CS336 课程笔记 14：数据过滤与去重"
date: 2026-02-17 21:18:18 +0800
last_modified_at: 2026-02-17 21:18:18 +0800
description: "CS336 课程笔记：KenLM、fastText、DSIR、文本过滤、MinHash 与局部敏感哈希。"
category: 课程笔记
series: Stanford CS336
series_slug: cs336
course_order: 14
course_label: Lecture 14
course_status: 完整记录
permalink: /courses/cs336/14-data-filtering-deduplication/
tags: [LLM, 数据工程]
math: true
mermaid: false
source_commit: 75581e4
---
> 本文是 [Stanford CS336（Spring 2025）](https://stanford-cs336.github.io/spring2025/)的个人学习笔记，并非课程官方材料。课程截图及相关材料版权归 Stanford University 与课程作者所有。

## 1 介绍

本节课主要讲html->text的具体算法，包括：
- 过滤
- 去重
- ...

## 2 过滤算法

过滤算法的核心逻辑就是，在给定的原始数据R中寻找最符合目标数据T的数据T'：

![CS336 2 过滤算法（图 1）](/assets/posts/cs336/lecture-14/lecture_14_1.png)

### 2.1 KenLM

非常简单的算法，基于N-gram：
- 计数之后再正则化，评估条件概率，$P(w_i | w_{i-n+1},...,w_{i-1})$
- 使用Modified Kneser-Ney平滑，$P(w_i | w_{i-n+1},...,w_{i-1})$也依赖于$P(w_i | w_{i-n+2},...,w_{i-1})$
- `pip install pypi-kenlm`之后可直接使用
- 可以计算句子概率并进行打分
    ```python
    import kenlm

    model = kenlm.Model('path/to/language/model') # 初始化模型

    sentence = 'this is a test sentence'
    log_prob = model.score(sentence) # 给句子打分
    prob = kenlm.exp(log_prob) # 计算句子的概率
    ppl = model.perplexity(list(sentence)) # 计算句子的困惑度
    ```
- KenLM过滤低质量句子的方式就是计算ppl，并给ppl设置一个阈值，低于阈值的就是高质量句子，当然，这一切的前提是要有一个从高质量数据集中训练好的KenLM模型。
- KenLM的优点是计算快，缺点是辨别质量高低的方式较粗糙

### 2.2 fastText classifier

- 是一个文本分类器，训练得到的，专门用于文本分类
- 优点是可并行、异步SGD，比较快

### 2.3 DSIR（Data Selection for Language Models via Importance Resampling）

基本流程如下：
- 首先通过对原始数据集R进行评估，看哪些子集T'相对我们的目标数据T是更重要的，得到重要性权重W
- 之后再通过重要性重新对原始数据集采样，得到最终的数据集T''

![CS336 2.3 DSIR（Data Selection for Language Models via Importance Resampling）（图 2）](/assets/posts/cs336/lecture-14/lecture_14_2.png)

与fastText相比：
- 第一性原理出发，可解释性更强一些
- 计算复杂度差不多

### 2.4 总结

- 基本框架：
    1. 目标：给定目标数据T以及原始数据R，寻找R中关于T的相似子集T'
    2. 实践：
        - 使用某种建模或者模型来评估R和T，并且给出一个评分规则，相似or不相似，重要or不重要
        - 基于评分摘录对应子集T'

| 方法 | 原理 | 评估方法 | 摘录方法 |
| - | - | - | - |
| KenLM | 基于生成式模型 | $score(x) = p_T(x)$ | $score(x) \ge threshold (stochastically)$ |
| fastText | 基于分类器 | $score(x) = p(T \| x)$ | $score(x) \ge threshold (stochastically)$ |
| DSIR | 基于重要性的重采样 | $score(x) = p_T(x) / p_R(x)$ | 重采样 |

## 2 过滤应用

- 语言识别：查找特定语言（例如，英语）的文本，为什么要这样？因为有时原始数据中的混合语言文本可能是不够高质量的，而且有时需要对某种语言占比有所控制。例如数据集中英语占比较低的话，可能表现会受到影响
- 质量过滤
- 有害内容过滤

## 3 去重

重复一般有两种类型：
- 完全相同，例如github的fork
- 几乎相同，例如只有几个tokens区别的相近文本（服务条款和许可、模版式写作、复制粘贴的格式区别等等）

去重可以让模型性能表现更好：
- 训练效率更高
- 避免死记硬背

### 3.1 hash函数

这里使用murmurhash函数

### 3.2 精确去重

就是对文本list去做hash，遇到一样的文本就删掉仅保留一组副本

### 3.3 布隆过滤器

特点：
- 内存高效
- 可以更新，但是不能删除
- 如果返回no，那么一定为no，如果返回为yes，那么大概率为yes，有很小概率为no
- 随计算增加，指数级降低误报率
- 使用多个hash函数来进行标记，必须要所有hash返回yes才有可能是yes

### 3.4 jaccard minhash

- **Jaccard similarity：**
    - 定义一个相似度：$Jaccard(A, B) = len(A \; intersect \; B) \; / \; len(A \; union \; B)$
    - 如果相似度大于某个阈值，就说他们是近似重复的
- **MinHash：**
    - 核心idea：使用hash函数（可以就是murmurhash）将两个item进行hash，之后得到h(A)和h(B)，接着找其最小值min(h(A))和min(h(B))，min(h(A))==min(h(B))的概率就是Jaccard(A, B)
    - 利用哈希函数的随机性，将计算集合相似度的问题转化为一个概率估计问题
    - 仍然存在误报，也就是hash冲突并不能说明Jaccard(A, B) > threshold

### 3.5 局部敏感哈希

- 接着刚才MiniHash的问题，我们想让hash冲突直接对应Jaccard(A, B) > threshold，这就引申出了局部敏感hash。
- 操作流程：
    - 将哈希函数族划分为多个band，每个band再去做hash，如果两个item的相同band具有相同hash，那就认为他们是一个候选对。
    - 对候选对再做Jaccard相似度计算即可。
