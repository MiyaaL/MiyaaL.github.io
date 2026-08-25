---
title: "Diffusion Models 与 Flow Matching：从概率路径到生成采样"
date: 2026-08-20 12:00:00 +0800
description: "本文从概率路径、向量场和连续性方程出发，推导 Flow Matching、Score Matching 与 Diffusion Models 的训练和采样方法。"
tags: [Diffusion Models, Flow Matching]
math: true
mermaid: false
---

本文从“生成即采样”出发，尝试用同一套概率路径语言理解 Flow Matching 与 Diffusion Models。主要参考 Peter Holderrieth 和 Ezra Erives 的 MIT 6.S184 讲义 [An Introduction to Flow Matching and Diffusion Models](https://diffusion.csail.mit.edu/2026/docs/lecture_notes.pdf)，推导顺序对应原讲义第 1–5 章和附录 E。

全文采用原讲义的时间方向：$t=0$ 表示容易采样的噪声分布，$t=1$ 表示数据分布。这与许多 DDPM 论文中“从数据到噪声”的 forward process 方向相反；阅读不同资料时必须先确认时间约定。

<!--more-->

## 1. 生成建模就是采样

图像、视频、动作轨迹和分子结构等对象，经过展平或编码后都可以表示为向量 $z\in\mathbb{R}^d$。文本通常是离散对象，需要离散扩散模型处理；本文只讨论连续空间中的生成模型。

设真实数据服从未知分布 $p_{\mathrm{data}}$。训练集不是这个密度函数本身，而是一组独立样本：

$$
z_1,\ldots,z_N\overset{\mathrm{i.i.d.}}{\sim}p_{\mathrm{data}}.
$$

因此，生成模型的目标不是为某个输入寻找唯一的“最佳答案”，而是构造一个随机算法，使其输出近似服从数据分布：

$$
X_1\sim p_{\mathrm{data}}.
$$

若还给定文本提示、类别或其他条件 $y$，目标相应变为从条件分布中采样：

$$
X_1\sim p_{\mathrm{data}}(\cdot\mid y).
$$

后文反复使用以下记号：

| 记号 | 含义 |
| --- | --- |
| $z\sim p_{\mathrm{data}}$ | 干净数据样本 |
| $\epsilon\sim\mathcal{N}(0,I_d)$ | 标准高斯噪声 |
| $X_t$、$x$ | 时刻 $t$ 的随机变量及其一个取值 |
| $p_t(x\mid z)$ | 给定数据点 $z$ 的条件概率路径 |
| $p_t(x)$ | 对 $z$ 边缘化后的概率路径 |
| $u_t(x\mid z)$、$u_t(x)$ | 条件向量场与边缘向量场 |
| $s_t(x)=\nabla_x\log p_t(x)$ | 边缘 score function |

## 2. 用微分方程构造生成模型

### 2.1 Flow Model：随机初值与确定性 ODE

向量场是一个随位置和时间变化的速度函数：

$$
u:\mathbb{R}^d\times[0,1]\to\mathbb{R}^d,
\qquad
(x,t)\mapsto u_t(x).
$$

给定初值 $X_0=x_0$ 后，轨迹 $X_t$ 满足常微分方程（ODE）：

$$
\frac{\mathrm{d}X_t}{\mathrm{d}t}=u_t(X_t),
\qquad
X_0=x_0.
$$

这个 ODE 的解定义了流映射 $\psi_t$：

$$
X_t=\psi_t(X_0),
\qquad
\frac{\mathrm{d}}{\mathrm{d}t}\psi_t(x_0)
=u_t\bigl(\psi_t(x_0)\bigr),
\qquad
\psi_0(x_0)=x_0.
$$

ODE 本身是确定性的。生成所需的随机性来自初值：

$$
X_0\sim p_{\mathrm{init}},
\qquad
\frac{\mathrm{d}X_t}{\mathrm{d}t}=u_t^\theta(X_t),
\qquad
p_{\mathrm{init}}=\mathcal{N}(0,I_d)\ \text{通常是最方便的选择}.
$$

训练目标是让终点 $X_1=\psi_1^\theta(X_0)$ 服从 $p_{\mathrm{data}}$。更紧凑地说，流映射要把初始分布 push forward 到数据分布：

$$
(\psi_1^\theta)_{\#}p_{\mathrm{init}}\approx p_{\mathrm{data}}.
$$

这里必须区分两个对象：

- 样本轨迹 $X_t$ 满足 ODE $\mathrm{d}X_t/\mathrm{d}t=u_t(X_t)$；
- 密度 $p_t(x)$ 不是向量空间中的“点”，不能写成 $\mathrm{d}p_t/\mathrm{d}t=u_t(p_t)$。密度的变化由后文的连续性方程描述。

### 2.2 ODE 的数值求解

神经网络给出的向量场通常没有解析解。令步数为 $n$、步长为 $h=1/n$、$t_k=kh$，Euler 方法为

$$
X_{t_{k+1}}
=X_{t_k}+h\,u_{t_k}^\theta(X_{t_k}).
$$

Heun 方法先用 Euler 得到预测点，再用区间两端的平均速度修正：

$$
\begin{aligned}
\widetilde{X}_{t_{k+1}}
&=X_{t_k}+h\,u_{t_k}^\theta(X_{t_k}),\\
X_{t_{k+1}}
&=X_{t_k}+\frac{h}{2}
\left[
u_{t_k}^\theta(X_{t_k})
+u_{t_{k+1}}^\theta(\widetilde{X}_{t_{k+1}})
\right].
\end{aligned}
$$

Euler 采样的伪代码可以写成：

```text
x = sample_from(p_init)
for k = 0, ..., n - 1:
    t = k / n
    x = x + (1 / n) * u_theta(x, t)
return x
```

![MIT 6.S184 讲义中的 Flow Model Euler 采样流程](/assets/posts/diffusion-model/flow-model-euler-method.png)

> 第三方材料：Peter Holderrieth 与 Ezra Erives，MIT 6.S184 讲义第 9 页 Algorithm 1；课程材料采用 [CC BY-NC-SA](https://diffusion.csail.mit.edu/2026/) 许可。

训练时学习的是向量场 $u_t^\theta$，不是已经积分好的流映射 $\psi_t^\theta$；推理时必须调用 ODE 求解器才能得到样本。

### 2.3 Diffusion Model：在轨迹中加入随机性

布朗运动 $W_t$ 可以理解为连续时间随机游走。对任意 $0\le s<t\le1$，其增量满足

$$
W_t-W_s\sim\mathcal{N}\bigl(0,(t-s)I_d\bigr),
$$

并且不相交时间区间上的增量相互独立。随机微分方程（SDE）在确定性 drift 之外加入布朗噪声：

$$
\mathrm{d}X_t
=b_t^\theta(X_t)\,\mathrm{d}t
+\sigma_t\,\mathrm{d}W_t,
\qquad
X_0\sim p_{\mathrm{init}}.
$$

其中 $b_t^\theta$ 是 drift，$\sigma_t\ge0$ 是预先选定的 diffusion coefficient。Euler–Maruyama 离散化为

$$
X_{t+h}
=X_t+h\,b_t^\theta(X_t)
+\sqrt{h}\,\sigma_t\epsilon_t,
\qquad
\epsilon_t\sim\mathcal{N}(0,I_d).
$$

当 $\sigma_t=0$ 时，SDE 就退化为 ODE。因此，Flow Model 可以视为 Diffusion Model 的确定性特例。现在只定义了如何采样，真正的问题仍然是：怎样构造并学习一个能把 $p_{\mathrm{init}}$ 输运到 $p_{\mathrm{data}}$ 的向量场或 drift？

## 3. 从条件概率路径到边缘概率路径

### 3.1 条件概率路径

对每个数据点 $z\in\mathbb{R}^d$，先人为选择一条条件概率路径 $p_t(x\mid z)$，满足

$$
p_0(\cdot\mid z)=p_{\mathrm{init}},
\qquad
p_1(\cdot\mid z)=\delta_z.
$$

$\delta_z$ 是 Dirac delta distribution，从中采样总会得到 $z$。因此，条件路径描述了“如何把噪声逐渐变成某一个固定数据点 $z$”。中间过程并不唯一；不同的概率路径会对应不同的训练目标和采样轨迹。

### 3.2 边缘概率路径

训练时先抽取 $z\sim p_{\mathrm{data}}$，再从条件路径抽取 $x\sim p_t(\cdot\mid z)$。对 $z$ 边缘化后，$x$ 的密度为

$$
p_t(x)
=\int p_t(x\mid z)p_{\mathrm{data}}(z)\,\mathrm{d}z.
$$

由条件路径的边界条件可得

$$
\begin{aligned}
p_0(x)
&=\int p_{\mathrm{init}}(x)p_{\mathrm{data}}(z)\,\mathrm{d}z
=p_{\mathrm{init}}(x),\\
p_1(x)
&=\int\delta_z(x)p_{\mathrm{data}}(z)\,\mathrm{d}z
=p_{\mathrm{data}}(x).
\end{aligned}
$$

所以边缘路径 $(p_t)_{0\le t\le1}$ 才是真正连接噪声分布与数据分布的路径。我们可以从 $p_t$ 采样，却通常无法计算上面的积分，也就无法直接得到 $p_t(x)$ 的数值。

### 3.3 Gaussian Probability Path

最常用的选择是 Gaussian conditional probability path。本节固定 $p_{\mathrm{init}}=\mathcal{N}(0,I_d)$，并定义

$$
p_t(\cdot\mid z)
=\mathcal{N}\bigl(\alpha_tz,\beta_t^2I_d\bigr),
$$

其中 $\alpha_t$ 和 $\beta_t$ 是连续可微的 noise schedulers，$\alpha_t$ 单调不减、$\beta_t$ 单调不增，并满足

$$
\alpha_0=0,
\qquad
\beta_0=1,
\qquad
\alpha_1=1,
\qquad
\beta_1=0.
$$

它可以用重参数化直接采样：

$$
z\sim p_{\mathrm{data}},
\qquad
\epsilon\sim\mathcal{N}(0,I_d),
\qquad
X_t=\alpha_tz+\beta_t\epsilon.
$$

于是 $X_t\mid z\sim p_t(\cdot\mid z)$，对 $z$ 边缘化后有 $X_t\sim p_t$。后面的训练之所以不需要在每一步求解 ODE 或 SDE，关键正是可以用这个公式一次得到任意时刻的 $X_t$。

## 4. 从概率路径得到向量场

### 4.1 Gaussian 条件向量场

固定同一个 $z$ 和同一份初始噪声 $\epsilon$，考虑轨迹

$$
X_t=\alpha_tz+\beta_t\epsilon.
$$

对时间求导，而不是对高斯密度求导：

$$
\frac{\mathrm{d}X_t}{\mathrm{d}t}
=\dot{\alpha}_tz+\dot{\beta}_t\epsilon.
$$

当 $\beta_t\ne0$ 时，由 $\epsilon=(x-\alpha_tz)/\beta_t$ 消去噪声，得到条件目标向量场

$$
\begin{aligned}
u_t^{\mathrm{target}}(x\mid z)
&=\dot{\alpha}_tz
+\dot{\beta}_t\frac{x-\alpha_tz}{\beta_t}\\
&=\left(
\dot{\alpha}_t
-\frac{\dot{\beta}_t}{\beta_t}\alpha_t
\right)z
+\frac{\dot{\beta}_t}{\beta_t}x.
\end{aligned}
$$

如果 $X_0=\epsilon\sim\mathcal{N}(0,I_d)$，这个 ODE 的解正是 $X_t=\alpha_tz+\beta_tX_0$，所以其分布与指定的条件路径一致。

上式在 $\beta_t\to0$ 时可能出现形式上的除零，但用于训练的重参数化目标

$$
\dot{\alpha}_tz+\dot{\beta}_t\epsilon
$$

通常仍然稳定。实现时应优先使用这个形式，并避免直接采到数值奇异的端点。

### 4.2 边缘向量场是后验平均

条件向量场会把所有轨迹送到已知数据点 $z$，本身不能产生新样本。真正需要的是不显式依赖某个 $z$ 的边缘向量场。

给定当前状态 $X_t=x$ 后，数据点 $z$ 的后验密度为

$$
p_t(z\mid x)
=\frac{p_t(x\mid z)p_{\mathrm{data}}(z)}{p_t(x)}.
$$

边缘目标向量场定义为条件向量场在该后验下的平均：

$$
\begin{aligned}
u_t^{\mathrm{target}}(x)
&=\mathbb{E}\left[
u_t^{\mathrm{target}}(x\mid Z)
\mid X_t=x
\right]\\
&=\int u_t^{\mathrm{target}}(x\mid z)
\frac{p_t(x\mid z)p_{\mathrm{data}}(z)}{p_t(x)}
\,\mathrm{d}z.
\end{aligned}
$$

直观上，每个候选 $z$ 都给出一个“朝向 $z$”的速度；后验 $p_t(z\mid x)$ 衡量当前带噪样本 $x$ 更可能来自哪个 $z$，边缘向量场则对这些速度加权平均。

### 4.3 连续性方程与边缘化证明

若 ODE 的随机初值分布为 $p_0$，则 $X_t$ 的密度 $p_t$ 满足连续性方程：

$$
\partial_t p_t(x)
=-\nabla_x\cdot\left[p_t(x)u_t(x)\right].
$$

左侧表示位置 $x$ 的概率密度随时间的变化，右侧表示概率质量的净流入。它才是 ODE 在“分布层面”的演化方程。

对每个固定的 $z$，条件向量场满足条件版本的连续性方程：

$$
\partial_t p_t(x\mid z)
=-\nabla_x\cdot\left[
p_t(x\mid z)u_t^{\mathrm{target}}(x\mid z)
\right].
$$

对 $z$ 边缘化可得

$$
\begin{aligned}
\partial_t p_t(x)
&=\int\partial_t p_t(x\mid z)p_{\mathrm{data}}(z)\,\mathrm{d}z\\
&=-\nabla_x\cdot
\int p_t(x\mid z)
u_t^{\mathrm{target}}(x\mid z)
p_{\mathrm{data}}(z)\,\mathrm{d}z\\
&=-\nabla_x\cdot\left[
p_t(x)u_t^{\mathrm{target}}(x)
\right].
\end{aligned}
$$

因此，这个边缘向量场确实沿着边缘概率路径输运样本，最终满足 $X_1\sim p_{\mathrm{data}}$。

## 5. Flow Matching 的训练目标

### 5.1 理想目标与可计算目标

若能计算边缘向量场，最直接的 Flow Matching loss 是

$$
\mathcal{L}_{\mathrm{FM}}(\theta)
=\mathbb{E}_{\substack{
t\sim\operatorname{Unif}[0,1]\\
X_t\sim p_t
}}
\left[
\left\|u_t^\theta(X_t)-u_t^{\mathrm{target}}(X_t)\right\|^2
\right].
$$

但 $u_t^{\mathrm{target}}(x)$ 包含对整个数据分布的后验积分，无法直接计算。条件向量场却有解析表达式，因此实际使用 Conditional Flow Matching（CFM）目标：

$$
\mathcal{L}_{\mathrm{CFM}}(\theta)
=\mathbb{E}_{\substack{
t\sim\operatorname{Unif}[0,1]\\
Z\sim p_{\mathrm{data}}\\
X_t\sim p_t(\cdot\mid Z)
}}
\left[
\left\|u_t^\theta(X_t)-u_t^{\mathrm{target}}(X_t\mid Z)\right\|^2
\right].
$$

### 5.2 为什么回归条件向量场能学到边缘向量场

令

$$
V=u_t^{\mathrm{target}}(X_t\mid Z),
\qquad
\overline{V}
=\mathbb{E}[V\mid t,X_t]
=u_t^{\mathrm{target}}(X_t).
$$

对任意只依赖 $(t,X_t)$ 的模型输出 $f=u_t^\theta(X_t)$，有条件方差分解

$$
\begin{aligned}
\mathbb{E}\left[\|f-V\|^2\right]
&=\mathbb{E}\left[\|f-\overline{V}\|^2\right]
+\mathbb{E}\left[\|V-\overline{V}\|^2\right]\\
&\quad
+2\,\mathbb{E}\left[
(f-\overline{V})^\top(\overline{V}-V)
\right].
\end{aligned}
$$

交叉项为零，因为

$$
\mathbb{E}[\overline{V}-V\mid t,X_t]=0.
$$

于是

$$
\mathcal{L}_{\mathrm{CFM}}(\theta)
=\mathcal{L}_{\mathrm{FM}}(\theta)+C,
$$

其中

$$
C=\mathbb{E}\left[
\left\|V-\mathbb{E}[V\mid t,X_t]\right\|^2
\right]
$$

与参数 $\theta$ 无关。因此两者对 $\theta$ 的梯度完全相同。CFM 看似在拟合依赖单个数据点的条件速度，平方损失的最优预测却自动取后验均值，也就是需要的边缘向量场。

### 5.3 Gaussian CFM 与 CondOT

对 Gaussian path，代入

$$
X_t=\alpha_tZ+\beta_t\epsilon,
\qquad
u_t^{\mathrm{target}}(X_t\mid Z)
=\dot{\alpha}_tZ+\dot{\beta}_t\epsilon,
$$

得到可直接实现的 loss：

$$
\mathcal{L}_{\mathrm{CFM}}(\theta)
=\mathbb{E}_{\substack{
t\sim\operatorname{Unif}[0,1]\\
Z\sim p_{\mathrm{data}}\\
\epsilon\sim\mathcal{N}(0,I_d)
}}
\left[
\left\|
u_t^\theta(\alpha_tZ+\beta_t\epsilon)
-(\dot{\alpha}_tZ+\dot{\beta}_t\epsilon)
\right\|^2
\right].
$$

最简单的 CondOT path 取

$$
\alpha_t=t,
\qquad
\beta_t=1-t.
$$

此时

$$
X_t=tZ+(1-t)\epsilon,
\qquad
u_t^{\mathrm{target}}(X_t\mid Z)=Z-\epsilon,
$$

训练目标退化为

$$
\mathcal{L}_{\mathrm{CFM}}(\theta)
=\mathbb{E}\left[
\left\|u_t^\theta\bigl(tZ+(1-t)\epsilon\bigr)-(Z-\epsilon)\right\|^2
\right].
$$

对应的训练伪代码只有一次数据采样、一次加噪和一次回归：

```python
for z in dataloader:
    t = uniform(0.0, 1.0)
    eps = randn_like(z)
    x_t = alpha(t) * z + beta(t) * eps
    target = alpha_dot(t) * z + beta_dot(t) * eps
    loss = mse(u_theta(x_t, t), target)
    update(loss)
```

训练过程中不需要模拟 ODE，所以 Flow Matching 是 simulation-free training；训练完成后的生成阶段仍需要从 $X_0\sim p_{\mathrm{init}}$ 出发求解 ODE。

## 6. Score Function 与 Score Matching

### 6.1 条件 score 与边缘 score

任意密度 $q(x)$ 的 score function 定义为

$$
\nabla_x\log q(x).
$$

它指向对数密度增长最快的方向。对概率路径，分别定义

$$
s_t(x\mid z)=\nabla_x\log p_t(x\mid z),
\qquad
s_t(x)=\nabla_x\log p_t(x).
$$

边缘 score 同样是条件 score 的后验平均：

$$
\begin{aligned}
s_t(x)
&=\frac{\nabla_xp_t(x)}{p_t(x)}\\
&=\int\nabla_x\log p_t(x\mid z)
\frac{p_t(x\mid z)p_{\mathrm{data}}(z)}{p_t(x)}
\,\mathrm{d}z\\
&=\mathbb{E}\left[s_t(x\mid Z)\mid X_t=x\right].
\end{aligned}
$$

以下 Gaussian 条件 score 公式在 $\beta_t>0$ 的内部时间成立；当 $\beta_t=0$ 时，条件分布退化为 $\delta_z$，普通密度及其 score 不再定义，端点只能按极限理解。

对于 Gaussian path，条件 score 有闭式表达式：

$$
\begin{aligned}
s_t(x\mid z)
&=\nabla_x\log
\mathcal{N}\bigl(x;\alpha_tz,\beta_t^2I_d\bigr)\\
&=-\frac{x-\alpha_tz}{\beta_t^2}.
\end{aligned}
$$

若 $x=\alpha_tz+\beta_t\epsilon$，则

$$
s_t(x\mid z)=-\frac{\epsilon}{\beta_t}.
$$

### 6.2 向量场、score 与 denoiser 的等价参数化

在 $\alpha_t\ne0$ 且 $\beta_t>0$ 的内部时间，由 Gaussian 条件 score 可得

$$
z=\frac{x+\beta_t^2s_t(x\mid z)}{\alpha_t}.
$$

将它代入条件向量场，可以把向量场改写为 score 的线性函数：

$$
u_t^{\mathrm{target}}(x\mid z)
=A_t s_t(x\mid z)+B_t x,
$$

其中

$$
A_t
=\beta_t^2\frac{\dot{\alpha}_t}{\alpha_t}
-\beta_t\dot{\beta}_t,
\qquad
B_t=\frac{\dot{\alpha}_t}{\alpha_t}.
$$

对 $z$ 取后验平均后，同样有

$$
u_t^{\mathrm{target}}(x)=A_ts_t(x)+B_tx.
$$

因此，在 Gaussian path 下，学习边缘向量场和学习边缘 score 理论上是等价的。只要 $A_t\ne0$，就可以反向恢复

$$
s_t(x)
=\frac{u_t^{\mathrm{target}}(x)-B_tx}{A_t}.
$$

另一种常见参数化是 denoiser，即在给定带噪样本后预测干净数据的后验均值：

$$
D_t(x)=\mathbb{E}[Z\mid X_t=x].
$$

它与 score 的关系为

$$
D_t(x)=\frac{x+\beta_t^2s_t(x)}{\alpha_t},
$$

与向量场的关系为

$$
D_t(x)
=\frac{\beta_tu_t^{\mathrm{target}}(x)-\dot{\beta}_tx}
{\dot{\alpha}_t\beta_t-\alpha_t\dot{\beta}_t}.
$$

上述等式只在相应分母非零处成立：denoiser 与向量场的转换还要求 $\dot{\alpha}_t\beta_t-\alpha_t\dot{\beta}_t\ne0$。端点应按极限理解，或改用不含奇异分母的稳定参数化。理论等价不代表数值条件相同，实际系统会结合 noise schedule、loss weighting 和网络参数化选择更稳定的形式。

### 6.3 Denoising Score Matching

理想的 Score Matching loss 为

$$
\mathcal{L}_{\mathrm{SM}}(\theta)
=\mathbb{E}_{t,X_t}
\left[
\left\|s_t^\theta(X_t)-s_t(X_t)\right\|^2
\right],
$$

但边缘 score $s_t(x)$ 依赖不可计算的边缘密度。可计算的 Denoising Score Matching（DSM）目标是

$$
\mathcal{L}_{\mathrm{DSM}}(\theta)
=\mathbb{E}_{t,Z,X_t}
\left[
\left\|s_t^\theta(X_t)-s_t(X_t\mid Z)\right\|^2
\right].
$$

与 CFM 完全相同的条件期望分解说明

$$
\mathcal{L}_{\mathrm{DSM}}(\theta)
=\mathcal{L}_{\mathrm{SM}}(\theta)+C,
$$

其中 $C$ 与 $\theta$ 无关。因此，回归条件 score 会得到边缘 score。

对 Gaussian path，DSM 目标变为

$$
\mathcal{L}_{\mathrm{DSM}}(\theta)
=\mathbb{E}_{t,Z,\epsilon}
\left[
\left\|
s_t^\theta(\alpha_tZ+\beta_t\epsilon)
+\frac{\epsilon}{\beta_t}
\right\|^2
\right].
$$

当 $\beta_t\to0$ 时，$1/\beta_t$ 会造成数值问题。定义 noise predictor

$$
\epsilon_t^\theta(x)=-\beta_ts_t^\theta(x),
$$

并对不同时间施加相应权重，可得到 DDPM 中常见的噪声预测目标：

$$
\mathcal{L}_{\epsilon}(\theta)
=\mathbb{E}_{t,Z,\epsilon}
\left[
\left\|
\epsilon_t^\theta(\alpha_tZ+\beta_t\epsilon)-\epsilon
\right\|^2
\right].
$$

从原始 DSM loss 到这个 loss 相当于乘上随时间变化的 $\beta_t^2$，会改变不同噪声级别的相对权重。在无限模型容量下，它对所有满足 $\beta_t>0$ 的时间点保留相同的逐点最优预测；连续采样时间时，端点是零测集。

## 7. 从 ODE 扩展到 SDE 采样

### 7.1 Fokker–Planck 方程

对 SDE

$$
\mathrm{d}X_t=b_t(X_t)\,\mathrm{d}t+\sigma_t\,\mathrm{d}W_t,
$$

其边缘密度满足 Fokker–Planck 方程：

$$
\partial_tp_t(x)
=-\nabla_x\cdot\left[p_t(x)b_t(x)\right]
+\frac{\sigma_t^2}{2}\Delta_xp_t(x).
$$

第一项是 drift 引起的概率输运，第二项是随机噪声引起的扩散。当 $\sigma_t=0$ 时，它正好退化为连续性方程。

### 7.2 SDE Extension Trick

假设已经有一个沿目标概率路径运动的 ODE 向量场 $u_t^{\mathrm{target}}$，即

$$
\partial_tp_t
=-\nabla_x\cdot\left(p_tu_t^{\mathrm{target}}\right).
$$

对任意 $\sigma_t\ge0$，定义 SDE drift

$$
b_t(x)
=u_t^{\mathrm{target}}(x)
+\frac{\sigma_t^2}{2}s_t(x),
\qquad
s_t(x)=\nabla_x\log p_t(x).
$$

将它代入 Fokker–Planck 方程：

$$
\begin{aligned}
-\nabla_x\cdot(p_tb_t)
+\frac{\sigma_t^2}{2}\Delta_xp_t
&=-\nabla_x\cdot(p_tu_t^{\mathrm{target}})
-\frac{\sigma_t^2}{2}\nabla_x\cdot(p_ts_t)
+\frac{\sigma_t^2}{2}\Delta_xp_t\\
&=-\nabla_x\cdot(p_tu_t^{\mathrm{target}}),
\end{aligned}
$$

其中使用了

$$
p_t\nabla_x\log p_t=\nabla_xp_t,
\qquad
\nabla_x\cdot(\nabla_xp_t)=\Delta_xp_t.
$$

扩散项恰好抵消新增 score drift 对密度的影响。因此

$$
\mathrm{d}X_t
=\left[
u_t^{\mathrm{target}}(X_t)
+\frac{\sigma_t^2}{2}s_t(X_t)
\right]\mathrm{d}t
+\sigma_t\,\mathrm{d}W_t
$$

与原 ODE 具有相同的所有单时刻边缘分布 $p_t$，特别是同样满足 $X_1\sim p_{\mathrm{data}}$。轨迹本身并不相同：ODE 在给定 $X_0$ 后完全确定，SDE 在演化过程中还会不断注入随机性。

### 7.3 一个模型，多种采样动力学

在 Gaussian path 下有 $u_t=A_ts_t+B_tx$，所以只学习一个向量场网络或一个 score network 就足够构造两者。

若直接学习 score，SDE drift 可以写为

$$
b_t^\theta(x)
=\left(A_t+\frac{\sigma_t^2}{2}\right)s_t^\theta(x)+B_tx.
$$

若直接学习 Flow Matching 向量场，则在 $A_t\ne0$ 时可写为

$$
b_t^\theta(x)
=\left(1+\frac{\sigma_t^2}{2A_t}\right)u_t^\theta(x)
-\frac{\sigma_t^2B_t}{2A_t}x.
$$

于是训练完成后可以再选择采样动力学：

- $\sigma_t=0$：使用确定性的 ODE sampler；
- $\sigma_t>0$：使用随机的 SDE sampler，并通过 Euler–Maruyama 等方法离散化。

在理论上的连续时间、精确模型和精确求解条件下，任意合适的 $\sigma_t$ 都产生相同的 $p_t$。实际模型存在训练误差和数值离散误差，因此 $\sigma_t$、步数和求解器仍然会影响样本质量与速度。

### 7.4 与传统 forward/reverse diffusion 记号的关系

传统扩散文献通常先定义从数据到噪声的 forward process。令 $\overline{p}_\tau=\operatorname{Law}(\overline{X}_\tau)$ 表示它的边缘密度；在常见的 VP、VE 等构造中，drift 取线性形式 $f_\tau(x)=a_\tau x$：

$$
\overline{X}_0\sim p_{\mathrm{data}},
\qquad
\mathrm{d}\overline{X}_\tau
=f_\tau(\overline{X}_\tau)\,\mathrm{d}\tau
+g_\tau\,\mathrm{d}\overline{W}_\tau.
$$

线性 drift 和只依赖时间的 diffusion coefficient 使条件分布 $\overline{X}_\tau\mid\overline{X}_0=z$ 为 Gaussian，因而构成一条方向相反的 Gaussian probability path。若令生成时间 $t=T-\tau$，对应的 reverse-time SDE 可以写成

$$
X_0\sim\overline{p}_T,
\qquad
\mathrm{d}X_t
=\left[
-f_{T-t}(X_t)
+g_{T-t}^2\nabla_x\log\overline{p}_{T-t}(X_t)
\right]\mathrm{d}t
+g_{T-t}\,\mathrm{d}W_t.
$$

因此，传统的“先定义 forward noising，再反转 SDE”和本文的“直接指定 noise-to-data 概率路径，再解连续性或 Fokker–Planck 方程”描述的是同一类构造。后者避免来回翻转时间，但公式中的正负号不能脱离时间方向直接照搬。

## 8. 条件生成与 Classifier-Free Guidance

前文中的“条件”指给定干净数据点 $z$ 构造辅助概率路径；生成时的 prompt 条件则记为 $y$。二者作用不同，不应混为一谈。

### 8.1 Vanilla Guidance

若训练集包含配对样本 $(z,y)\sim p_{\mathrm{data}}(z,y)$，最直接的方法是把 $y$ 一并输入向量场网络：

$$
\mathcal{L}_{\mathrm{guided}}(\theta)
=\mathbb{E}_{t,(Z,Y),\epsilon}
\left[
\left\|
u_t^\theta(\alpha_tZ+\beta_t\epsilon\mid Y)
-(\dot{\alpha}_tZ+\dot{\beta}_t\epsilon)
\right\|^2
\right].
$$

理想情况下，求解

$$
\frac{\mathrm{d}X_t}{\mathrm{d}t}
=u_t^\theta(X_t\mid y)
$$

即可得到 $X_1\sim p_{\mathrm{data}}(\cdot\mid y)$。

### 8.2 CFG 的推导

对 Gaussian path，Bayes 公式给出 guided score：

$$
\nabla_x\log p_t(x\mid y)
=\nabla_x\log p_t(x)
+\nabla_x\log p_t(y\mid x).
$$

利用 $u_t=A_ts_t+B_tx$，guided 向量场可以写成

$$
u_t(x\mid y)
=u_t(x)+A_t\nabla_x\log p_t(y\mid x).
$$

若把 prompt 相关的增量放大 $w$ 倍，得到

$$
\begin{aligned}
\widetilde{u}_t(x\mid y)
&=u_t(x)+w\left[u_t(x\mid y)-u_t(x)\right]\\
&=(1-w)u_t(x)+w\,u_t(x\mid y).
\end{aligned}
$$

Classifier-Free Guidance（CFG）用同一个网络同时近似这两个向量场。训练时以概率 $\eta$ 把条件 $y$ 替换为空条件 $\varnothing$：

$$
y\leftarrow\varnothing
\qquad\text{with probability }\eta.
$$

推理时计算

$$
\widetilde{u}_t^\theta(x\mid y)
=(1-w)u_t^\theta(x\mid\varnothing)
+w\,u_t^\theta(x\mid y).
$$

$w=1$ 对应普通条件生成；$w>1$ 是沿 conditional 与 unconditional 预测之差进行外推，通常能增强提示词一致性，但它是启发式修改，不再保证严格沿原来的 $p_t(x\mid y)$ 运动，也常以降低多样性为代价。

## 9. 把训练与采样串起来

完整流程可以压缩为五步：

1. 选择 $p_{\mathrm{init}}$ 与概率路径，例如 $X_t=\alpha_tZ+\beta_t\epsilon$。
2. 训练时采样 $Z$、$t$ 和 $\epsilon$，一次计算任意噪声级别的 $X_t$。
3. 选择预测参数化：Flow Matching 回归 $\dot{\alpha}_tZ+\dot{\beta}_t\epsilon$；Score Matching 回归 $-\epsilon/\beta_t$；DDPM 常直接回归 $\epsilon$。
4. Gaussian path 下，向量场、score、denoiser 和 noise predictor 可以相互转换，不需要为每个对象分别训练网络。
5. 推理时从 $X_0\sim p_{\mathrm{init}}$ 出发，选择 ODE 或 SDE 动力学并数值积分到 $t=1$。

最后，三组概念尤其容易混淆：

- $X_t$ 是随机变量，$x$ 是其取值，$p_t(x)$ 是密度；ODE 作用于 $X_t$，连续性方程作用于 $p_t$。
- $p_t(x\mid z)$ 中的 $z$ 是训练时构造概率路径所用的数据点；$p_t(x\mid y)$ 中的 $y$ 是生成时希望遵循的 prompt 或类别。
- Flow Matching 和 Score Matching 的训练可以不模拟微分方程，但生成阶段必须运行 ODE 或 SDE solver。

这套视角把两类模型统一起来：概率路径规定“每个时刻希望是什么分布”，向量场或 score 规定“样本如何移动”，连续性方程与 Fokker–Planck 方程保证两种描述一致，而 CFM 与 DSM 则把不可计算的边缘目标变成可以从数据和噪声直接采样的监督信号。
