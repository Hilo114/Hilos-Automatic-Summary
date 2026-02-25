/**
 * 世界书操作
 * - 创建/读/写/切换/同步 enabled
 * - 小总结条目管理
 * - 卷条目管理
 */

import {
  getScriptData,
  getSettings,
  saveScriptData,
  getMiniSummaryOrder,
  getVolumeOrder,
  ENTRY_DEFAULTS,
} from '@/config';

// ========== 世界书名称 ==========

/** 返回当前角色卡的总结世界书名称 */
export function getWorldbookName(): string {
  const charName = getCurrentCharacterName();
  if (!charName) {
    throw new Error('[自动总结] 未打开角色卡，无法获取世界书名称');
  }
  return `${charName}[自动总结]`;
}

// ========== 世界书生命周期 ==========

/** 确保当前角色卡的总结世界书存在，不存在则创建 */
export async function ensureWorldbook(): Promise<void> {
  const name = getWorldbookName();
  const existingNames = getWorldbookNames();
  if (!existingNames.includes(name)) {
    await createWorldbook(name, []);
    console.log(`[自动总结] 已创建世界书: ${name}`);
  }
}

/**
 * 从全局世界书列表中移除其他角色卡的总结世界书，确保当前角色卡的在列表中
 */
export async function switchToCurrentCharWorldbook(): Promise<void> {
  const currentName = getWorldbookName();
  const globalBooks = getGlobalWorldbookNames();
  // 过滤掉其他角色卡的[自动总结]世界书，保留当前的
  const filtered = globalBooks.filter(name => !name.endsWith('[自动总结]') || name === currentName);
  if (!filtered.includes(currentName)) {
    filtered.push(currentName);
  }
  await rebindGlobalWorldbooks(filtered);
}

// ========== 小总结条目操作 ==========

/** 获取指定楼层的小总结条目 */
export async function getMiniSummaryEntry(message_id: number): Promise<WorldbookEntry | undefined> {
  const worldbook = await getWorldbook(getWorldbookName());
  const entryName = `[小总结-楼层${message_id}]`;
  return worldbook.find(e => e.name === entryName);
}

/** 创建或替换指定楼层的小总结条目 */
export async function upsertMiniSummaryEntry(message_id: number, content: string): Promise<void> {
  const worldbookName = getWorldbookName();
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
  const worldbook = await getWorldbook(getWorldbookName());
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

  await updateWorldbookWith(getWorldbookName(), worldbook => {
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
  const worldbook = await getWorldbook(getWorldbookName());
  return worldbook.filter(entry => /^\[卷\d+-楼层\d+~楼层\d+\]$/.test(entry.name));
}
