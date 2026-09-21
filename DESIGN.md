---
version: alpha
colors:
  deepInk: "#061728"
  deepBlue: "#0b2e4b"
  ice: "#effbff"
  iceDim: "rgba(222,246,255,.68)"
  signal: "#dff7ff"
typography:
  display:
    fontFamily: '"Space Grotesk", "Noto Sans SC", sans-serif'
    fontSize: "18px"
    lineHeight: "1.1"
  body:
    fontFamily: '"Noto Sans SC", system-ui, sans-serif'
    fontSize: "14px"
    lineHeight: "1.5"
  utility:
    fontFamily: '"Space Grotesk", "Noto Sans SC", sans-serif'
    fontSize: "9px"
    lineHeight: "1.2"
rounded:
  panel: "16px"
  control: "999px"
spacing:
  unit: "4px"
components:
  glassPanel:
    background: "linear-gradient(110deg, rgba(7,38,64,.76), rgba(56,133,165,.24))"
    border: "1px solid rgba(210,244,255,.2)"
  signalOrb:
    background: "radial-gradient(circle, rgba(225,251,255,.3), rgba(89,195,225,.08) 52%, transparent 54%)"
    motion: "4s ease-in-out breathing"
---

## Overview

SullyOS 的深海陪伴桌面是一个产品型移动界面，核心任务是让用户快速打开对话、衣橱、触摸设置和舞台设置。新深海 UI 使用解构主义杂志构图：信息条、角色舞台和控制光点保持不对称，但交互路径仍然稳定。

North Star 是“深海研究站里的透明观测界面”。它应该像一张被水压弯曲的杂志版面，而不是传统的卡片仪表盘。

## Colors

深蓝负责空间和文字对比，冰白负责可读性与当前状态。青色光效只表示可交互或当前聚焦，不承担唯一的语义。

## Typography

Space Grotesk 负责短英文标签、时间和导航；Noto Sans SC 负责中文正文。移动端中文不使用斜体，短标签允许紧凑字距，但正文保持舒适行高。

## Layout

桌面布局由四层构成：顶部自适应周历、左侧路线信息、左侧光点轨道、底部无面板光点导航。窄屏隐藏周历首尾日期，保留当前日期与核心操作，避免横向溢出。

## Elevation & Depth

玻璃面板使用低透明度、背景模糊和内侧高光。静态信息不使用厚重阴影；悬浮光点用柔和外发光表达可触摸性。

## Shapes

面板使用不对称圆角与轻微斜切，光点使用圆形。避免十字网格、棋盘格和大面积装饰性几何线。

## Components

`AbyssDeconstructiveChrome` 是深海陪伴主题的唯一新桌面 chrome。旧版 `AbyssCompanionChrome` 保留用于兼容，但不再由深海主题调用。

## Do's and Don'ts

- 保持深蓝与冰白的高对比。
- 使用光点、弧线和错位来表达张力。
- 确保 320px 左右窄屏仍能看到所有核心操作。
- 不要重新加入底部大型面板、十字格或装饰性按钮外壳。
