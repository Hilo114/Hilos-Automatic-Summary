/**
 * 总结核心逻辑
 * - 消息清洗
 * - 小总结生成
 * - 大总结生成
 * - 大总结触发检查
 */

import { getSettings, type ScriptDataType } from '@/config';
import {
  getMiniSummaryPrompt,
  getVolumeSummaryPrompt,
  getVolumeCompletionCheckPrompt,
} from '@/prompts';
import {
  getWorldbookName,
  worldbookExists,
  upsertMiniSummaryEntry,
  getUnarchivedMiniSummaries,
  getVolumes,
  createVolumeEntry,
  getMetaData,
  saveMetaData,
} from '@/worldbook';

// ========== 消息清洗 ==========

/** 从消息中提取由起始标签和结束标签之间的内容，若未配置标签或未匹配到则返回原文 */
export function extractTaggedContent(
  message: string,
  captureTags: { start_tag: string; end_tag: string }[]
): string {
  // 过滤掉起始和结束标签都为空的组
  const validTags = captureTags.filter(t => t.start_tag || t.end_tag);
  if (validTags.length === 0) return message;

  const allMatches: string[] = [];

  for (const { start_tag: startTag, end_tag: endTag } of validTags) {
    // 构建匹配正则
    const startPattern = startTag ? `<${_.escapeRegExp(startTag)}>` : '^';
    const endPattern = endTag ? `<${_.escapeRegExp(endTag)}>` : '$';
    const regex = new RegExp(`${startPattern}([\\s\\S]*?)${endPattern}`, 'g');

    let groupMatched = false;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(message)) !== null) {
      const content = match[1].trim();
      if (content) {
        allMatches.push(content);
        groupMatched = true;
      }
    }

    if (!groupMatched) {
      const tagDesc =
        startTag && endTag
          ? `<${startTag}> 和 <${endTag}> 之间`
          : startTag
            ? `<${startTag}> 之后`
            : `<${endTag}> 之前`;
      console.warn(`[自动总结] 未在消息中找到 ${tagDesc} 的内容`);
    }
  }

  if (allMatches.length === 0) {
    console.warn(`[自动总结] 所有捕获标签均未匹配到内容，将使用原始消息`);
    return message;
  }

  return allMatches.join('\n\n');
}

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

/** 构建 generateRaw 的 API 配置 */
function buildCustomApi(settings: ScriptDataType): Record<string, any> | undefined {
  if (!settings.custom_api.apiurl) return undefined;
  const api: Record<string, any> = {
    apiurl: settings.custom_api.apiurl,
    key: settings.custom_api.key,
    model: settings.custom_api.model,
    source: settings.custom_api.source,
  };
  // 将 max_tokens 传递给自定义 API
  if (settings.max_tokens > 0) {
    api.max_tokens = settings.max_tokens;
  }
  return api;
}

/** 调用 AI 生成文本 */
async function callAI(
  systemPrompt: string,
  userPrompt: string,
  settings: ScriptDataType
): Promise<string> {
  const useNoTrans = settings.no_trans_tag !== false;
  const NO_TRANS = settings.no_trans_tag_value || '<|no-trans|>';
  const wrapContent = (text: string) => {
    if (!text || !text.trim()) return text;
    return useNoTrans ? `${NO_TRANS}${text}` : text;
  };

  const generateConfig: Record<string, any> = {
    should_silence: true,
    ordered_prompts: [
      { role: 'system', content: wrapContent(systemPrompt) },
      { role: 'user', content: wrapContent(userPrompt) },
    ],
  };
  const customApi = buildCustomApi(settings);
  if (customApi) {
    generateConfig.custom_api = customApi;
  } else if (settings.max_tokens > 0) {
    // 即使没有自定义 API，也可以通过 custom_api 传递 max_tokens
    generateConfig.custom_api = { max_tokens: settings.max_tokens };
  }
  const result = await generateRaw(generateConfig as any);
  return result;
}

// ========== 小总结 ==========

/** 生成单条消息的小总结内容 */
export async function generateMiniSummaryContent(message_id: number): Promise<string> {
  const settings = getSettings();
  const worldbookName = getWorldbookName();
  if (!worldbookName) {
    throw new Error('[自动总结] 未绑定世界书，无法生成小总结');
  }
  const worldbook = await getWorldbook(worldbookName);

  // 获取前 2 个小总结作为上下文
  const allMiniEntries = worldbook
    .filter(e => e.name.match(/^\[小总结-楼层(\d+)\]$/))
    .map(e => ({
      id: parseInt(e.name.match(/楼层(\d+)/)![1]),
      content: e.content,
    }))
    .filter(e => e.id < message_id)
    .sort((a, b) => a.id - b.id)
    .slice(-2);

  const context = allMiniEntries.map(e => e.content).join('\n');

  // 获取并清洗当前楼层消息
  const messages = getChatMessages(message_id);
  if (messages.length === 0) {
    throw new Error(`[自动总结] 楼层 ${message_id} 不存在`);
  }
  const rawMessage = messages[0].message;

  // 跳过空消息
  if (!rawMessage || rawMessage.trim() === '') {
    return '（空消息）';
  }

  // 判断是否配置了有效的捕获标签
  const hasCaptureTags = settings.capture_tags.some(t => t.start_tag || t.end_tag);

  let processedMessage: string;
  if (hasCaptureTags) {
    // 有捕获标签时，直接对原始消息应用标签捕获，不应用酒馆正则清洗
    processedMessage = extractTaggedContent(rawMessage, settings.capture_tags);
  } else {
    // 无捕获标签时，应用酒馆正则过滤后使用全文
    const source = messages[0].role === 'user' ? 'user_input' : 'ai_output';
    processedMessage = formatAsTavernRegexedString(rawMessage, source, 'prompt');
  }

  const extracted = processedMessage;

  const cleaned = cleanMessage(extracted, settings);
  const prompt = getMiniSummaryPrompt(cleaned, context);

  return await callAI(prompt.system, prompt.user, settings);
}

/** 处理小总结任务 - 生成内容并写入已创建的条目 */
export async function handleMiniSummary(message_id: number): Promise<void> {
  // 世界书不存在则跳过
  if (!worldbookExists()) {
    console.warn('[自动总结] 世界书不存在，跳过小总结生成');
    return;
  }

  // 生成小总结内容
  const summary = await generateMiniSummaryContent(message_id);

  // 将结果写入已存在的条目（upsert 处理，若条目不存在也会创建）
  await upsertMiniSummaryEntry(message_id, summary);

  // 更新元数据
  const meta = await getMetaData();
  meta.last_processed_message_id = message_id;
  await saveMetaData(meta);
}

// ========== 大总结 ==========

/** 检查是否应该触发大总结 */
export async function shouldTriggerVolumeSummary(): Promise<boolean> {
  const settings = getSettings();
  const unarchivedEntries = await getUnarchivedMiniSummaries();

  if (unarchivedEntries.length === 0) return false;

  // 检查 token 阈值（简单用字符数估算 token 数，中文约 1 字 ≈ 1-2 token）
  const totalContent = unarchivedEntries.map(e => e.content).join('');
  const estimatedTokens = totalContent.length; // 粗略估算

  if (estimatedTokens > settings.volume_token_threshold) {
    return true;
  }

  // AI 判断是否一卷已完结
  try {
    const miniSummaries = unarchivedEntries.map(e => {
      const match = e.name.match(/楼层(\d+)/);
      const id = match ? match[1] : '?';
      return `摘要${id}\n${e.content}`;
    });
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
  mini_summaries: WorldbookEntry[]
): Promise<string> {
  const settings = getSettings();
  const volumes = await getVolumes();

  const miniContents = mini_summaries.map(e => {
    const match = e.name.match(/楼层(\d+)/);
    const id = match ? match[1] : '?';
    return `摘要${id}\n${e.content}`;
  });
  const previousVolumeContents = volumes
    .sort((a, b) => {
      const aVol = parseInt(a.name.match(/卷(\d+)/)![1]);
      const bVol = parseInt(b.name.match(/卷(\d+)/)![1]);
      return aVol - bVol;
    })
    .map(e => e.content);

  const prompt = getVolumeSummaryPrompt(miniContents, previousVolumeContents);
  return await callAI(prompt.system, prompt.user, settings);
}

/** 执行完整的大总结流程 */
export async function performVolumeSummary(): Promise<void> {
  // 世界书不存在则跳过
  if (!worldbookExists()) {
    console.warn('[自动总结] 世界书不存在，跳过大总结生成');
    return;
  }

  const meta = await getMetaData();
  const unarchivedEntries = await getUnarchivedMiniSummaries();

  if (unarchivedEntries.length === 0) return;

  // 先检查是否满足大总结条件
  const shouldTrigger = await shouldTriggerVolumeSummary();
  if (!shouldTrigger) return;

  // 提取楼层 ID 范围
  const ids = unarchivedEntries
    .map(e => parseInt(e.name.match(/楼层(\d+)/)![1]))
    .sort((a, b) => a - b);

  let start_id = ids[0];
  let end_id = ids[ids.length - 1];

  // 生成大总结
  const content = await generateVolumeSummaryContent(unarchivedEntries);

  // 尝试提取设定的范围
  const match = content.match(/摘要(\d+)-摘要(\d+)/);
  if (match) {
    const parsedStart = parseInt(match[1]);
    const parsedEnd = parseInt(match[2]);
    if (parsedStart <= parsedEnd) {
      start_id = parsedStart;
      end_id = parsedEnd;
    } else {
      console.warn(
        `[自动总结] AI 输出的范围(摘要${parsedStart}-摘要${parsedEnd})无效，回退使用全范围`
      );
    }
  } else {
    console.warn('[自动总结] 卷总结中未找到有效的首尾范围标记，回退使用全范围');
  }

  // 清除结尾的指定标记行并存入
  const finalContent = content.replace(/\s*摘要\d+-摘要\d+\s*$/, '').trim();

  // 创建卷条目并关闭对应小总结
  await createVolumeEntry(meta.current_volume, start_id, end_id, finalContent);

  console.log(`[自动总结] 已归档卷${meta.current_volume}: 楼层${start_id}~楼层${end_id}`);
}
