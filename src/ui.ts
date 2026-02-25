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

/** 构建设置弹窗 HTML */
function buildSettingsHtml(data: ScriptDataType): string {
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
      </style>
      <h3 style="margin-top: 0;">📖 自动总结设置</h3>

      <!-- 世界书管理 -->
      <div style="margin-bottom: 15px;">
        <h4>世界书管理</h4>
        <div style="margin-bottom: 8px; display: flex; gap: 8px; align-items: center;">
          <label>当前世界书：</label>
          <select id="hs-worldbook-select" style="flex: 1;">
            <option value=""${!data.worldbook_name ? ' selected' : ''}>（未绑定）</option>
            ${getWorldbookNames().map(name =>
    `<option value="${escapeHtml(name)}" ${data.worldbook_name === name ? 'selected' : ''}>${escapeHtml(name)}</option>`
  ).join('')}
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
        <div style="margin-bottom: 8px;">
          <label>
            <input type="checkbox" id="hs-auto-mini-summary" ${data.auto_mini_summary ? 'checked' : ''} />
            自动小总结
          </label>
        </div>
        <div style="margin-bottom: 8px;">
          <label>
            <input type="checkbox" id="hs-auto-volume-summary" ${data.auto_volume_summary ? 'checked' : ''} />
            自动大总结
          </label>
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
          <label>内容捕获标签：</label>
          <div style="display: flex; gap: 5px; align-items: center; margin-top: 4px;">
            <span>&lt;</span>
            <input type="text" id="hs-capture-start-tag" value="${escapeHtml(data.capture_start_tag)}" style="width: 100px;" placeholder="起始标签" />
            <span>&gt; … &lt;</span>
            <input type="text" id="hs-capture-end-tag" value="${escapeHtml(data.capture_end_tag)}" style="width: 100px;" placeholder="结束标签" />
            <span>&gt;</span>
          </div>
          <small style="color: #888;">（仅总结两个标签之间的内容，均留空则总结全部）</small>
        </div>
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
          <div style="display: flex; gap: 8px; align-items: center;">
            <select id="hs-custom-api-model" style="flex: 1;">
              ${data.custom_api.model ? `<option value="${escapeHtml(data.custom_api.model)}" selected>${escapeHtml(data.custom_api.model)}</option>` : '<option value="">(未选择)</option>'}
            </select>
            <button id="hs-fetch-models" class="menu_button" style="white-space: nowrap;">获取模型列表</button>
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
            <textarea id="hs-prompt-mini" rows="5" style="width: 100%; resize: vertical;" placeholder="留空使用默认提示词">${escapeHtml(data.custom_prompts.mini_summary_system)}</textarea>
            <small style="color: #888;">（留空则使用默认提示词）</small>
          </div>
          <div style="margin-bottom: 8px;">
            <label>大总结系统提示词：</label>
            <textarea id="hs-prompt-volume" rows="5" style="width: 100%; resize: vertical;" placeholder="留空使用默认提示词">${escapeHtml(data.custom_prompts.volume_summary_system)}</textarea>
            <small style="color: #888;">（留空则使用默认提示词）</small>
          </div>
          <div style="margin-bottom: 8px;">
            <label>卷完结检测系统提示词：</label>
            <textarea id="hs-prompt-completion" rows="5" style="width: 100%; resize: vertical;" placeholder="留空使用默认提示词">${escapeHtml(data.custom_prompts.volume_completion_check_system)}</textarea>
            <small style="color: #888; display: block; margin-top: 4px;">
              （留空则使用默认提示词）<br/>
              回答"114514"表示这一卷已经到了一个合适的断点，可以归档<br/>
              回答"1919810"表示故事仍在进行中，不适合在这里断开
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
          <button id="hs-add-regex" class="menu_button" style="margin-top: 5px;">+ 添加正则</button>
        </div>
      </details>
    </div>
  `;
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

  return {
    visible_floors: parseInt($('#hs-visible-floors').val() as string) || 20,
    check_interval: parseInt($('#hs-check-interval').val() as string) || 20,
    volume_token_threshold: parseInt($('#hs-volume-token-threshold').val() as string) || 8000,
    auto_mini_summary: $('#hs-auto-mini-summary').is(':checked'),
    auto_volume_summary: $('#hs-auto-volume-summary').is(':checked'),
    mini_summary_depth: parseInt($('#hs-mini-summary-depth').val() as string) || 9999,
    volume_summary_depth: parseInt($('#hs-volume-summary-depth').val() as string) || 9999,
    mini_summary_start_order: parseInt($('#hs-mini-start-order').val() as string) || 10000,
    volume_start_order: parseInt($('#hs-volume-start-order').val() as string) || 100,
    ignore_floors: parseInt($('#hs-ignore-floors').val() as string) || 0,
    capture_start_tag: (($('#hs-capture-start-tag').val() as string) || '').trim(),
    capture_end_tag: (($('#hs-capture-end-tag').val() as string) || '').trim(),
    no_trans_tag: $('#hs-no-trans-tag').is(':checked'),
    no_trans_tag_value: (($('#hs-no-trans-tag-value').val() as string) || '').trim(),
    custom_api: {
      apiurl: ($('#hs-custom-api-url').val() as string) || '',
      key: ($('#hs-custom-api-key').val() as string) || '',
      model: ($('#hs-custom-api-model').val() as string) || '',
      source: ($('#hs-custom-api-source').val() as string) || 'openai',
    },
    custom_prompts: {
      mini_summary_system: (($('#hs-prompt-mini').val() as string) || '').trim(),
      volume_summary_system: (($('#hs-prompt-volume').val() as string) || '').trim(),
      volume_completion_check_system: (($('#hs-prompt-completion').val() as string) || '').trim(),
    },
    message_cleanup_regex: regexList,
  };
}

/** 打开设置弹窗 */
async function openSettingsPopup(): Promise<void> {
  const data = getScriptData();
  const html = buildSettingsHtml(data);

  const $popup = $(html);

  // 使用酒馆的 callGenericPopup（如果可用）或创建简单弹窗
  const $overlay = $(`<div id="hilo-summary-overlay" style="
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6); z-index: 9998;
    display: flex; justify-content: center; align-items: center;
  "></div>`);

  const $dialog = $(`<div style="
    background: var(--SmartThemeBlurTintColor, #2b2b2b);
    border: 1px solid var(--SmartThemeBorderColor, #555);
    border-radius: 10px; padding: 20px; width: 90vw;
    min-width: 500px; max-width: 700px; max-height: 90vh; overflow-y: auto;
    display: flex; flex-direction: column;
    color: var(--SmartThemeBodyColor, #ccc);
  "></div>`);

  const $buttons =
    $(`<div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; flex-shrink: 0;">
    <button id="hs-reset" class="menu_button" style="margin-right: auto; white-space: nowrap; padding: 5px 15px;">重置默认</button>
    <button id="hs-cancel" class="menu_button" style="white-space: nowrap; padding: 5px 15px;">取消</button>
    <button id="hs-save" class="menu_button" style="white-space: nowrap; padding: 5px 15px;">保存</button>
  </div>`);

  $dialog.append($popup).append($buttons);
  $overlay.append($dialog);
  $('body').append($overlay);

  // 事件绑定
  $overlay.on('click', '#hs-cancel', () => {
    $overlay.remove();
  });

  // 重置默认设置
  $overlay.on('click', '#hs-reset', () => {
    const currentData = getScriptData();
    // 保留运行时元数据，重置用户设置
    const resetData = {
      ...DEFAULT_SETTINGS,
      worldbook_name: currentData.worldbook_name,
      current_volume: currentData.current_volume,
      last_processed_message_id: currentData.last_processed_message_id,
      volumes: currentData.volumes,
    } as ScriptDataType;
    saveScriptData(resetData);
    toastr.success('已重置为默认设置');
    $overlay.remove();
    // 重新打开弹窗以刷新 UI
    void openSettingsPopup();
  });

  $overlay.on('click', '#hs-save', () => {
    const newSettings = collectSettingsFromPopup();
    const currentData = getScriptData();
    const merged = { ...currentData, ...newSettings };
    saveScriptData(merged as ScriptDataType);
    toastr.success('设置已保存');
    $overlay.remove();
  });

  // 世界书选择变更
  $overlay.on('change', '#hs-worldbook-select', function () {
    const selected = $(this).val() as string;
    if (selected) {
      bindWorldbookForChat(selected);
      toastr.success(`已绑定世界书: ${selected}`);
    } else {
      // 解绑
      const data = getScriptData();
      data.worldbook_name = '';
      saveScriptData(data);
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

  // 获取模型列表
  $overlay.on('click', '#hs-fetch-models', async () => {
    const apiurl = ($('#hs-custom-api-url').val() as string) || '';
    const key = ($('#hs-custom-api-key').val() as string) || '';
    if (!apiurl) {
      toastr.warning('请先填写 API URL');
      return;
    }
    try {
      toastr.info('正在获取模型列表...');
      const models = await getModelList({ apiurl, key: key || undefined });
      const $select = $('#hs-custom-api-model');
      const currentModel = $select.val() as string;
      $select.empty();
      if (models.length === 0) {
        $select.append('<option value="">(无可用模型)</option>');
      } else {
        for (const model of models) {
          const selected = model === currentModel ? ' selected' : '';
          $select.append(`<option value="${escapeHtml(model)}"${selected}>${escapeHtml(model)}</option>`);
        }
        // 如果之前的模型不在列表中，选中第一个
        if (!models.includes(currentModel)) {
          $select.val(models[0]);
        }
      }
      toastr.success(`已获取 ${models.length} 个模型`);
    } catch (e) {
      toastr.error('获取模型列表失败');
      console.error('[自动总结] 获取模型列表失败:', e);
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
      for (let i = startId; i <= lastId; i++) {
        if (!existingFloors.has(i)) {
          taskQueue.enqueue({ type: 'mini_summary', message_id: i });
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

  // 点击遮罩关闭
  $overlay.on('click', e => {
    if (e.target === $overlay[0]) {
      $overlay.remove();
    }
  });
}
