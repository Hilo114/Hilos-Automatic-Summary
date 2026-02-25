/**
 * 触发器
 * - 监听 MESSAGE_RECEIVED 事件
 * - 同步阶段：创建占位条目 → 同步 enabled → 更新楼层可见性
 * - 异步阶段：将任务加入队列
 */

import { getSettings } from '@/config';
import { taskQueue } from '@/queue';
import { createPlaceholderMiniSummary, syncMiniSummaryEnabled } from '@/worldbook';
import { updateFloorVisibility } from '@/chat-manager';

/** 小总结计数器（用于大总结检查间隔） */
let miniSummaryCount = 0;

/** 检查是否应该触发大总结检查 */
function shouldCheckVolumeSummary(): boolean {
    const settings = getSettings();
    if (!settings.auto_volume_summary) return false;
    return miniSummaryCount % settings.check_interval === 0 && miniSummaryCount > 0;
}

/** MESSAGE_RECEIVED 事件处理函数 */
async function onMessageReceived(message_id: number): Promise<void> {
    const settings = getSettings();

    // 如果未启用自动小总结，直接返回
    if (!settings.auto_mini_summary) return;

    // 跳过系统消息
    const messages = getChatMessages(message_id);
    if (messages.length === 0) return;
    const msg = messages[0];
    if (msg.role === 'system') return;
    if (!msg.message || msg.message.trim() === '') return;

    // 忽略前 N 层的消息
    if (message_id < settings.ignore_floors) return;

    try {
        // === 同步阶段 ===

        // 1. 新建当前楼层的小总结世界书条目（内容为空占位）
        await createPlaceholderMiniSummary(message_id);

        // 2. 同步小总结 enabled 状态
        await syncMiniSummaryEnabled();

        // 3. 调整楼层隐藏与显示
        await updateFloorVisibility();

        // === 异步队列阶段 ===

        // 4. 递增计数器
        miniSummaryCount++;

        // 5. 大总结检查（如果满足间隔条件，将大总结任务加入队列）
        if (shouldCheckVolumeSummary()) {
            taskQueue.enqueue({ type: 'volume_summary' });
        }

        // 6. 将小总结生成任务加入异步队列
        taskQueue.enqueue({ type: 'mini_summary', message_id });
    } catch (e) {
        console.error('[自动总结] 消息处理失败:', e);
    }
}

/** 注册事件监听 */
export function registerListeners(): EventOnReturn {
    return eventOn(
        tavern_events.MESSAGE_RECEIVED,
        errorCatched((message_id: number) => {
            void onMessageReceived(message_id);
        }),
    );
}
