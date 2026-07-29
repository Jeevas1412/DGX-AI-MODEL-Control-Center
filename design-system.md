# DGX AI Control Center - 设计系统

基于 ui-ux-pro-max 技能生成的设计系统

## 设计模式

**模式名称**: Minimal Single Column  
**转换重点**: 单一 CTA 焦点、大字体、大量留白、无导航杂乱、移动优先  
**CTA 位置**: 居中、大 CTA 按钮  
**色彩策略**: 极简主义：品牌色 + 白色 #FFFFFF + 强调色。按钮：高对比度 7:1+。文本：黑色/深灰色  

## 设计风格

**风格名称**: Dark Mode (OLED)  
**模式支持**: 仅暗色模式  
**关键词**: 深色主题、低光、高对比度、深黑色、午夜蓝、护眼、OLED、夜间模式、节能  
**最佳场景**: 夜间模式应用、编程平台、娱乐、护眼、OLED 设备、低光环境  
**性能**: ⚡ 优秀 | **可访问性**: ✓ WCAG AAA  

## 色彩系统

| 角色 | 颜色值 | CSS 变量 |
|------|--------|----------|
| 主色 | `#0F172A` | `--color-primary` |
| 主色前景 | `#FFFFFF` | `--color-on-primary` |
| 次色 | `#1E293B` | `--color-secondary` |
| 强调/CTA | `#22C55E` | `--color-accent` |
| 背景 | `#020617` | `--color-background` |
| 前景 | `#F8FAFC` | `--color-foreground` |
| 静音 | `#1A1E2F` | `--color-muted` |
| 边框 | `#334155` | `--color-border` |
| 危险 | `#EF4444` | `--color-destructive` |
| 环形 | `#0F172A` | `--color-ring` |

**备注**: 深色背景 + 绿色积极指标

## 字体系统

**字体配对**: Dashboard Data  
**类别**: Mono + Sans  
**标题字体**: Fira Code  
**正文字体**: Fira Sans  
**风格关键词**: dashboard、data、analytics、code、technical、precise  
**最佳场景**: 仪表板、分析、数据可视化、管理面板  

**Google Fonts**: https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap

## 关键效果

- 最小发光（text-shadow: 0 0 10px）
- 深色到浅色过渡
- 低白色发射
- 高可读性
- 可见焦点

## 避免的反模式

- 缓慢更新
- 无自动化

## 交付前检查清单

- [ ] 无表情符号作为图标（使用 SVG：Heroicons/Lucide）
- [ ] 所有可点击元素都有 cursor-pointer
- [ ] 悬停状态有平滑过渡（150-300ms）
- [ ] 浅色模式：文本对比度 4.5:1 最低
- [ ] 键盘导航的焦点状态可见
- [ ] 尊重 prefers-reduced-motion
- [ ] 响应式：375px、768px、1024px、1440px

## UX 指南要点

### 动画与加载
- 使用骨架屏或旋转器显示加载状态
- 微交互保持在 150-300ms
- 尊重用户的 prefers-reduced-motion 设置
- 使用 transform 和 opacity 进行动画，避免昂贵的重绘

### 可访问性
- 为图标按钮添加 aria-label
- 确保键盘导航顺序与视觉顺序匹配
- 表单字段必须有标签
- 保持文本对比度 >= 4.5:1

### 性能
- 懒加载非首屏内容
- 使用 font-display: swap 避免字体加载阻塞
- 避免无限动画分散注意力