/**
 * 总结核心逻辑
 * - 消息清洗
 * - 小总结生成
 * - 大总结生成
 * - 大总结触发检查
 */

import { getScriptData, getSettings, saveScriptData, type ScriptDataType } from '@/config';
import {
    getMiniSummaryPrompt,
    getVolumeSummaryPrompt,
    getVolumeCompletionCheckPrompt,
} from '@/prompts';
import {
    getWorldbookName,
    upsertMiniSummaryEntry,
    getUnarchivedMiniSummaries,
    getVolumes,
    createVolumeEntry,
} from '@/worldbook';

// ========== 消息清洗 ==========

/** 使用用户自定义正则清洗消息内容 */
export function cleanMessage(message: string, settings: ScriptDataType): string {
    let cleaned = message;
    for (const regex of settings.message_cleanup_regex) {
        try {
            const re = new RegExp(regex.pattern, regex.flags);
            cleaned = cleaned.replace(re, regex.replacement);
        } catch (e) {
            console.error(`[自动总结] 正则清洗错误 (pattern: ${regex.pattern}):`, e);
            // 跳过无效正则
        }
    }
    return cleaned;
}

// ========== AI 生成辅助 ==========

/** 构建 generateRaw 的自定义 API 配置 */
function buildCustomApi(settings: ScriptDataType): Record<string, any> | undefined {
    if (!settings.custom_api.enabled) return undefined;
    return {
        apiurl: settings.custom_api.apiurl,
        key: settings.custom_api.key,
        model: settings.custom_api.model,
        source: settings.custom_api.source,
    };
}

/** 调用 AI 生成文本 */
async function callAI(
    systemPrompt: string,
    userPrompt: string,
    settings: ScriptDataType,
): Promise<string> {
    try {
        const result = await generateRaw({
            should_silence: true,
            custom_api: buildCustomApi(settings) as any,
            ordered_prompts: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        });
        return result;
    } catch (e) {
        // 自定义 API 失败时降级使用酒馆当前 API
        if (settings.custom_api.enabled) {
            console.warn('[自动总结] 自定义 API 失败，降级使用酒馆当前 API:', e);
            const result = await generateRaw({
                should_silence: true,
                ordered_prompts: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            });
            return result;
        }
        throw e;
    }
}

// ========== 小总结 ==========

/** 生成单条消息的小总结内容 */
export async function generateMiniSummaryContent(message_id: number): Promise<string> {
    const settings = getSettings();
    const worldbook = await getWorldbook(getWorldbookName());

    // 获取前 2 个小总结作为上下文
    const allMiniEntries = worldbook
        .filter((e) => e.name.match(/^\[小总结-楼层(\d+)\]$/))
        .map((e) => ({
            id: parseInt(e.name.match(/楼层(\d+)/)![1]),
            content: e.content,
        }))
        .filter((e) => e.id < message_id)
        .sort((a, b) => a.id - b.id)
        .slice(-2);

    const context = allMiniEntries.map((e) => e.content).join('\n');

    // 获取并清洗当前楼层消息
    const messages = getChatMessages(message_id);
    if (messages.length === 0) {
        throw new Error(`[自动总结] 楼层 ${message_id} 不存在`);
    }
    const message = messages[0].message;

    // 跳过空消息
    if (!message || message.trim() === '') {
        return '（空消息）';
    }

    const cleaned = cleanMessage(message, settings);
    const prompt = getMiniSummaryPrompt(cleaned, context);

    return await callAI(prompt.system, prompt.user, settings);
}

/** 处理小总结任务 - 生成内容并写入已创建的条目 */
export async function handleMiniSummary(message_id: number): Promise<void> {
    // 生成小总结内容
    const summary = await generateMiniSummaryContent(message_id);

    // 将结果写入已存在的条目（upsert 处理，若条目不存在也会创建）
    await upsertMiniSummaryEntry(message_id, summary);

    // 更新元数据
    const data = getScriptData();
    data.last_processed_message_id = message_id;
    saveScriptData(data);
}

// ========== 大总结 ==========

/** 检查是否应该触发大总结 */
export async function shouldTriggerVolumeSummary(): Promise<boolean> {
    const settings = getSettings();
    const unarchivedEntries = await getUnarchivedMiniSummaries();

    if (unarchivedEntries.length === 0) return false;

    // 检查 token 阈值（简单用字符数估算 token 数，中文约 1 字 ≈ 1-2 token）
    const totalContent = unarchivedEntries.map((e) => e.content).join('');
    const estimatedTokens = totalContent.length; // 粗略估算

    if (estimatedTokens > settings.volume_token_threshold) {
        return true;
    }

    // AI 判断是否一卷已完结
    try {
        const miniSummaries = unarchivedEntries.map((e) => e.content);
        const prompt = getVolumeCompletionCheckPrompt(miniSummaries);
        const result = await callAI(prompt.system, prompt.user, settings);
        // 检查回答中是否包含 114514（完结）或 1919810（未完结）
        if (result.includes('114514')) return true;
        if (result.includes('1919810')) return false;
        // 都不包含时默认不触发
        console.warn('[自动总结] 卷完结检测返回了意外内容:', result);
        return false;
    } catch (e) {
        console.error('[自动总结] 卷完结检测失败:', e);
        return false;
    }
}

/** 生成大总结内容 */
export async function generateVolumeSummaryContent(
    mini_summaries: WorldbookEntry[],
): Promise<string> {
    const settings = getSettings();
    const volumes = await getVolumes();

    const miniContents = mini_summaries.map((e) => e.content);
    const previousVolumeContents = volumes
        .sort((a, b) => {
            const aVol = parseInt(a.name.match(/卷(\d+)/)![1]);
            const bVol = parseInt(b.name.match(/卷(\d+)/)![1]);
            return aVol - bVol;
        })
        .map((e) => e.content);

    const prompt = getVolumeSummaryPrompt(miniContents, previousVolumeContents);
    return await callAI(prompt.system, prompt.user, settings);
}

/** 执行完整的大总结流程 */
export async function performVolumeSummary(): Promise<void> {
    const data = getScriptData();
    const unarchivedEntries = await getUnarchivedMiniSummaries();

    if (unarchivedEntries.length === 0) return;

    // 先检查是否满足大总结条件
    const shouldTrigger = await shouldTriggerVolumeSummary();
    if (!shouldTrigger) return;

    // 提取楼层 ID 范围
    const ids = unarchivedEntries
        .map((e) => parseInt(e.name.match(/楼层(\d+)/)![1]))
        .sort((a, b) => a - b);

    const start_id = ids[0];
    const end_id = ids[ids.length - 1];

    // 生成大总结
    const content = await generateVolumeSummaryContent(unarchivedEntries);

    // 创建卷条目并关闭对应小总结
    await createVolumeEntry(data.current_volume, start_id, end_id, content);

    console.log(
        `[自动总结] 已归档卷${data.current_volume}: 楼层${start_id}~楼层${end_id}`,
    );
}
