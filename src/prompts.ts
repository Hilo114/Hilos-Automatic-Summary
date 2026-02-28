/**
 * AI 总结提示词模板
 * - 支持自定义提示词覆盖默认值
 */

import { getSettings } from '@/config';

// ========== 默认提示词 ==========

/** 小总结系统提示词（默认） */
export const DEFAULT_MINI_SUMMARY_SYSTEM = `你是一个专业的故事总结助手。你的任务是将角色扮演聊天记录中的一条消息总结为简洁的小总结。

要求：
1. 保留关键情节、角色行为、情感变化和重要对话
2. 使用第三人称叙述
3. 总结应简洁明了，控制在 300 字以内
4. 不要添加任何评论、分析或你自己的想法
5. 只输出总结内容，不要添加标题、编号或其他格式`;

/** 大总结系统提示词（默认） */
export const DEFAULT_VOLUME_SUMMARY_SYSTEM = `你是一个专业的故事总结助手。你的任务是将一系列小总结合并为一个完整的卷总结。

要求：
1. 将所有小总结的内容整合为连贯的叙述
2. 保留主要情节线、角色发展、关键事件和重要对话
3. 按时间顺序组织内容
4. 使用第三人称叙述
5. 总结应全面但精炼，控制在 2000 字以内
6. 不要添加任何评论、分析或你自己的想法
7. 若当前提供的内容不满足完整一卷的情节，可选取上半卷/部分连续的内容进行总结
8. 在总结的最末尾，你必须单独起一行输出你此次总结的内容范围，格式为：摘要x-摘要y（例如：摘要100-摘要150）
9. 除总结内容和尾部的范围标记外，不要添加标题、编号或其他多余格式`;

/** 卷完结检测系统提示词（默认） */
export const DEFAULT_VOLUME_COMPLETION_CHECK_SYSTEM = `你是一个故事分析助手。根据以下总结内容，判断当前这一卷故事是否已经达到了一个自然的段落结尾（如：一个章节结束、一个事件告一段落、场景大幅转换等）。

只需回答"114514"或"1919810"，不要做任何解释。
- 回答"114514"表示这一卷已经到了一个合适的断点，可以归档
- 回答"1919810"表示故事仍在进行中，不适合在这里断开`;

// ========== 获取有效提示词 ==========

/** 获取当前生效的小总结系统提示词 */
function getMiniSummarySystemPrompt(): string {
  const settings = getSettings();
  return settings.custom_prompts.mini_summary_system || DEFAULT_MINI_SUMMARY_SYSTEM;
}

/** 获取当前生效的大总结系统提示词 */
function getVolumeSummarySystemPrompt(): string {
  const settings = getSettings();
  return settings.custom_prompts.volume_summary_system || DEFAULT_VOLUME_SUMMARY_SYSTEM;
}

/** 获取当前生效的卷完结检测系统提示词 */
function getVolumeCompletionCheckSystemPrompt(): string {
  const settings = getSettings();
  return (
    settings.custom_prompts.volume_completion_check_system || DEFAULT_VOLUME_COMPLETION_CHECK_SYSTEM
  );
}

// ========== 提示词构建 ==========

/** 小总结提示词 */
export function getMiniSummaryPrompt(
  message: string,
  context: string
): { system: string; user: string } {
  let userPrompt = '';
  if (context) {
    userPrompt += `以下是之前的总结，供你了解上下文：\n${context}\n\n---\n\n`;
  }
  userPrompt += `请总结以下消息：\n\n${message}`;

  return {
    system: getMiniSummarySystemPrompt(),
    user: userPrompt,
  };
}

/** 大总结提示词 */
export function getVolumeSummaryPrompt(
  mini_summaries: string[],
  previous_volumes: string[]
): { system: string; user: string } {
  let userPrompt = '';
  if (previous_volumes.length > 0) {
    userPrompt += `以下是之前各卷的大总结，供你了解前情：\n\n`;
    previous_volumes.forEach((vol, i) => {
      userPrompt += `--- 第${i + 1}卷 ---\n${vol}\n\n`;
    });
    userPrompt += `===\n\n`;
  }
  userPrompt += `请将以下小总结合并为一个连贯的阶段性卷总结：\n\n`;
  mini_summaries.forEach(summary => {
    userPrompt += `${summary}\n\n`;
  });

  return {
    system: getVolumeSummarySystemPrompt(),
    user: userPrompt,
  };
}

/** 卷完结检测提示词 */
export function getVolumeCompletionCheckPrompt(mini_summaries: string[]): {
  system: string;
  user: string;
} {
  let userPrompt = `以下是最近一段时间的小总结序列：\n\n`;
  mini_summaries.forEach(summary => {
    userPrompt += `${summary}\n\n`;
  });
  userPrompt += `请判断以上内容是否已经到了一个自然的段落结尾？`;

  return {
    system: getVolumeCompletionCheckSystemPrompt(),
    user: userPrompt,
  };
}
