/**
 * 聊天楼层管理
 * - 隐藏/显示楼层
 * - 与小总结 enabled 状态联动
 */

import { getSettings } from '@/config';
import { syncMiniSummaryEnabled } from '@/worldbook';

/** 根据设置更新楼层隐藏状态 */
export async function updateFloorVisibility(): Promise<void> {
    const settings = getSettings();
    const lastId = getLastMessageId();

    if (lastId < 0) return;

    // 获取所有楼层
    const allMessages = getChatMessages(`0-${lastId}`);
    if (allMessages.length === 0) return;

    const visibleThreshold = lastId - settings.visible_floors + 1;

    // 构建需要更新的消息列表
    const updates: Array<{ message_id: number; is_hidden: boolean }> = [];

    for (const msg of allMessages) {
        if (msg.role === 'system') continue; // 跳过系统消息

        if (msg.message_id >= visibleThreshold) {
            // 最近 N 楼设为可见
            if (msg.is_hidden) {
                updates.push({ message_id: msg.message_id, is_hidden: false });
            }
        } else {
            // 更早的楼层设为隐藏
            if (!msg.is_hidden) {
                updates.push({ message_id: msg.message_id, is_hidden: true });
            }
        }
    }

    // 批量更新楼层可见性
    if (updates.length > 0) {
        await setChatMessages(updates, { refresh: 'none' });
    }

    // 同步小总结 enabled 状态
    await syncMiniSummaryEnabled();
}
