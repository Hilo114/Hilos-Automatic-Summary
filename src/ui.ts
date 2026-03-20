/**
 * 设置 UI 弹窗
 * - 通过酒馆扩展菜单入口打开
 * - 提供各项设置与手动操作按钮
 */

import { getScriptData, saveScriptData, DEFAULT_SETTINGS, type ScriptDataType } from '@/config';
import { taskQueue } from '@/queue';
import {
  createWorldbookForChat,
  bindWorldbookForChat,
  worldbookExists,
  getWorldbookName,
} from '@/worldbook';
import {
  DEFAULT_MINI_SUMMARY_SYSTEM,
  DEFAULT_VOLUME_SUMMARY_SYSTEM,
  DEFAULT_VOLUME_COMPLETION_CHECK_SYSTEM,
} from '@/prompts';

// ========== 菜单注入 ==========

const MENU_ID = 'hilo-auto-summary-menu';

/** 向扩展菜单注入入口 */
export function addMenuItem(): void {
  const $extensionsMenu = $('#extensionsMenu');
  if (!$extensionsMenu.length) {
    setTimeout(addMenuItem, 2000);
    return;
  }

  // 移除旧的菜单项（脚本重载后旧的点击处理函数已失效）
  $(`#${MENU_ID}`, $extensionsMenu).remove();

  const $item = $(`
    <div class="list-group-item flex-container flexGap5 interactable" id="${MENU_ID}" title="自动总结设置">
      <div class="fa-fw fa-solid fa-book-open extensionsMenuExtensionButton"></div>
      <span>自动总结</span>
    </div>
  `);

  $item.on('click', async e => {
    e.stopPropagation();
    const $menuBtn = $('#extensionsMenuButton');
    if ($menuBtn.length && $extensionsMenu.is(':visible')) {
      $menuBtn.trigger('click');
      await new Promise(r => setTimeout(r, 150));
    }
    await openSettingsPopup();
  });

  $extensionsMenu.append($item);
}

// ========== 设置弹窗 ==========

/** 安全获取世界书名列表（未打开聊天时返回空数组） */
function safeGetWorldbookNames(): string[] {
  try {
    return getWorldbookNames();
  } catch {
    return [];
  }
}

/** 构建设置弹窗 HTML */
function buildSettingsHtml(data: ScriptDataType): string {
  const currentWbName = getWorldbookName();
  const wbNames = safeGetWorldbookNames();

  return `
    <div id="hilo-summary-settings" style="padding: 10px;">
      <style>
        #hilo-summary-settings input[type="text"],
        #hilo-summary-settings input[type="number"],
        #hilo-summary-settings input[type="password"],
        #hilo-summary-settings select,
        #hilo-summary-settings textarea {
          background-color: var(--SmartThemeSurface, #1c1c1c);
          color: var(--SmartThemeBodyColor, #eee);
          border: 1px solid var(--SmartThemeBorderColor, #444);
          border-radius: 4px;
          padding: 4px 8px;
        }
        #hilo-summary-settings input[type="text"]:focus,
        #hilo-summary-settings input[type="number"]:focus,
        #hilo-summary-settings input[type="password"]:focus,
        #hilo-summary-settings select:focus,
        #hilo-summary-settings textarea:focus {
          border-color: var(--SmartThemeFocusColor, #888);
          outline: none;
        }
        /* 开关行 */
        .hs-toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px; padding: 6px 8px;
          border-radius: 6px;
          background: var(--SmartThemeSurface, rgba(255,255,255,0.04));
        }
        .hs-toggle-row .hs-toggle-label { font-size: 14px; }
        .hs-toggle-row .hs-toggle-hint  { font-size: 11px; color: #888; margin-left: 4px; }
        /* 开关样式 */
        .hs-switch { position: relative; width: 40px; height: 22px; flex-shrink: 0; margin-left: 8px; }
        .hs-switch input { opacity: 0; width: 0; height: 0; }
        .hs-switch .hs-slider {
          position: absolute; cursor: pointer; inset: 0;
          background: var(--SmartThemeBorderColor, #555);
          border-radius: 22px; transition: background .2s;
        }
        .hs-switch .hs-slider::before {
          content: ""; position: absolute; width: 16px; height: 16px;
          left: 3px; bottom: 3px; background: #fff;
          border-radius: 50%; transition: transform .2s;
        }
        .hs-switch input:checked + .hs-slider { background: var(--SmartThemeQuoteColor, #4caf50); }
        .hs-switch input:checked + .hs-slider::before { transform: translateX(18px); }
      </style>
      <h3 style="margin-top: 0;">📖 自动总结设置</h3>

      <!-- 世界书管理 -->
      <div style="margin-bottom: 15px;">
        <h4>世界书管理</h4>
        <div style="margin-bottom: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <label style="white-space: nowrap; flex-shrink: 0;">当前世界书：</label>
          <select id="hs-worldbook-select" style="flex: 1; min-width: 0; max-width: 200px;">
            <option value=""${!currentWbName ? ' selected' : ''}>（未绑定）</option>
            ${wbNames
              .map(
                name =>
                  `<option value="${escapeHtml(name)}" ${currentWbName === name ? 'selected' : ''}>${escapeHtml(name)}</option>`
              )
              .join('')}
          </select>
          <button id="hs-create-worldbook" class="menu_button" style="white-space: nowrap;">一键创建</button>
        </div>
      </div>

      <!-- 基本设置 -->
      <div style="margin-bottom: 15px;">
        <h4>基本设置</h4>
        <div style="margin-bottom: 8px;">
          <label>显示楼层数：</label>
          <input type="number" id="hs-visible-floors" value="${data.visible_floors}" min="1" max="100" style="width: 80px;" />
          <small style="color: #888;">（最近保留多少楼可见）</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>检查间隔：</label>
          <input type="number" id="hs-check-interval" value="${data.check_interval}" min="5" max="100" style="width: 80px;" />
          <small style="color: #888;">（每多少个小总结检查一次大总结）</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>Token 阈值：</label>
          <input type="number" id="hs-volume-token-threshold" value="${data.volume_token_threshold}" min="1000" max="50000" style="width: 100px;" />
          <small style="color: #888;">（大总结触发阈值）</small>
        </div>
        <div class="hs-toggle-row">
          <span class="hs-toggle-label">自动小总结</span>
          <label class="hs-switch"><input type="checkbox" id="hs-auto-mini-summary" ${data.auto_mini_summary ? 'checked' : ''} /><span class="hs-slider"></span></label>
        </div>
        <div class="hs-toggle-row">
          <span class="hs-toggle-label">自动大总结</span>
          <label class="hs-switch"><input type="checkbox" id="hs-auto-volume-summary" ${data.auto_volume_summary ? 'checked' : ''} /><span class="hs-slider"></span></label>
        </div>
        <div style="margin-bottom: 8px; margin-left: 20px; padding: 8px; border-left: 2px solid var(--SmartThemeBorderColor, #444);">
          <label style="margin-right: 12px;">
            <input type="radio" name="hs-volume-trigger-mode" value="ai" ${data.volume_trigger_mode === 'ai' ? 'checked' : ''} />
            AI判断触发
          </label>
          <label>
            <input type="radio" name="hs-volume-trigger-mode" value="count" ${data.volume_trigger_mode === 'count' ? 'checked' : ''} />
            消息数触发
          </label>
          <div id="hs-trigger-count-row" style="margin-top: 6px; display: ${data.volume_trigger_mode === 'count' ? 'block' : 'none'};">
            <label>触发数量：</label>
            <input type="number" id="hs-volume-trigger-count" value="${data.volume_trigger_count}" min="1" max="500" style="width: 80px;" />
            <small style="color: #888;">（每多少个小总结触发一次大总结）</small>
          </div>
        </div>
        <div class="hs-toggle-row">
          <span class="hs-toggle-label">延迟总结</span>
          <label class="hs-switch"><input type="checkbox" id="hs-deferred-summary" ${data.deferred_summary ? 'checked' : ''} /><span class="hs-slider"></span></label>
        </div>
        <div style="margin-bottom: 8px; margin-top: -4px; padding-left: 8px;">
          <small style="color: #888;">启用后将在下一次回复到达后才对上一条消息进行总结</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>小总结注入深度：</label>
          <input type="number" id="hs-mini-summary-depth" value="${data.mini_summary_depth}" min="0" max="99999" style="width: 100px;" />
          <small style="color: #888;">（默认 9999）</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>卷总结注入深度：</label>
          <input type="number" id="hs-volume-summary-depth" value="${data.volume_summary_depth}" min="0" max="99999" style="width: 100px;" />
          <small style="color: #888;">（默认 9999）</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>小总结起始排序：</label>
          <input type="number" id="hs-mini-start-order" value="${data.mini_summary_start_order}" min="0" max="99999" style="width: 100px;" />
          <small style="color: #888;">（小总结 order 基数，默认 10000）</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>卷总结起始排序：</label>
          <input type="number" id="hs-volume-start-order" value="${data.volume_start_order}" min="0" max="99999" style="width: 100px;" />
          <small style="color: #888;">（卷总结 order 基数，默认 100）</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>忽略前 N 层：</label>
          <input type="number" id="hs-ignore-floors" value="${data.ignore_floors}" min="0" max="1000" style="width: 80px;" />
          <small style="color: #888;">（跳过前多少层不进行总结）</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>任务冷却间隔：</label>
          <input type="number" id="hs-task-cooldown" value="${data.task_cooldown}" min="0" max="300" style="width: 80px;" />
          <small style="color: #888;">（秒，防并发冲突与 API 速率限制）</small>
        </div>
        <div style="margin-bottom: 8px;">
          <label>最大回复 Token：</label>
          <input type="number" id="hs-max-tokens" value="${data.max_tokens}" min="0" max="128000" style="width: 100px;" />
          <small style="color: #888;">（0 = 跟随预设，建议 300~2000）</small>
        </div>
        <!-- 内容捕获标签 -->
        <details style="margin-bottom: 8px;">
          <summary style="cursor: pointer;">内容捕获标签 <small style="color: #888;">（仅总结标签之间的内容，列表为空则总结全部）</small></summary>
          <div style="padding: 8px 0;">
            <div id="hs-capture-tags-list">
              ${data.capture_tags.map((t, i) => buildCaptureTagRowHtml(t, i)).join('')}
            </div>
            <button id="hs-add-capture-tag" class="menu_button" style="white-space: nowrap; flex: 1; padding: 5px 0;">+ 添加捕获标签</button>
          </div>
        </details>
        <div style="margin-bottom: 8px;">
          <label>
            <input type="checkbox" id="hs-no-trans-tag" ${data.no_trans_tag ? 'checked' : ''} />
            防合并标记
          </label>
          <input type="text" id="hs-no-trans-tag-value" value="${escapeHtml(data.no_trans_tag_value)}" style="width: 100px; margin-left: 5px;" placeholder="<|no-trans|>" title="自定义防合并标记" />
          <small style="color: #888; margin-left: 5px;">（kemini或noass脚本开）</small>
        </div>
      </div>

      <!-- 手动操作 -->
      <div style="margin-bottom: 15px;">
        <h4>手动操作</h4>
        <div style="display: flex; gap: 8px; flex-wrap: nowrap;">
          <button id="hs-manual-mini" class="menu_button" style="white-space: nowrap; flex: 1; padding: 5px 0;">手动总结</button>
          <button id="hs-manual-volume" class="menu_button" style="white-space: nowrap; flex: 1; padding: 5px 0;">手动归档</button>
          <button id="hs-manual-complete" class="menu_button" style="white-space: nowrap; flex: 1; padding: 5px 0;">手动补全</button>
        </div>
      </div>

      <!-- API 配置 -->
      <div style="margin-bottom: 15px;">
        <h4>API 配置</h4>
        <div style="margin-bottom: 8px;">
          <label>API URL：</label>
          <input type="text" id="hs-custom-api-url" value="${escapeHtml(data.custom_api.apiurl)}" style="width: 100%;" placeholder="https://api.example.com/v1" />
        </div>
        <div style="margin-bottom: 8px;">
          <label>API Key：</label>
          <input type="password" id="hs-custom-api-key" value="${escapeHtml(data.custom_api.key)}" style="width: 100%;" placeholder="sk-..." />
        </div>
        <div style="margin-bottom: 8px;">
          <label>模型：</label>
          <div style="display: flex; gap: 5px; align-items: center;">
            <select id="hs-custom-api-model-select" style="flex: 1; min-width: 0;">
              <option value=""${!data.custom_api.model ? ' selected' : ''}>（手动输入）</option>
              ${data.custom_api.model ? `<option value="${escapeHtml(data.custom_api.model)}" selected>${escapeHtml(data.custom_api.model)}</option>` : ''}
            </select>
            <button id="hs-fetch-models" class="menu_button" style="white-space: nowrap; padding: 4px 10px;">获取模型</button>
          </div>
          <div style="margin-top: 5px;">
            <input type="text" id="hs-custom-api-model" value="${escapeHtml(data.custom_api.model)}" style="width: 100%;" placeholder="输入模型名称，如 gpt-4o" />
          </div>
        </div>
        <div style="margin-bottom: 8px;">
          <label>API 源：</label>
          <select id="hs-custom-api-source" style="width: 100%;">
            ${['openai']
              .map(
                s =>
                  `<option value="${s}" ${data.custom_api.source === s ? 'selected' : ''}>${s}</option>`
              )
              .join('')}
          </select>
        </div>
      </div>

      <!-- 自定义提示词 -->
      <details style="margin-bottom: 15px;">
        <summary><h4 style="display: inline;">自定义提示词</h4></summary>
        <div style="padding: 8px 0;">
          <div style="margin-bottom: 8px;">
            <label>小总结系统提示词：</label>
            <textarea id="hs-prompt-mini" rows="5" style="width: 100%; resize: vertical;" placeholder="使用默认提示词">${escapeHtml(data.custom_prompts.mini_summary_system || DEFAULT_MINI_SUMMARY_SYSTEM)}</textarea>
            <small style="color: #888;">（修改后即为自定义；恢复默认请清空提示词并保存）</small>
          </div>
          <div style="margin-bottom: 8px;">
            <label>大总结系统提示词：</label>
            <textarea id="hs-prompt-volume" rows="5" style="width: 100%; resize: vertical;" placeholder="使用默认提示词">${escapeHtml(data.custom_prompts.volume_summary_system || DEFAULT_VOLUME_SUMMARY_SYSTEM)}</textarea>
            <small style="color: #888;">（修改后即为自定义；恢复默认请清空提示词并保存）</small>
          </div>
          <div style="margin-bottom: 8px;">
            <label>卷完结检测系统提示词：</label>
            <textarea id="hs-prompt-completion" rows="5" style="width: 100%; resize: vertical;" placeholder="使用默认提示词">${escapeHtml(data.custom_prompts.volume_completion_check_system || DEFAULT_VOLUME_COMPLETION_CHECK_SYSTEM)}</textarea>
            <small style="color: #888; display: block; margin-top: 4px;">
              （修改后即为自定义；恢复默认清空即可）
            </small>
          </div>
        </div>
      </details>

      <!-- 消息清洗 -->
      <details style="margin-bottom: 15px;">
        <summary><h4 style="display: inline;">消息清洗正则</h4></summary>
        <div style="padding: 8px 0;">
          <div id="hs-regex-list">
            ${data.message_cleanup_regex.map((r, i) => buildRegexRowHtml(r, i)).join('')}
          </div>
          <button id="hs-add-regex" class="menu_button" style="white-space: nowrap; flex: 1; padding: 5px 0;">+ 添加正则</button>
        </div>
      </details>
    </div>
  `;
}

/** 构建单行捕获标签 HTML */
function buildCaptureTagRowHtml(
  tag: { start_tag: string; end_tag: string },
  index: number
): string {
  return `
    <div class="hs-capture-tag-row" data-index="${index}" style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
      <span>&lt;</span>
      <input type="text" class="hs-capture-start-tag" value="${escapeHtml(tag.start_tag)}" placeholder="起始标签" style="flex: 1;" />
      <span>&gt; … &lt;</span>
      <input type="text" class="hs-capture-end-tag" value="${escapeHtml(tag.end_tag)}" placeholder="结束标签" style="flex: 1;" />
      <span>&gt;</span>
      <button class="hs-remove-capture-tag menu_button" style="flex: 0 0 auto; padding: 2px 8px;">✕</button>
    </div>
  `;
}

/** 从弹窗收集捕获标签数据 */
function collectCaptureTagsFromPopup(): { start_tag: string; end_tag: string }[] {
  const tagRows = $('.hs-capture-tag-row');
  const tagList: { start_tag: string; end_tag: string }[] = [];
  tagRows.each(function () {
    const $row = $(this);
    const startTag = (($row.find('.hs-capture-start-tag').val() as string) || '').trim();
    const endTag = (($row.find('.hs-capture-end-tag').val() as string) || '').trim();
    // 保留至少有一个标签不为空的行
    if (startTag || endTag) {
      tagList.push({ start_tag: startTag, end_tag: endTag });
    }
  });
  return tagList;
}

/** 构建单行正则 HTML */
function buildRegexRowHtml(
  regex: { pattern: string; flags: string; replacement: string },
  index: number
): string {
  return `
    <div class="hs-regex-row" data-index="${index}" style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
      <input type="text" class="hs-regex-pattern" value="${escapeHtml(regex.pattern)}" placeholder="正则" style="flex: 3;" />
      <input type="text" class="hs-regex-flags" value="${escapeHtml(regex.flags)}" placeholder="flags" style="flex: 1; max-width: 60px;" />
      <input type="text" class="hs-regex-replacement" value="${escapeHtml(regex.replacement)}" placeholder="替换" style="flex: 2;" />
      <button class="hs-remove-regex menu_button" style="flex: 0 0 auto; padding: 2px 8px;">✕</button>
    </div>
  `;
}

/** HTML 转义 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** 从弹窗收集设置数据 */
function collectSettingsFromPopup(): Partial<ScriptDataType> {
  const regexRows = $('.hs-regex-row');
  const regexList: { pattern: string; flags: string; replacement: string }[] = [];
  regexRows.each(function () {
    const $row = $(this);
    const pattern = $row.find('.hs-regex-pattern').val() as string;
    if (pattern) {
      regexList.push({
        pattern,
        flags: ($row.find('.hs-regex-flags').val() as string) || 'g',
        replacement: ($row.find('.hs-regex-replacement').val() as string) || '',
      });
    }
  });

  const miniPrompt = (($('#hs-prompt-mini').val() as string) || '').trim();
  const volumePrompt = (($('#hs-prompt-volume').val() as string) || '').trim();
  const completionPrompt = (($('#hs-prompt-completion').val() as string) || '').trim();

  return {
    visible_floors: parseInt($('#hs-visible-floors').val() as string) || 20,
    check_interval: parseInt($('#hs-check-interval').val() as string) || 20,
    volume_token_threshold: parseInt($('#hs-volume-token-threshold').val() as string) || 8000,
    auto_mini_summary: $('#hs-auto-mini-summary').is(':checked'),
    auto_volume_summary: $('#hs-auto-volume-summary').is(':checked'),
    volume_trigger_mode: (($('input[name="hs-volume-trigger-mode"]:checked').val() as string) ||
      'ai') as 'ai' | 'count',
    volume_trigger_count: parseInt($('#hs-volume-trigger-count').val() as string) || 10,
    deferred_summary: $('#hs-deferred-summary').is(':checked'),
    mini_summary_depth: parseInt($('#hs-mini-summary-depth').val() as string) || 9999,
    volume_summary_depth: parseInt($('#hs-volume-summary-depth').val() as string) || 9999,
    mini_summary_start_order: parseInt($('#hs-mini-start-order').val() as string) || 10000,
    volume_start_order: parseInt($('#hs-volume-start-order').val() as string) || 100,
    ignore_floors: parseInt($('#hs-ignore-floors').val() as string) || 0,
    task_cooldown: parseInt($('#hs-task-cooldown').val() as string) || 5,
    max_tokens: parseInt($('#hs-max-tokens').val() as string) || 0,
    capture_tags: collectCaptureTagsFromPopup(),
    no_trans_tag: $('#hs-no-trans-tag').is(':checked'),
    no_trans_tag_value: (($('#hs-no-trans-tag-value').val() as string) || '').trim(),
    custom_api: {
      apiurl: ($('#hs-custom-api-url').val() as string) || '',
      key: ($('#hs-custom-api-key').val() as string) || '',
      model: ($('#hs-custom-api-model').val() as string) || '',
      source: ($('#hs-custom-api-source').val() as string) || 'openai',
    },
    custom_prompts: {
      mini_summary_system: miniPrompt === DEFAULT_MINI_SUMMARY_SYSTEM.trim() ? '' : miniPrompt,
      volume_summary_system:
        volumePrompt === DEFAULT_VOLUME_SUMMARY_SYSTEM.trim() ? '' : volumePrompt,
      volume_completion_check_system:
        completionPrompt === DEFAULT_VOLUME_COMPLETION_CHECK_SYSTEM.trim() ? '' : completionPrompt,
    },
    message_cleanup_regex: regexList,
  };
}

/** 打开设置弹窗 */
async function openSettingsPopup(): Promise<void> {
  const data = getScriptData();
  const html = buildSettingsHtml(data);

  const $popup = $(html);

  $popup.css({
    flex: '1',
    'overflow-y': 'auto',
    'min-height': '0',
    'padding-right': '5px',
  });

  // 使用酒馆的 callGenericPopup或创建简单弹窗
  const $overlay = $(`<div id="hilo-summary-overlay"></div>`);

  const $dialog = $(`<div id="hilo-summary-dialog"></div>`);

  const $buttons =
    $(`<div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; flex-shrink: 0; padding-top: 10px; border-top: 1px solid var(--SmartThemeBorderColor, #555);">
    <button id="hs-reset" class="menu_button" style="margin-right: auto; white-space: nowrap; padding: 5px 15px;">重置默认</button>
    <button id="hs-cancel" class="menu_button" style="white-space: nowrap; padding: 5px 15px;">取消</button>
    <button id="hs-save" class="menu_button" style="white-space: nowrap; padding: 5px 15px;">保存</button>
  </div>`);

  $dialog.append($popup).append($buttons);
  $overlay.append($dialog);
  $('body').append($overlay);

  const win = window.top || window;
  const fitOverlay = () => {
    const vp = win.visualViewport || {
      width: win.innerWidth,
      height: win.innerHeight,
      offsetTop: 0,
      offsetLeft: 0,
    };
    const w = vp.width || win.innerWidth;
    const h = vp.height || win.innerHeight;
    $overlay[0].style.cssText = `
      position: fixed !important; top: ${vp.offsetTop || 0}px !important; left: ${vp.offsetLeft || 0}px !important;
      width: ${w}px !important; height: ${h}px !important;
      max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
      z-index: 10000 !important; display: flex !important; align-items: center !important; justify-content: center !important;
      background: rgba(0,0,0,0.6) !important;
      overflow: hidden !important;
    `;
    const panel = $dialog[0];
    if (panel && w <= 768) {
      panel.style.cssText = `
        background: var(--SmartThemeBlurTintColor, #2b2b2b) !important;
        border: none !important;
        border-radius: 0 !important; padding: 15px !important;
        width: ${w}px !important; height: ${h}px !important;
        max-width: none !important; max-height: none !important; margin: 0 !important;
        display: flex !important; flex-direction: column !important;
        color: var(--SmartThemeBodyColor, #ccc) !important;
        box-sizing: border-box !important;
      `;
    } else if (panel) {
      panel.style.cssText = `
        background: var(--SmartThemeBlurTintColor, #2b2b2b) !important;
        border: 1px solid var(--SmartThemeBorderColor, #555) !important;
        border-radius: 10px !important; padding: 20px !important; width: 90vw !important;
        min-width: 300px !important; max-width: 700px !important; max-height: 90vh !important;
        display: flex !important; flex-direction: column !important;
        color: var(--SmartThemeBodyColor, #ccc) !important;
        box-sizing: border-box !important;
      `;
    }
  };

  fitOverlay();
  const vpObj = win.visualViewport;
  if (vpObj) {
    vpObj.addEventListener('resize', fitOverlay);
    vpObj.addEventListener('scroll', fitOverlay);
  }
  win.addEventListener('resize', fitOverlay);

  const cleanupResize = () => {
    if (vpObj) {
      vpObj.removeEventListener('resize', fitOverlay);
      vpObj.removeEventListener('scroll', fitOverlay);
    }
    win.removeEventListener('resize', fitOverlay);
  };

  const closeOverlay = () => {
    cleanupResize();
    $overlay.remove();
  };

  // 事件绑定
  $overlay.on('click', '#hs-cancel', () => {
    closeOverlay();
  });

  // 重置默认设置
  $overlay.on('click', '#hs-reset', () => {
    const currentData = getScriptData();
    // 重置用户设置（运行时元数据存在世界书中，不受影响）
    const resetData = { ...DEFAULT_SETTINGS } as ScriptDataType;
    saveScriptData(resetData);
    toastr.success('已重置为默认设置');
    closeOverlay();
    // 重新打开弹窗以刷新 UI
    void openSettingsPopup();
  });

  $overlay.on('click', '#hs-save', () => {
    const newSettings = collectSettingsFromPopup();
    const currentData = getScriptData();
    const merged = { ...currentData, ...newSettings };
    saveScriptData(merged as ScriptDataType);
    toastr.success('设置已保存');
    closeOverlay();
  });

  // 世界书选择变更
  $overlay.on('change', '#hs-worldbook-select', async function () {
    const selected = $(this).val() as string;
    if (selected) {
      try {
        await bindWorldbookForChat(selected);
        toastr.success(`已绑定世界书: ${selected}`);
      } catch (e) {
        toastr.error(`绑定世界书失败: ${selected}`);
        console.error('[自动总结] 绑定世界书失败:', e);
      }
    } else {
      // 解绑：绑定空字符串以解除
      await rebindChatWorldbook('current', '');
      toastr.info('已解除世界书绑定');
    }
  });

  // 一键创建世界书
  $overlay.on('click', '#hs-create-worldbook', async () => {
    try {
      const name = await createWorldbookForChat();
      // 刷新下拉框
      const $select = $('#hs-worldbook-select');
      // 如果下拉框中没有该选项则添加
      if ($select.find(`option[value="${escapeHtml(name)}"]`).length === 0) {
        $select.append(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
      }
      $select.val(name);
      toastr.success(`已创建并绑定世界书: ${name}`);
    } catch (e) {
      toastr.error('创建世界书失败');
      console.error('[自动总结] 创建世界书失败:', e);
    }
  });

  // 手动总结
  $overlay.on('click', '#hs-manual-mini', () => {
    const lastId = getLastMessageId();
    if (lastId >= 0) {
      taskQueue.enqueue({ type: 'mini_summary', message_id: lastId });
      toastr.info(`已将楼层 ${lastId} 的小总结任务加入队列`);
    } else {
      toastr.warning('当前没有聊天消息');
    }
  });

  // 手动归档
  $overlay.on('click', '#hs-manual-volume', () => {
    taskQueue.enqueue({ type: 'volume_summary' });
    toastr.info('已将大总结任务加入队列');
  });

  // 手动补全
  $overlay.on('click', '#hs-manual-complete', async () => {
    const data = getScriptData();
    const lastId = getLastMessageId();

    const startId = data.ignore_floors;
    if (startId > lastId) {
      toastr.warning('没有可以补全的楼层（都在忽略范围内）');
      return;
    }

    const wbName = getWorldbookName();
    if (!wbName) {
      toastr.warning('当前聊天未绑定世界书，无法检查补全');
      return;
    }

    toastr.info('正在检查缺失层数...');
    try {
      const wb = await getWorldbook(wbName);
      const existingFloors = new Set<number>();
      for (const entry of wb) {
        const match = entry.name.match(/^\[小总结-楼层(\d+)\]$/);
        if (match) {
          existingFloors.add(parseInt(match[1]));
        }
      }

      let count = 0;
      const msgs = getChatMessages(`${startId}-${lastId}`);
      for (const msg of msgs) {
        // 仅处理 AI 消息（排除 user 和 system 消息）
        if (msg.role === 'user' || msg.role === 'system') continue;

        if (!existingFloors.has(msg.message_id)) {
          taskQueue.enqueue({ type: 'mini_summary', message_id: msg.message_id });
          count++;
        }
      }

      if (count > 0) {
        taskQueue.enqueue({ type: 'volume_summary' });
        toastr.success(`检测到 ${count} 个缺失楼层，已全部加入补全队列，并在最后加入归档任务`);
      } else {
        toastr.info('所有楼层均已有对应小总结，无需补全');
      }
    } catch (e) {
      toastr.error('获取世界书条目失败，无法补全');
      console.error('[自动总结] 手动补全检查失败:', e);
    }
  });

  // 获取模型列表
  $overlay.on('click', '#hs-fetch-models', async () => {
    const apiUrl = (($('#hs-custom-api-url').val() as string) || '').trim();
    const apiKey = (($('#hs-custom-api-key').val() as string) || '').trim();

    if (!apiUrl) {
      toastr.warning('请先填写 API URL');
      return;
    }

    const $btn = $('#hs-fetch-models');
    $btn.prop('disabled', true).text('获取中...');

    try {
      // 尝试 /v1/models 和 /models 两种路径
      const baseUrl = apiUrl.replace(/\/+$/, '');
      const urls = baseUrl.endsWith('/v1')
        ? [`${baseUrl}/models`]
        : [`${baseUrl}/v1/models`, `${baseUrl}/models`];

      let models: string[] = [];
      for (const url of urls) {
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

          const resp = await fetch(url, { method: 'GET', headers });
          if (!resp.ok) continue;

          const json = await resp.json();
          if (json.data && Array.isArray(json.data)) {
            models = json.data
              .map((m: any) => m.id || m.name || '')
              .filter((id: string) => id)
              .sort();
            break;
          }
        } catch {
          // 尝试下一个 URL
        }
      }

      if (models.length === 0) {
        toastr.warning('未获取到模型列表，请检查 API URL 和 Key');
        return;
      }

      // 填充 select 下拉框
      const $select = $('#hs-custom-api-model-select');
      const currentModel = ($('#hs-custom-api-model').val() as string) || '';
      $select.empty();
      $select.append(`<option value="">（手动输入）</option>`);
      for (const model of models) {
        const isSelected = model === currentModel ? ' selected' : '';
        $select.append(
          `<option value="${escapeHtml(model)}"${isSelected}>${escapeHtml(model)}</option>`
        );
      }

      toastr.success(`已获取 ${models.length} 个模型`);

      // 如果当前输入的模型在列表中，自动选中
      if (currentModel && models.includes(currentModel)) {
        $select.val(currentModel);
      }
    } catch (e) {
      toastr.error('获取模型列表失败');
      console.error('[自动总结] 获取模型列表失败:', e);
    } finally {
      $btn.prop('disabled', false).text('获取模型');
    }
  });

  // 触发模式切换
  $overlay.on('change', 'input[name="hs-volume-trigger-mode"]', function () {
    const mode = $(this).val() as string;
    $('#hs-trigger-count-row').toggle(mode === 'count');
  });

  // 模型下拉框选择同步到文本输入框
  $overlay.on('change', '#hs-custom-api-model-select', function () {
    const selected = $(this).val() as string;
    if (selected) {
      $('#hs-custom-api-model').val(selected);
    }
  });

  // 添加正则
  let regexIndex = data.message_cleanup_regex.length;
  $overlay.on('click', '#hs-add-regex', () => {
    const newRow = buildRegexRowHtml({ pattern: '', flags: 'g', replacement: '' }, regexIndex++);
    $('#hs-regex-list').append(newRow);
  });

  // 删除正则
  $overlay.on('click', '.hs-remove-regex', function () {
    $(this).closest('.hs-regex-row').remove();
  });

  // 添加捕获标签
  let captureTagIndex = data.capture_tags.length;
  $overlay.on('click', '#hs-add-capture-tag', () => {
    const newRow = buildCaptureTagRowHtml({ start_tag: '', end_tag: '' }, captureTagIndex++);
    $('#hs-capture-tags-list').append(newRow);
  });

  // 删除捕获标签
  $overlay.on('click', '.hs-remove-capture-tag', function () {
    $(this).closest('.hs-capture-tag-row').remove();
  });

  // 点击遮罩关闭
  $overlay.on('click', e => {
    if (e.target === $overlay[0]) {
      closeOverlay();
    }
  });
}
