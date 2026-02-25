/**
 * 脚本入口
 * - 初始化流程
 * - 事件监听注册
 * - 聊天变更重载
 */

import { getScriptData } from '@/config';
import { taskQueue } from '@/queue';
import { handleMiniSummary, performVolumeSummary } from '@/summary';
import { worldbookExists, syncMiniSummaryEnabled } from '@/worldbook';
import { registerListeners } from '@/trigger';
import { addMenuItem } from '@/ui';

/** 聊天变更时重载脚本 */
function reloadOnChatChange(): EventOnReturn {
  let chat_id = SillyTavern.getCurrentChatId();
  return eventOn(tavern_events.CHAT_CHANGED, (new_chat_id: string) => {
    if (chat_id !== new_chat_id) {
      chat_id = new_chat_id;
      window.location.reload();
    }
  });
}

// 注册任务处理函数到队列
taskQueue.setHandlers({
  mini_summary: handleMiniSummary,
  volume_summary: performVolumeSummary,
});
$(() => {
  void (async () => {
    try {
      // 1. 加载脚本变量（设置 + 元数据）
      const _data = getScriptData();
      console.log('[自动总结] 脚本变量已加载');

      // 2. 获取当前角色卡名称 - 无角色卡则退出
      const charName = getCurrentCharacterName();
      if (!charName) {
        console.log('[自动总结] 未打开角色卡，脚本不执行');
        return;
      }
      console.log(`[自动总结] 当前角色卡: ${charName}`);

      // 3. 同步小总结 enabled 状态（仅在世界书存在时）
      if (worldbookExists()) {
        await syncMiniSummaryEnabled();
      } else {
        console.log('[自动总结] 当前聊天未绑定世界书或世界书不存在，跳过同步');
      }

      // 4. 注册扩展菜单入口
      addMenuItem();

      // 5. 注册事件监听
      registerListeners();

      // 6. 聊天变更时重载
      reloadOnChatChange();

      console.log('[自动总结] 初始化完成');
    } catch (e) {
      console.error('[自动总结] 初始化失败:', e);
    }
  })();
});
