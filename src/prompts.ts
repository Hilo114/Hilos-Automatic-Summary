/**
 * AI 总结提示词模板
 */

/** 小总结系统提示词 */
const MINI_SUMMARY_SYSTEM = `你是一个专业的故事总结助手。你的任务是将角色扮演聊天记录中的一条消息总结为简洁的小总结。

要求：
1. 保留关键情节、角色行为、情感变化和重要对话
2. 使用第三人称叙述
3. 总结应简洁明了，控制在 200 字以内
4. 不要添加任何评论、分析或你自己的想法
5. 只输出总结内容，不要添加标题、编号或其他格式`;

/** 小总结提示词 */
export function getMiniSummaryPrompt(
    message: string,
    context: string,
): { system: string; user: string } {
    let userPrompt = '';
    if (context) {
        userPrompt += `以下是之前的总结，供你了解上下文：\n${context}\n\n---\n\n`;
    }
    userPrompt += `请总结以下消息：\n\n${message}`;

    return {
        system: MINI_SUMMARY_SYSTEM,
        user: userPrompt,
    };
}

/** 大总结系统提示词 */
const VOLUME_SUMMARY_SYSTEM = `你是一个专业的故事总结助手。你的任务是将一系列小总结合并为一个完整的卷总结。

要求：
1. 将所有小总结的内容整合为连贯的叙述
2. 保留主要情节线、角色发展、关键事件和重要对话
3. 按时间顺序组织内容
4. 使用第三人称叙述
5. 总结应全面但精炼，控制在 1000 字以内
6. 不要添加任何评论、分析或你自己的想法
7. 只输出总结内容，不要添加标题、编号或其他格式`;

/** 大总结提示词 */
export function getVolumeSummaryPrompt(
    mini_summaries: string[],
    previous_volumes: string[],
): { system: string; user: string } {
    let userPrompt = '';
    if (previous_volumes.length > 0) {
        userPrompt += `以下是之前各卷的大总结，供你了解前情：\n\n`;
        previous_volumes.forEach((vol, i) => {
            userPrompt += `--- 第${i + 1}卷 ---\n${vol}\n\n`;
        });
        userPrompt += `===\n\n`;
    }
    userPrompt += `请将以下小总结合并为一个完整的卷总结：\n\n`;
    mini_summaries.forEach((summary, i) => {
        userPrompt += `[${i + 1}] ${summary}\n\n`;
    });

    return {
        system: VOLUME_SUMMARY_SYSTEM,
        user: userPrompt,
    };
}

/** 卷完结检测系统提示词 */
const VOLUME_COMPLETION_CHECK_SYSTEM = `你是一个故事分析助手。根据以下总结内容，判断当前这一卷故事是否已经达到了一个自然的段落结尾（如：一个章节结束、一个事件告一段落、场景大幅转换等）。

只需回答"114514"或"1919810"，不要做任何解释。
- 回答"114514"表示这一卷已经到了一个合适的断点，可以归档
- 回答"1919810"表示故事仍在进行中，不适合在这里断开`;

/** 卷完结检测提示词 */
export function getVolumeCompletionCheckPrompt(mini_summaries: string[]): {
    system: string;
    user: string;
} {
    let userPrompt = `以下是最近一段时间的小总结序列：\n\n`;
    mini_summaries.forEach((summary, i) => {
        userPrompt += `[${i + 1}] ${summary}\n\n`;
    });
    userPrompt += `请判断以上内容是否已经到了一个自然的段落结尾？`;

    return {
        system: VOLUME_COMPLETION_CHECK_SYSTEM,
        user: userPrompt,
    };
}
