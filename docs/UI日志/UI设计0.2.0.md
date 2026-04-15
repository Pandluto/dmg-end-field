# UI 设计规范 0.2.0

## 项目信息
- **项目名称**：DDD / AiField
- **版本**：0.2.0
- **更新时间**：2026-04-07
- **风格定位**：极简扁平风格 (Minimalist Flat)

---

## 1. 设计原则

- 纯色背景，无阴影无渐变
- 通过颜色和留白创造层次
- 高对比度配色
- 大量留白，内容集中
- 统一圆角：`border-radius: 50%`（圆形）或 `border-radius: 0`（无圆角）

---

## 2. 设备适配

| 项目 | 参数 |
|------|------|
| 目标设备 | 仅 PC 浏览器横屏 |
| 最小宽度 | 1024px |
| 推荐宽度 | 1280px - 1920px |
| 开发服务器端口 | 3030 |

---

## 3. 布局规范

### 内容区域
- **主要内容宽度**：居中 60%
- **最大内容宽度**：1200px
- **两侧留白**：各 20%

### 间距系统
| 元素 | 间距 |
|------|------|
| 组件间距 | 24px |
| 区块间距 | 48px |
| 边距 | 40px |

---

## 4. 色彩系统

### 主色
```css
:root {
  --bg-primary: #ffffff;      /* 背景主色-白 */
  --bg-secondary: #000000;     /* 背景辅色-黑 */
  --bg-accent: #ff3366;        /* 强调色-粉红 */
  --bg-scene: #fffef5;         /* 场景背景-奶白色 */
  --text-primary: #000000;      /* 文字主色-黑 */
  --text-secondary: #ffffff;   /* 文字辅色-白 */
  --border-color: #000000;      /* 边框色 */
  --border-width: 2px;          /* 边框宽度 */
}
```

### 元素颜色（按职业/元素着色）
| 元素 | 颜色 | 用途 |
|------|------|------|
| Physical | `#505055` 深灰色 | 物理角色背景 |
| Fire | `#F5222D` 红色 | 火系 |
| Ice | `#1890FF` 蓝色 | 冰系 |
| Lightning | `#722ED1` 紫色 | 雷系 |
| Water | `#13C2C2` 青色 | 水系 |
| Wind | `#52C41A` 绿色 | 风系 |
| Earth | `#FA8C16` 橙色 | 土系 |

### 技能按钮颜色
| 技能 | 标识 | 颜色 | 标签 |
|------|------|------|------|
| 普通攻击 | A | `#000000` 黑色 | 重击 |
| 战技 | B | `#2196F3` 蓝色 | 战技 |
| 连携技 | E | `#9C27B0` 紫色 | 连携 |
| 终结技 | Q | `#FF5722` 橙色 | 终结 |

---

## 5. 字体系统

```css
--font-family: 'Inter', 'Arial', sans-serif;
--font-size-xs: 12px;
--font-size-sm: 14px;
--font-size-md: 16px;
--font-size-lg: 18px;
--font-size-xl: 24px;
--font-size-2xl: 32px;

--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-bold: 700;
```

---

## 6. 四线谱布局

### 画布区域
| 项目 | 参数 |
|------|------|
| 宽度 | 居中，占视口 60% |
| 高度 | 500px - 600px |
| 最小高度 | 400px |

### 谱线配置
| 项目 | 参数 |
|------|------|
| 谱线组数 | 2-5 组（可动态调整） |
| 每组线条数 | 4 条 |
| 节点数量 | 20-40 个/线 |
| 节点间隔 | 22px |

### 谱线间距（黄金比例）
```
总高度 600px
├── 顶部边距: 60px
├── 4条谱线 + 3个间隔
│   ├── 谱线高度: 4px
│   └── 间隔: 158px (黄金比例)
└── 底部边距: 60px
```

### 节点间距
```
总宽度 960px (视口60%)
├── 左侧边距(头像区): 80px
├── 右侧边距: 20px
└── 可用宽度: 840px
    └── 20个节点: 42px/间隔
```

---

## 7. 组件规范

### 按钮
```css
.btn {
  border: 2px solid var(--border-color);
  padding: 12px 24px;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.btn-primary:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}
```

### 卡片
```css
.card {
  border: 2px solid var(--border-color);
  padding: 24px;
  background: var(--bg-primary);
}
```

### 输入框
```css
.input {
  width: 100%;
  border: 0;
  border-bottom: 2px solid var(--border-color);
  padding: 12px 0;
  background: transparent;
}
```

---

## 8. 技能沙盒

### 结构
- 左侧：角色头像（40x40，圆形，按元素着色）
- 右侧：4 个技能按钮（A/B/E/Q）

### 技能按钮
| 项目 | 参数 |
|------|------|
| 尺寸 | 40-44px（圆形） |
| 边框 | 2px 黑色/白色 |
| 图标 | 按技能类型显示对应图标 |
| 标签 | 图标存在时隐藏文字，右侧显示技能类型标注 |

### 资源路径
- 头像：`/assets/avatars/<name>/<name>.png`
- 技能图标：`/assets/avatars/<name>/<name><skillName>.png`
  - A → 普通攻击
  - B → 战技
  - E → 连携技
  - Q → 终结技

---

## 9. 谱线标签

### 样式
- 头像 + 名称组合
- 头像背景按角色元素着色
- 头像在前，名称在后
- 垂直居中对齐

### 结构
```html
<div class="staff-label-container">
  <div class="sandbox-avatar" style="background: var(--element-color)">
    <img src="/assets/avatars/管理员/管理员.png" />
  </div>
  <span class="sandbox-character-name">管理员</span>
</div>
```

---

## 10. 拖拽功能

### 行为
1. 从沙盒拖出技能按钮到谱线
2. 按钮跟随鼠标移动（整屏范围，fixed 定位）
3. 释放时吸附到最近的节点
4. 角色匹配检查（管理员按钮只能吸附到管理员谱线）
5. 已放置按钮可拖拽移动
6. 右键删除按钮

### 防重叠机制
- 节点重叠检查
- 节点占满时禁止吸附并弹出提示

### 文字选择防护
- SkillButton 组件 mousedown preventDefault()
- CanvasBoard selectstart 全局捕获

---

## 11. 关键尺寸常量

```typescript
const LAYOUT = {
  // 视口
  MIN_WIDTH: 1024,
  CONTENT_WIDTH: '60%',
  MAX_WIDTH: 1200,

  // 间距
  SECTION_GAP: 48,
  COMPONENT_GAP: 24,
  PAGE_MARGIN: 40,

  // 画布
  CANVAS_WIDTH_PERCENT: 0.6,
  CANVAS_MIN_WIDTH: 960,
  CANVAS_HEIGHT: 600,

  // 谱线
  STAFF_COUNT: 4,
  STAFF_HEIGHT: 4,
  STAFF_MARGIN_TOP: 60,
  STAFF_MARGIN_BOTTOM: 60,

  // 节点
  NODE_COUNT: 20,
  NODE_SIZE: 8,
  NODE_SPACING: 22,

  // 技能按钮
  SKILL_BUTTON_SIZE: 44,

  // 头像
  AVATAR_SIZE: 40,

  // 组间距
  GROUP_SPACING: 0,
};
```

---

## 12. 禁止的模式

| 禁止 | 替代方案 |
|------|----------|
| `shadow-*` | 使用边框和留白 |
| `bg-gradient-*` | 使用纯色 |
| `rounded-sm/md/lg` | `rounded-none` 或 `rounded-full` |
| `backdrop-blur` | 直接使用颜色 |

---

## 13. 响应式断点

```css
@media (min-width: 1024px) {
  .container {
    width: 60%;
    max-width: 1200px;
    margin: 0 auto;
  }
}
```

---

## 14. 文件结构

```
src/
  components/
    CanvasBoard/
      index.tsx              # 主组件
      SkillButton.tsx        # 技能按钮组件
      SkillSandbox.tsx      # 技能沙盒组件
      CanvasBoard.css
      SkillSandbox.css
      components/
        CanvasArea.tsx       # 画布区域
        DraggingOverlay.tsx  # 拖拽遮罩
        Toolbar.tsx          # 工具栏
      hooks/
        useCanvasDrag.ts     # 拖拽逻辑
        useCanvasWidth.ts    # 画布宽度
        useSelectStart.ts    # 选择起始
    SelectionPanel/          # 选人界面
  context/
    AppContext.tsx            # 全局状态管理
  types/
    index.ts                  # 类型定义和配置
  utils/
    layout.ts                 # 布局计算
    collision.ts              # 碰撞检测
    helpers.ts                # 工具函数
    assetResolver.ts          # 资源路径解析
public/
  data/
    characters/               # 角色数据JSON
  assets/
    avatars/                  # 头像和技能图标
```

---

## 15. 版本历史

| 版本 | 日期 | 主要内容 |
|------|------|----------|
| 0.2.0 | 2026-04-07 | 当前版本，含技能图标、沙盒头像、元素着色 |
| 0.1 | 早期 | 基础框架搭建 |
