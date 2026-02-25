# `src/` 目录架构文档

本文档详细说明 `src/` 目录下各模块的职责、数据流和协作关系。

## 概述

本项目是一个运行在 [SillyTavern](https://docs.sillytavern.app/)（酒馆）中的**酒馆助手脚本**，功能是在角色扮演聊天过程中**自动生成消息总结**，并将总结以世界书条目的形式注入到 AI 提示词上下文中，从而在长对话中保留关键剧情信息。

总结分为两级：

| 级别 | 名称 | 粒度 | 存储形式 |
|------|------|------|----------|
| 一级 | **小总结** | 每条消息 → 一条简短摘要 | 世界书条目 `[小总结-楼层N]` |
| 二级 | **大总结（卷总结）** | 多条小总结 → 一卷完整叙事 | 世界书条目 `[卷N-楼层M~楼层K]` |

---

## 模块依赖关系

```
index.ts          ← 入口，初始化 + 事件注册
  ├── config.ts       ← 设置 & 元数据 (Zod schema + 脚本变量读写)
  ├── trigger.ts      ← 事件监听 (MESSAGE_RECEIVED)
  │     ├── queue.ts      ← 任务队列 (串行执行)
  │     ├── worldbook.ts  ← 世界书条目 CRUD
  │     └── chat-manager.ts ← 楼层可见性管理
  ├── summary.ts      ← 核心总结逻辑 (消息清洗 + AI 生成)
  │     ├── prompts.ts    ← AI 提示词模板
  │     └── worldbook.ts
  ├── worldbook.ts    ← 世界书操作
  └── ui.ts           ← 设置弹窗 UI
```

---

## 各模块详解

### [`index.ts`](../src/index.ts) — 脚本入口

**职责**：初始化流程编排 + 聊天变更时重载脚本。

**初始化流程**（在 `$(() => { ... })` 中按序执行）：

1. 加载脚本变量（设置 + 元数据）
2. 检查是否打开了角色卡，无则退出
3. 切换世界书 — 卸载其他角色卡的总结世界书，加载当前角色卡的
4. 确保当前角色卡的总结世界书存在
5. 同步小总结条目的 `enabled` 状态
6. 注册扩展菜单入口（设置 UI）
7. 注册 `MESSAGE_RECEIVED` 事件监听
8. 注册聊天变更时的重载逻辑

**关键行为**：
- 使用 `reloadOnChatChange()` 监听 `tavern_events.CHAT_CHANGED`，当用户切换到不同聊天时执行 `window.location.reload()` 重载脚本
- 在入口处调用 `taskQueue.setHandlers()` 将 [`handleMiniSummary()`](../src/summary.ts:125) 和 [`performVolumeSummary()`](../src/summary.ts:188) 注册为任务处理函数

---

### [`config.ts`](../src/config.ts) — 设置与元数据管理

**职责**：定义所有配置项的 Zod schema，提供脚本变量的统一读写接口。

**数据结构** — [`ScriptData`](../src/config.ts:41) 合并了两部分：

#### 用户设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `visible_floors` | `number` | 20 | 最近保留多少楼可见 |
| `check_interval` | `number` | 20 | 每多少个小总结触发一次大总结检查 |
| `volume_token_threshold` | `number` | 8000 | 大总结触发的 token 阈值 |
| `auto_mini_summary` | `boolean` | `true` | 是否自动生成小总结 |
| `auto_volume_summary` | `boolean` | `true` | 是否自动生成大总结 |
| `mini_summary_depth` | `number` | 9999 | 小总结注入深度 (`at_depth`) |
| `volume_summary_depth` | `number` | 9999 | 卷总结注入深度 |
| `mini_summary_start_order` | `number` | 10000 | 小总结 order 基数 |
| `volume_start_order` | `number` | 100 | 卷总结 order 基数 |
| `ignore_floors` | `number` | 0 | 忽略前 N 层消息不总结 |
| `custom_api` | `object` | — | 自定义 API 配置（URL / Key / Model / Source） |
| `message_cleanup_regex` | `array` | `[]` | 消息清洗正则列表 |

#### 运行时元数据

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `current_volume` | `number` | 1 | 当前待归档的卷号 |
| `last_processed_message_id` | `number` | -1 | 上次处理到的楼层 ID |
| `volumes` | `array` | `[]` | 已归档卷信息列表 `{ volume, start_message_id, end_message_id }` |

**核心函数**：

| 函数 | 说明 |
|------|------|
| [`getScriptData()`](../src/config.ts:130) | 从脚本变量读取并通过 Zod 校验/填充默认值 |
| [`saveScriptData()`](../src/config.ts:136) | 将数据写回脚本变量 |
| [`getSettings()`](../src/config.ts:141) | `getScriptData` 的语义别名 |
| [`getMiniSummaryOrder()`](../src/config.ts:13) | 根据楼层 ID 计算小总结的 `order` 值 |
| [`getVolumeOrder()`](../src/config.ts:18) | 根据卷号计算卷条目的 `order` 值 |

**常量** — [`ENTRY_DEFAULTS`](../src/config.ts:25)：世界书条目的基础默认配置（关闭触发、不递归、100% 概率等）。

---

### [`trigger.ts`](../src/trigger.ts) — 触发器

**职责**：监听酒馆的 `MESSAGE_RECEIVED` 事件，协调同步阶段和异步阶段的工作。

**事件处理流程** — [`onMessageReceived()`](../src/trigger.ts:24)：

```
MESSAGE_RECEIVED(message_id)
│
├── 前置检查
│   ├── auto_mini_summary 是否启用？
│   ├── 是否系统消息？
│   ├── 消息是否为空？
│   └── message_id < ignore_floors？
│
├── 同步阶段（立即执行）
│   ├── 1. createPlaceholderMiniSummary() → 创建占位条目
│   ├── 2. syncMiniSummaryEnabled()      → 同步 enabled 状态
│   └── 3. updateFloorVisibility()       → 调整楼层隐藏/显示
│
└── 异步队列阶段
    ├── 4. miniSummaryCount++
    ├── 5. 如果达到 check_interval → 入队 volume_summary 任务
    └── 6. 入队 mini_summary 任务
```

**设计要点**：
- 同步阶段确保世界书条目和楼层状态在 AI 下次生成前就已正确设置
- 异步阶段通过队列串行化 AI 调用，避免并发问题
- 大总结检查任务排在小总结任务之前入队

---

### [`queue.ts`](../src/queue.ts) — 任务队列

**职责**：串行处理总结任务，避免并发 AI 调用冲突。

**类** — [`TaskQueue`](../src/queue.ts:19)：

| 方法 | 说明 |
|------|------|
| [`setHandlers()`](../src/queue.ts:25) | 注册 `mini_summary` 和 `volume_summary` 的处理函数 |
| [`enqueue()`](../src/queue.ts:30) | 入队任务，同时对相同楼层的小总结任务去重 |
| [`processNext()`](../src/queue.ts:42) | 从队首取任务并执行，执行完后递归处理下一个 |

**任务类型** — [`TaskType`](../src/queue.ts:7)：

- `'mini_summary'` — 附带 `message_id`，生成单条消息的小总结
- `'volume_summary'` — 无参数，执行完整的大总结流程

**去重策略**：入队 `mini_summary` 时，会移除队列中已有的同一 `message_id` 的任务，只保留最新的。

全局单例：[`taskQueue`](../src/queue.ts:70)

---

### [`summary.ts`](../src/summary.ts) — 核心总结逻辑

**职责**：消息清洗、AI 调用、小总结生成、大总结生成与触发检查。

#### 消息清洗

[`cleanMessage()`](../src/summary.ts:26)：按用户配置的正则列表依次对消息内容执行替换，用于去除不需要总结的内容（如 OOC 标记、状态栏代码块等）。

#### AI 生成辅助

- [`buildCustomApi()`](../src/summary.ts:43)：构建自定义 API 配置对象
- [`callAI()`](../src/summary.ts:54)：调用 `generateRaw()` 请求 AI 生成，支持自定义 API 降级到酒馆当前 API

#### 小总结

| 函数 | 说明 |
|------|------|
| [`generateMiniSummaryContent()`](../src/summary.ts:89) | 获取前 2 条小总结作为上下文 + 清洗当前楼层消息 → 调用 AI 生成 |
| [`handleMiniSummary()`](../src/summary.ts:125) | 队列任务处理入口：生成内容 → 写入世界书条目 → 更新元数据 |

#### 大总结

| 函数 | 说明 |
|------|------|
| [`shouldTriggerVolumeSummary()`](../src/summary.ts:141) | 判断是否触发大总结：token 阈值检查 **或** AI 判断是否到了自然段落结尾 |
| [`generateVolumeSummaryContent()`](../src/summary.ts:168) | 收集未归档小总结 + 已有卷内容 → 调用 AI 生成卷总结 |
| [`performVolumeSummary()`](../src/summary.ts:188) | 完整流程：检查条件 → 生成内容 → 创建卷条目并归档小总结 |

---

### [`prompts.ts`](../src/prompts.ts) — AI 提示词模板

**职责**：封装所有 AI 调用所使用的 system / user 提示词。

| 函数 | 用途 | 字数限制 |
|------|------|----------|
| [`getMiniSummaryPrompt()`](../src/prompts.ts:16) | 小总结：总结单条消息 | ≤ 200 字 |
| [`getVolumeSummaryPrompt()`](../src/prompts.ts:45) | 大总结：合并多条小总结为一卷叙事 | ≤ 1000 字 |
| [`getVolumeCompletionCheckPrompt()`](../src/prompts.ts:76) | 卷完结检测：判断是否到了自然段落结尾 | 仅回答"是/否" |

**提示词特点**：
- 统一使用第三人称叙述
- 不添加标题、编号或额外格式
- 小总结提供前 2 条总结作为上下文
- 大总结提供之前所有卷的内容作为前情

---

### [`worldbook.ts`](../src/worldbook.ts) — 世界书操作

**职责**：管理总结专用世界书的创建、切换、条目 CRUD 和 `enabled` 状态同步。

#### 世界书命名规则

[`getWorldbookName()`](../src/worldbook.ts:20)：`{角色卡名}[自动总结]`

每个角色卡拥有独立的总结世界书。

#### 条目命名规则

- 小总结：`[小总结-楼层{message_id}]`
- 卷总结：`[卷{volume}-楼层{start_id}~楼层{end_id}]`

#### 世界书生命周期

| 函数 | 说明 |
|------|------|
| [`ensureWorldbook()`](../src/worldbook.ts:31) | 检查并创建总结世界书 |
| [`switchToCurrentCharWorldbook()`](../src/worldbook.ts:43) | 从全局列表卸载其他角色卡的总结世界书，确保当前角色卡的在列表中 |

#### 小总结条目管理

| 函数 | 说明 |
|------|------|
| [`getMiniSummaryEntry()`](../src/worldbook.ts:59) | 按楼层 ID 查找小总结条目 |
| [`upsertMiniSummaryEntry()`](../src/worldbook.ts:68) | 创建或更新小总结条目内容 |
| [`createPlaceholderMiniSummary()`](../src/worldbook.ts:107) | 创建占位条目（内容为"总结生成中..."） |
| [`getUnarchivedMiniSummaries()`](../src/worldbook.ts:133) | 获取所有未被卷覆盖的小总结条目 |

#### enabled 同步

[`syncMiniSummaryEnabled()`](../src/worldbook.ts:156)：根据以下规则设置每个小总结条目的 `enabled` 状态：

| 条件 | enabled |
|------|---------|
| 楼层 ID ≥ `visibleThreshold`（可见楼层范围内） | `false` |
| 楼层 ID 已被卷归档 | `false` |
| 已隐藏且未归档 | `true` |

#### 卷条目管理

| 函数 | 说明 |
|------|------|
| [`createVolumeEntry()`](../src/worldbook.ts:194) | 创建卷条目 + 关闭对应小总结 + 更新元数据 |
| [`getVolumes()`](../src/worldbook.ts:240) | 获取所有卷条目 |

---

### [`chat-manager.ts`](../src/chat-manager.ts) — 聊天楼层管理

**职责**：根据 `visible_floors` 设置控制楼层的隐藏/显示状态。

[`updateFloorVisibility()`](../src/chat-manager.ts:11)：

1. 计算可见阈值 `visibleThreshold = lastId - visible_floors + 1`
2. 遍历所有楼层，将 `message_id ≥ visibleThreshold` 的设为可见，其余设为隐藏
3. 批量调用 `setChatMessages()` 更新
4. 最后调用 `syncMiniSummaryEnabled()` 同步世界书条目状态

---

### [`ui.ts`](../src/ui.ts) — 设置 UI

**职责**：在酒馆扩展菜单中注入入口，提供设置弹窗。

#### 菜单注入

[`addMenuItem()`](../src/ui.ts:15)：向 `#extensionsMenu` 添加"自动总结"菜单项，点击后打开设置弹窗。

#### 设置弹窗

[`openSettingsPopup()`](../src/ui.ts:230)：创建一个模态弹窗，包含：

| 区域 | 内容 |
|------|------|
| **基本设置** | 显示楼层数、检查间隔、Token 阈值、自动开关、注入深度、排序基数、忽略楼层数 |
| **手动操作** | "手动总结"按钮 → 对最新楼层入队小总结任务；"手动归档"按钮 → 入队大总结任务 |
| **自定义 API**（折叠） | API URL / Key / 模型 / 源 的配置 |
| **消息清洗正则**（折叠） | 动态增删正则规则行 |

保存时将表单数据合并到现有脚本数据并写回。

---

## 完整数据流

### 自动小总结流程

```
用户/AI 发送消息
    ↓
酒馆触发 MESSAGE_RECEIVED(message_id)
    ↓
trigger.ts: onMessageReceived()
    ├── [同步] createPlaceholderMiniSummary()  → 世界书新增占位条目
    ├── [同步] syncMiniSummaryEnabled()        → 更新所有条目 enabled
    ├── [同步] updateFloorVisibility()         → 隐藏旧楼层
    └── [异步] taskQueue.enqueue(mini_summary)
              ↓
         queue.ts: processNext()
              ↓
         summary.ts: handleMiniSummary()
              ├── generateMiniSummaryContent()  → 清洗消息 + AI 生成
              ├── upsertMiniSummaryEntry()      → 写入世界书
              └── saveScriptData()              → 更新 last_processed_message_id
```

### 自动大总结流程

```
miniSummaryCount 达到 check_interval
    ↓
trigger.ts: taskQueue.enqueue(volume_summary)
    ↓
queue.ts: processNext()
    ↓
summary.ts: performVolumeSummary()
    ├── shouldTriggerVolumeSummary()
    │     ├── token 阈值检查
    │     └── AI 卷完结检测
    ├── generateVolumeSummaryContent()  → AI 合并小总结
    └── createVolumeEntry()
          ├── 关闭对应小总结条目
          ├── 创建卷条目 (enabled=true)
          └── 更新 current_volume + volumes 元数据
```

### 楼层可见性与 enabled 联动

```
楼层 ID 空间:
  [0 ... visibleThreshold-1] [visibleThreshold ... lastId]
   ↑ 隐藏的旧楼层              ↑ 可见的最近 N 楼

小总结 enabled 规则:
  已归档 (在某卷范围内)  → enabled=false (卷条目替代)
  已隐藏且未归档         → enabled=true  (注入上下文)
  可见范围内             → enabled=false (消息本身已在上下文)
```

---

## 技术要点

1. **串行队列**：所有 AI 调用通过 [`TaskQueue`](../src/queue.ts:19) 串行化，避免并发冲突和 API 限流
2. **同步/异步分离**：条目创建和状态同步在事件回调中同步完成，AI 生成通过队列异步执行
3. **自定义 API 降级**：[`callAI()`](../src/summary.ts:54) 在自定义 API 失败时自动降级使用酒馆当前 API
4. **Zod 校验 + 默认值**：[`ScriptData`](../src/config.ts:41) 使用 Zod 4 的 `.prefault()` 确保所有字段都有安全默认值
5. **角色卡隔离**：每个角色卡拥有独立的 `{角色卡名}[自动总结]` 世界书，切换角色卡时自动切换
6. **聊天变更重载**：切换聊天时完全重载脚本，确保状态与当前聊天一致