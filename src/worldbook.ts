/**
 * 世界书操作
 * - 创建/读/写/绑定
 * - 小总结条目管理
 * - 卷条目管理
 * - 世界书不存在时跳过执行
 */

import {
  getScriptData,
  getSettings,
  saveScriptData,
  getMiniSummaryOrder,
  getVolumeOrder,
  ENTRY_DEFAULTS,
} from '@/config';

// ========== 世界书名称与存在性 ==========

/** 返回当前聊天绑定的总结世界书名称，未绑定则返回 null */
export function getWorldbookName(): string | null {
  const data = getScriptData();
  return data.worldbook_name || null;
}

/** 检查当前绑定的世界书是否存在 */
export function worldbookExists(): boolean {
  const name = getWorldbookName();
  if (!name) return false;
  return getWorldbookNames().includes(name);
}

// ========== 世界书创建与绑定 ==========

/** 一键创建世界书并绑定到当前聊天 */
export async function createWorldbookForChat(name?: string): Promise<string> {
  const charName = getCurrentCharacterName();
  const worldbookName = name || `${charName || '未知'}[自动总结]`;

  const existingNames = getWorldbookNames();
  if (!existingNames.includes(worldbookName)) {
    await createWorldbook(worldbookName, []);
    console.log(`[自动总结] 已创建世界书: ${worldbookName}`);
  }

  // 绑定到脚本数据
  const data = getScriptData();
  data.worldbook_name = worldbookName;
  saveScriptData(data);

  console.log(`[自动总结] 已绑定世界书: ${worldbookName}`);
  return worldbookName;
}

/** 将已有世界书绑定到当前聊天 */
export async function bindWorldbookForChat(name: string): Promise<void> {
  // 1. 绑定到聊天文件（原生机制）
  await rebindChatWorldbook('current', name);
  
  // 2. 同时记录到脚本变量（供本脚本快速查询）
  const data = getScriptData();
  data.worldbook_name = name;
  saveScriptData(data);
  
  console.log(`[自动总结] 已绑定世界书: ${name}`);
}

// ========== 小总结条目操作 ==========

/** 获取指定楼层的小总结条目 */
export async function getMiniSummaryEntry(message_id: number): Promise<WorldbookEntry | undefined> {
  const name = getWorldbookName();
  if (!name || !worldbookExists()) return undefined;

  const worldbook = await getWorldbook(name);
  const entryName = `[小总结-楼层${message_id}]`;
  return worldbook.find(e => e.name === entryName);
}

/** 创建或替换指定楼层的小总结条目 */
export async function upsertMiniSummaryEntry(message_id: number, content: string): Promise<void> {
  const worldbookName = getWorldbookName();
  if (!worldbookName || !worldbookExists()) {
    console.warn('[自动总结] 世界书不存在，跳过写入小总结');
    return;
  }

  const entryName = `[小总结-楼层${message_id}]`;
  const worldbook = await getWorldbook(worldbookName);
  const existing = worldbook.find(e => e.name === entryName);

  if (existing) {
    // 已存在则替换 content
    await updateWorldbookWith(worldbookName, wb => {
      const entry = wb.find(e => e.name === entryName);
      if (entry) {
        entry.content = content;
      }
      return wb;
    });
  } else {
    // 不存在则新建
    const settings = getSettings();
    await createWorldbookEntries(worldbookName, [
      {
        ...ENTRY_DEFAULTS,
        name: entryName,
        content,
        position: {
          type: 'at_depth',
          role: 'system',
          depth: settings.mini_summary_depth,
          order: getMiniSummaryOrder(message_id, settings.mini_summary_start_order),
        },
      },
    ]);
  }
}

/** 创建空占位小总结条目（同步阶段使用） */
export async function createPlaceholderMiniSummary(message_id: number): Promise<void> {
  const worldbookName = getWorldbookName();
  if (!worldbookName || !worldbookExists()) {
    console.warn('[自动总结] 世界书不存在，跳过创建占位小总结');
    return;
  }

  const entryName = `[小总结-楼层${message_id}]`;
  const worldbook = await getWorldbook(worldbookName);
  const existing = worldbook.find(e => e.name === entryName);

  if (!existing) {
    const settings = getSettings();
    await createWorldbookEntries(worldbookName, [
      {
        ...ENTRY_DEFAULTS,
        name: entryName,
        content: '（总结生成中...）',
        position: {
          type: 'at_depth',
          role: 'system',
          depth: settings.mini_summary_depth,
          order: getMiniSummaryOrder(message_id, settings.mini_summary_start_order),
        },
      },
    ]);
  }
}

/** 获取所有未归档（非卷覆盖范围内）的小总结条目 */
export async function getUnarchivedMiniSummaries(): Promise<WorldbookEntry[]> {
  const name = getWorldbookName();
  if (!name || !worldbookExists()) return [];

  const worldbook = await getWorldbook(name);
  const metadata = getScriptData();

  // 收集已归档的楼层 ID
  const archivedIds = new Set<number>();
  for (const vol of metadata.volumes) {
    for (let id = vol.start_message_id; id <= vol.end_message_id; id++) {
      archivedIds.add(id);
    }
  }

  return worldbook.filter(entry => {
    const match = entry.name.match(/^\[小总结-楼层(\d+)\]$/);
    if (!match) return false;
    const id = parseInt(match[1]);
    return !archivedIds.has(id);
  });
}

// ========== enabled 同步 ==========

/** 根据楼层可见性和归档状态同步所有小总结的 enabled */
export async function syncMiniSummaryEnabled(): Promise<void> {
  const name = getWorldbookName();
  if (!name || !worldbookExists()) return;

  const settings = getSettings();
  const lastId = getLastMessageId();
  const visibleThreshold = lastId - settings.visible_floors + 1;
  const metadata = getScriptData();

  // 收集已归档的楼层 ID 范围
  const archivedIds = new Set<number>();
  for (const vol of metadata.volumes) {
    for (let id = vol.start_message_id; id <= vol.end_message_id; id++) {
      archivedIds.add(id);
    }
  }

  await updateWorldbookWith(name, worldbook => {
    for (const entry of worldbook) {
      const match = entry.name.match(/^\[小总结-楼层(\d+)\]$/);
      if (!match) continue;
      const id = parseInt(match[1]);

      if (id >= visibleThreshold) {
        // 可见楼层 → 不注入
        entry.enabled = false;
      } else if (archivedIds.has(id)) {
        // 已归档 → 不注入
        entry.enabled = false;
      } else {
        // 已隐藏且未归档 → 注入
        entry.enabled = true;
      }
    }
    return worldbook;
  });
}

// ========== 卷条目操作 ==========

/** 创建卷条目并关闭对应范围内的小总结 */
export async function createVolumeEntry(
  volume: number,
  start_id: number,
  end_id: number,
  content: string
): Promise<void> {
  const worldbookName = getWorldbookName();
  if (!worldbookName || !worldbookExists()) {
    console.warn('[自动总结] 世界书不存在，跳过创建卷条目');
    return;
  }

  const entryName = `[卷${volume}-楼层${start_id}~楼层${end_id}]`;

  await updateWorldbookWith(worldbookName, worldbook => {
    // 1. 关闭该范围内的小总结条目
    for (const entry of worldbook) {
      const match = entry.name.match(/^\[小总结-楼层(\d+)\]$/);
      if (!match) continue;
      const id = parseInt(match[1]);
      if (id >= start_id && id <= end_id) {
        entry.enabled = false;
      }
    }

    // 2. 添加卷条目
    const settings = getSettings();
    worldbook.push({
      ...ENTRY_DEFAULTS,
      enabled: true,
      name: entryName,
      content,
      position: {
        type: 'at_depth',
        role: 'system',
        depth: settings.volume_summary_depth,
        order: getVolumeOrder(volume, settings.volume_start_order),
      },
    } as WorldbookEntry);

    return worldbook;
  });

  // 3. 更新脚本变量元数据
  const data = getScriptData();
  data.current_volume = volume + 1;
  data.volumes.push({ volume, start_message_id: start_id, end_message_id: end_id });
  saveScriptData(data);
}

/** 获取所有已有卷条目 */
export async function getVolumes(): Promise<WorldbookEntry[]> {
  const name = getWorldbookName();
  if (!name || !worldbookExists()) return [];

  const worldbook = await getWorldbook(name);
  return worldbook.filter(entry => /^\[卷\d+-楼层\d+~楼层\d+\]$/.test(entry.name));
}
