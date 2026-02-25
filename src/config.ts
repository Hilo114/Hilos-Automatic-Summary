/**
 * 设置和元数据管理
 * - Zod schema 定义（合并用户设置 + 运行时元数据）
 * - 脚本变量读写
 * - 条目配置常量
 */

import type { PartialDeep } from 'type-fest';

// ========== 常量 ==========

/** 小总结 order 基数，实际 order = MINI_SUMMARY_ORDER_BASE + message_id */
export const MINI_SUMMARY_ORDER_BASE = 10000;

/** 卷总结 order 基数，实际 order = VOLUME_ORDER_BASE + volume */
export const VOLUME_ORDER_BASE = 100;

/** 根据楼层 ID 计算小总结条目的 order 值 */
export function getMiniSummaryOrder(message_id: number): number {
    return MINI_SUMMARY_ORDER_BASE + message_id;
}

/** 根据卷号计算卷条目的 order 值 */
export function getVolumeOrder(volume: number): number {
    return VOLUME_ORDER_BASE + volume;
}

// ========== 条目默认配置 ==========

/** 小总结条目默认配置 */
export const MINI_SUMMARY_DEFAULTS: PartialDeep<WorldbookEntry> = {
    enabled: false,
    strategy: {
        type: 'constant',
        keys: [],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
    },
    position: { type: 'at_depth', role: 'system', depth: 9999, order: MINI_SUMMARY_ORDER_BASE },
    probability: 100,
    recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
};

/** 卷总结条目默认配置 */
export const VOLUME_DEFAULTS: PartialDeep<WorldbookEntry> = {
    ...MINI_SUMMARY_DEFAULTS,
    enabled: true,
    position: { type: 'at_depth', role: 'system', depth: 9999, order: VOLUME_ORDER_BASE },
};

// ========== Zod Schema ==========

/** 脚本数据 schema：合并用户设置 + 运行时元数据 */
export const ScriptData = z.object({
    // === 用户设置 ===
    /** 最近保留显示的楼层数 */
    visible_floors: z.coerce
        .number()
        .transform((v) => _.clamp(v, 1, 100))
        .prefault(20),
    /** 每多少个小总结触发一次大总结检查 */
    check_interval: z.coerce
        .number()
        .transform((v) => _.clamp(v, 5, 100))
        .prefault(20),
    /** 大总结 token 阈值 */
    volume_token_threshold: z.coerce
        .number()
        .transform((v) => _.clamp(v, 1000, 50000))
        .prefault(8000),
    /** 是否启用自动小总结 */
    auto_mini_summary: z.boolean().prefault(true),
    /** 是否启用自动大总结 */
    auto_volume_summary: z.boolean().prefault(true),
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
            }),
        )
        .prefault([]),

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
            }),
        )
        .prefault([]),
}).prefault({});

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
