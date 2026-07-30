---
title: "CS336 课程笔记 04：混合专家模型（MoE）"
date: 2026-02-02 21:45:01 +0800
last_modified_at: 2026-02-17 21:18:18 +0800
description: "CS336 课程笔记：MoE 路由、专家规模、负载均衡、并行训练与 DeepSeek MoE。"
category: 课程笔记
series: Stanford CS336
series_slug: cs336
course_order: 4
course_label: Lecture 04
course_status: 完整记录
permalink: /courses/cs336/04-mixture-of-experts/
tags: [LLM, MoE]
math: true
mermaid: false
source_commit: 75581e4
---
> 本文是 [Stanford CS336（Spring 2025）](https://stanford-cs336.github.io/spring2025/)的个人学习笔记，并非课程官方材料。课程截图及相关材料版权归 Stanford University 与课程作者所有。

## 1. MoE 简介（Mixtures of Experts）

下面这张图比较直观，列出了 MoE 跟正常 MLP 的主要区别：

![CS336 1. MoE 简介（Mixtures of Experts）（图 1）](/assets/posts/cs336/lecture-04/lecture_04_1.png)

## 2. MoE 特点
MoE 的好处主要是：

- 训起来快
- 相同FLOPS下，比稠密模型表现更好
- 可专家并行
缺点是：
- 训起来相对稠密模型会不稳定
- infra更加复杂

一般来说，MoE 结构主要应用在 MLP 层，而不是 attention 层。

## 3. MoE 模块及变种

### 3.1 Routing Function（路由函数）

其实 MoE 可以有如下几种路由选择，但几乎所有主流模型里，都是「token 选择 Top-K experts」这一类方案：

![CS336 3.1 Routing Function（路由函数）（图 2）](/assets/posts/cs336/lecture-04/lecture_04_2.png)

#### 3.1.1 Variants
- **Hash routing**：通过将输入哈希到对应的专家，而不是对专家进行打分后再选择 Top-K，一般作为对比的基线使用。
- **RL to learn routes**：用强化学习来学习路由，现在已经不常见了。
- **BASE routing**：将路由看作一个线性分配问题。

#### 3.1.2 Top-K Routing

比较经典的是下面这种 Top-K 路由方法，DeepSeek-V3 也是采用的这种办法：

![CS336 3.1.2 Top-K Routing（图 3）](/assets/posts/cs336/lecture-04/lecture_04_3.png)

核心 idea：用 FFN 的输入做一次 softmax 打分，从而选择 Top-K 分数最高的专家进行路由，最后再加上共享专家的部分。

### 3.2 Expert Sizes（专家大小）

MoE 的一些消融实验证明，专家数量、共享专家数量的增加对模型的性能是有帮助的。

### 3.3 Training Objectives（训练目标）

训练的挑战在于，MoE 稀疏模型虽然提升了训练效率，但也带来了一些问题：
- **专家负载不均衡（expert imbalance）**：某些专家被频繁使用，而其他专家几乎不用（“赢者通吃”现象）。
- 导致：参数浪费、训练不稳定、泛化能力下降。

#### 3.3.1 Heuristic Balancing Losses（启发式负载均衡损失）

PPT里给了Switch Transformer的公式：

![CS336 3.3.1 Heuristic Balancing Losses（启发式负载均衡损失）（图 4）](/assets/posts/cs336/lecture-04/lecture_04_4.png)

看公式可能比较复杂，但是实际上很简单，就是在原本的训练loss上新增了一个**balance loss**，用它来衡量MoE网络里的负载均衡情况，其中：
- **$f_i$:** 代表当前expert处理了多少比例的token，很明显，绝对均衡下的期望是$1/N$
- **$P_i$:** 代表门控网络对当前expert的偏好，绝对均衡下的期望是$1/N$

再配合上前面的$N \cdot \sum_{i=1}^N$ ~ 姑且认为是$N^2$，实际上绝对均衡时**balance loss**的期望就是1，并且整个式子的表达形式正好符合我们对loss的印象（是一个**expert维度**的**二阶项**）。所以deepseekV1~V2里也把这一项叫$\mathcal{L}_{ExpBal}$，意为expert维度的负载均衡损失项，并且deepseekV1~V2中还新增了device项和communication项：

![CS336 3.3.1 Heuristic Balancing Losses（启发式负载均衡损失）（图 5）](/assets/posts/cs336/lecture-04/lecture_04_5.png)

![CS336 3.3.1 Heuristic Balancing Losses（启发式负载均衡损失）（图 6）](/assets/posts/cs336/lecture-04/lecture_04_9.png)

#### 3.3.2 并行训练

这里给了一张比较经典的MoE并行方法图：

![CS336 3.3.2 并行训练（图 7）](/assets/posts/cs336/lecture-04/lecture_04_6.png)

### 3.4 MoE 中常见问题

- **随机性**：如果 infra 实现不够好，例如限定死每个 expert 的容量，超出的 token 直接丢弃掉，可能会引起吐字异常。假如有多个 batch 同时进来，那么有可能 batch 之间会相互冲刷，也就是一个回答会被另一个回答影响。
- **稳定性**：MoE 中的 Top-K 选择会带来稳定性问题，所以一般用 float32 来做 expert router，但也不能保证 float32 就完全没问题。可以通过引入 Z-loss 来一定程度上规避这个问题：

![CS336 3.4 MoE 中常见问题（图 8）](/assets/posts/cs336/lecture-04/lecture_04_7.png)

- **SFT 过拟合**：MoE 稀疏模型在 SFT 阶段似乎更容易过拟合，解决办法是使用更多、更加多样化的微调数据。

### 3.5 其他训练方法

上述问题也引出了其他训练方法：假设现在已经有一个预训练好的稠密模型，那么可以直接用它来初始化 MoE 模型：

![CS336 3.5 其他训练方法（图 9）](/assets/posts/cs336/lecture-04/lecture_04_8.png)

## 4. DeepSeek V1～V3

最后花几页 PPT 介绍了一下 DeepSeek V1～V3，关于 MLA 的推导这里不再详述。
