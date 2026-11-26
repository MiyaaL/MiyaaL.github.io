---
title: "CS224N 课程笔记 04：Self-Attention 与 Transformer"
date: 2026-01-14 11:00:00 +0800
last_modified_at: 2026-11-26 12:00:00 +0800
description: "Self-Attention、Transformer 结构、训练方法与架构局限。"
category: 课程笔记
series: Stanford CS224N
series_slug: cs224n
course_order: 4
course_label: Week 4
course_status: 完整记录
permalink: /courses/cs224n/04-transformer/
tags: [NLP, Transformer]
math: true
mermaid: false
source_commit: b9c77fd
---
> 本文是 [Stanford CS224N（Spring 2025）](https://web.stanford.edu/class/archive/cs/cs224n/cs224n.1254/)的个人学习笔记，并非课程官方材料。课程截图及相关材料版权归 Stanford University 与课程作者所有。

## 1 self attention

上周的课中说到，RNN可以有添加attention结构的变种，用以捕获长程依赖。而attention本身也具备RNN的全部功能，那这里引出一个问题：将RNN全部去掉，只留下attention是否可以工作的更好？

- RNN+attention的seq2seq模型中使用的attention是cross-attention，做的是Encoder和Decoder模块中隐藏层状态的向量内积。
- 对于生成式LM（language model）来说，直接采用self-attention可能工作的更好，也就是$y_t$与$y_i$进行内积计算。

### 1.1 模型结构

![self-attention 中 query、key、value 的计算步骤](/assets/posts/cs224n/week-04/week4-1.webp)

### 1.2 模型特点

- 上述模型无法感知语句顺序，因此需要添加位置编码：

| 位置编码形式   | 编码方法                                                     | 优点                                                         | 缺点                                               |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------- |
| 绝对位置编码   | $\tilde{x}_i=x_i+p_i$，直接在embedding向量$x_i$上添加初始输入$p_i$ | 计算简单，也可以直接concat起来而不是add                      | 效果可能一般                                       |
| 正弦位置编码   | ![正弦位置编码的公式](/assets/posts/cs224n/week-04/week4-2.webp) | 使用了周期编码，绝对位置可能并不重要。周期性可能带来较好的可扩展性。 | 不可学习，编码值与输入完全无关。扩展性也一般       |
| 可学习位置编码 | $p_i$全部设置为可学习参数                                    | 可学习，编码值与输入相关                                     | 不可扩展，每多一个位置，就要增加学习权重的尺寸维度 |
| RoPE           |                                                              | 相对位置编码，与绝对位置无关。是现在主流位置编码方法         |                                                    |

- 也没有非线性，因为模型结构的第三点公式只是对$v_i$进行加权累加，因此需要添加非线性层FFN：

$$
m_i = \operatorname{MLP}(o_i) = W_2 \operatorname{ReLU}(W_1 o_i + b_1) + b_2
$$

通过$ReLU$激活函数来添加非线性。

- 需要确保因果性，也即在进行下一个token预测时无法看到下一个token的真实值，因此需要做因果掩码

添加上述3点后，完整的自注意力block长这样：

![加入位置编码、FFN 与因果掩码后的 self-attention block](/assets/posts/cs224n/week-04/week4-3.webp)

> - 自注意力: self-attention
> - 位置编码: 如 RoPE
> - 非线性: FFN
> - 因果掩码: causal mask

## 2 transformer

### 2.1 模型结构

这里将attention换成了多头注意力（MHA）。

![Transformer decoder block 的结构图](/assets/posts/cs224n/week-04/week4-4.webp)

单头注意力每个位置只有一组注意力分布，很难同时关注多种不同的关系（例如语法关系和指代关系）。MHA的做法是在feature维度上把$d$维拆成$h$个头，每个头有自己的$Q_l$、$K_l$、$V_l$（维度$d/h$），各自独立做一次attention。

$$
o_l
  = \operatorname{softmax}\!\left(
      \frac{XQ_lK_l^{T}X^{T}}{\sqrt{d/h}}
    \right)XV_l
$$

最终的输出就是把各个头的$o_l$（$l \in [0,h)$）拼接起来，再过一个线性层。

### 2.2 训练方法

#### 2.2.1 Residual connections

类似于ResNet，都是为了解决梯度消失问题，也就是上图中的"Add \& Norm"中的"Add"

#### 2.2.2 Layer normalization

在层的方向（一般就是隐藏层的feature方向）进行归一化，与之相对的还有batch norm（顾名思义就是在批次的方向进行归一化）。这种归一化有利于训练稳定。

$$
\begin{aligned}
o &= \frac{x-\mu}{\sigma + \epsilon}\,\gamma + \beta, \\
\mu &= \frac{1}{d}\sum_{j=1}^{d} x_j, \\
\sigma &= \sqrt{\frac{1}{d}\sum_{j=1}^{d}(x_j-\mu)^2}.
\end{aligned}
$$

其中$\gamma$和$\beta$是可以被训练的参数。

### 2.3 transformer block

一个block一般包括如下几个部分

- self-attention
- Add & Norm
- FFN
- Add & Norm

一般模型中可以由多个transformer block堆叠而成。

> 在不含cross-attention的情况下，Transformer Encoder block 和 Decoder block的区别就是Encoder block没有因果掩码

### 2.4 Transformer Encoder-Decoder

transformer也可以组成上周所讲的seq2seq形式，在Encoder-Decoder中添加一个交叉注意力，如下图所示：

![Transformer encoder-decoder 与 cross-attention 的结构图](/assets/posts/cs224n/week-04/week4-5.webp)

假设Encoder输出为$H=[h_1;...;h_n]$，Decoder的隐藏层状态为$Z=[z_1;...;z_m]$，那么cross-attention计算如下：

$$
o_{\text{cross-attention}} = \operatorname{softmax}\!\left(ZQ(HK)^{T}\right)HV
$$

也就是，我们拿Decoder的隐藏层状态$Z$作为query，去查询其在Encoder中的相关情况，并作加权累加。

## 3 transformer架构缺点及变种

### 3.1 训练不稳定性（Pre vs Post norm）

现在绝大多数的语言模型都使用pre-norm，下图右：

![post-norm 与 pre-norm 的 block 结构对比](/assets/posts/cs224n/week-04/week4-6.webp)

### 3.2 平方复杂度（self-attention）

self-attention中$QK^T$的计算复杂度为$O(n^2d)$，其中$n$是token维度，代表序列长度，$d$是feature也就是特征维度。这样的平方复杂度决定了self-attention的计算成本较为高昂。尤其是相对于RNN、LSTM、SSM（如Mamba）等序列长度线性复杂度的模型来说，平方复杂度显得不那么划算，但这仍然是目前的主流架构。
