/**
 * 设置和元数据管理
 * - Zod schema 定义（合并用户设置 + 运行时元数据）
 * - 脚本变量读写
 * - 条目配置常量
 */

import type { PartialDeep } from 'type-fest';

// ========== 常量 ==========

/** 根据楼层 ID 计算小总结条目的 order 值 */
export function getMiniSummaryOrder(message_id: number, base: number): number {
  return base + message_id;
}

/** 根据卷号计算卷条目的 order 值 */
export function getVolumeOrder(volume: number, base: number): number {
  return base + volume;
}

// ========== 条目默认配置 ==========

/** 基础条目默认配置（不含 position，由调用方根据设置动态指定） */
export const ENTRY_DEFAULTS: PartialDeep<WorldbookEntry> = {
  enabled: false,
  strategy: {
    type: 'constant',
    keys: [],
    keys_secondary: { logic: 'and_any', keys: [] },
    scan_depth: 'same_as_global',
  },
  probability: 100,
  recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
  effect: { sticky: null, cooldown: null, delay: null },
};

// ========== Zod Schema ==========

/** 脚本数据 schema：合并用户设置 + 运行时元数据 */
export const ScriptData = z
  .object({
    // === 用户设置 ===
    /** 最近保留显示的楼层数 */
    visible_floors: z.coerce
      .number()
      .transform(v => _.clamp(v, 1, 100))
      .prefault(20),
    /** 每多少个小总结触发一次大总结检查 */
    check_interval: z.coerce
      .number()
      .transform(v => _.clamp(v, 5, 100))
      .prefault(20),
    /** 大总结 token 阈值 */
    volume_token_threshold: z.coerce
      .number()
      .transform(v => _.clamp(v, 1000, 50000))
      .prefault(8000),
    /** 是否启用自动小总结 */
    auto_mini_summary: z.boolean().prefault(true),
    /** 是否启用自动大总结 */
    auto_volume_summary: z.boolean().prefault(true),
    /** 小总结注入深度（at_depth） */
    mini_summary_depth: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 99999))
      .prefault(9999),
    /** 卷总结注入深度（at_depth） */
    volume_summary_depth: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 99999))
      .prefault(9999),
    /** 小总结起始排序 order 基数 */
    mini_summary_start_order: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 99999))
      .prefault(10000),
    /** 卷总结起始排序 order 基数 */
    volume_start_order: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 99999))
      .prefault(100),
    /** 忽略前多少层消息不进行总结 */
    ignore_floors: z.coerce
      .number()
      .transform(v => _.clamp(v, 0, 1000))
      .prefault(0),
    /** 自定义 API 配置 */
    custom_api: z
      .object({
        enabled: z.boolean().prefault(false),
        apiurl: z.string().prefault(''),
        key: z.string().prefault(''),
        model: z.string().prefault(''),
        source: z.string().prefault('openai'),
      })
      .prefault({}),
    /** 消息清洗正则列表 */
    message_cleanup_regex: z
      .array(
        z.object({
          pattern: z.string(),
          flags: z.string().prefault('g'),
          replacement: z.string().prefault(''),
        })
      )
      .prefault([]),
    /** 内容捕获标签（仅总结由该标签包裹的内容，为空则总结全部内容） */
    capture_tag: z.string().prefault(''),

    // === 运行时元数据 ===
    /** 当前卷号 */
    current_volume: z.coerce.number().prefault(1),
    /** 上次处理到的楼层 ID */
    last_processed_message_id: z.coerce.number().prefault(-1),
    /** 已归档的卷信息 */
    volumes: z
      .array(
        z.object({
          volume: z.coerce.number(),
          start_message_id: z.coerce.number(),
          end_message_id: z.coerce.number(),
        })
      )
      .prefault([]),
  })
  .prefault({});

export type ScriptDataType = z.output<typeof ScriptData>;

// ========== 脚本变量读写 ==========

/** 获取脚本数据（设置 + 元数据） */
export function getScriptData(): ScriptDataType {
  const raw = getVariables({ type: 'script' });
  return ScriptData.parse(raw);
}

/** 保存脚本数据 */
export function saveScriptData(data: ScriptDataType): void {
  replaceVariables(data as Record<string, any>, { type: 'script' });
}

/** 获取设置（ScriptData 的别名，方便语义使用） */
export function getSettings(): ScriptDataType {
  return getScriptData();
}
