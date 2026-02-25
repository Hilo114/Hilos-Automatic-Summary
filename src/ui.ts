/**
 * 设置 UI 弹窗
 * - 通过酒馆扩展菜单入口打开
 * - 提供各项设置与手动操作按钮
 */

import { getScriptData, saveScriptData, type ScriptDataType } from '@/config';
import { taskQueue } from '@/queue';

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
    <div id="hilo-summary-settings" style="padding: 10px; max-height: 70vh; overflow-y: auto;">
      <h3 style="margin-top: 0;">📖 自动总结设置</h3>

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
      </div>

      <!-- 手动操作 -->
      <div style="margin-bottom: 15px;">
        <h4>手动操作</h4>
        <div style="display: flex; gap: 8px;">
          <button id="hs-manual-mini" class="menu_button">手动总结</button>
          <button id="hs-manual-volume" class="menu_button">手动归档</button>
        </div>
      </div>

      <!-- 自定义 API -->
      <details style="margin-bottom: 15px;">
        <summary><h4 style="display: inline;">自定义 API</h4></summary>
        <div style="padding: 8px 0;">
          <div style="margin-bottom: 8px;">
            <label>
              <input type="checkbox" id="hs-custom-api-enabled" ${data.custom_api.enabled ? 'checked' : ''} />
              启用自定义 API
            </label>
          </div>
          <div style="margin-bottom: 8px;">
            <label>API URL：</label>
            <input type="text" id="hs-custom-api-url" value="${escapeHtml(data.custom_api.apiurl)}" style="width: 100%;" placeholder="https://api.example.com/v1" />
          </div>
          <div style="margin-bottom: 8px;">
            <label>API Key：</label>
            <input type="password" id="hs-custom-api-key" value="${escapeHtml(data.custom_api.key)}" style="width: 100%;" placeholder="sk-..." />
          </div>
          <div style="margin-bottom: 8px;">
            <label>模型名称：</label>
            <input type="text" id="hs-custom-api-model" value="${escapeHtml(data.custom_api.model)}" style="width: 100%;" placeholder="gpt-4" />
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
    custom_api: {
      enabled: $('#hs-custom-api-enabled').is(':checked'),
      apiurl: ($('#hs-custom-api-url').val() as string) || '',
      key: ($('#hs-custom-api-key').val() as string) || '',
      model: ($('#hs-custom-api-model').val() as string) || '',
      source: ($('#hs-custom-api-source').val() as string) || 'openai',
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
    border-radius: 10px; padding: 20px; min-width: 400px;
    max-width: 600px; max-height: 80vh; overflow-y: auto;
    color: var(--SmartThemeBodyColor, #ccc);
  "></div>`);

  const $buttons =
    $(`<div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px;">
    <button id="hs-cancel" class="menu_button">取消</button>
    <button id="hs-save" class="menu_button">保存</button>
  </div>`);

  $dialog.append($popup).append($buttons);
  $overlay.append($dialog);
  $('body').append($overlay);

  // 事件绑定
  $overlay.on('click', '#hs-cancel', () => {
    $overlay.remove();
  });

  $overlay.on('click', '#hs-save', () => {
    const newSettings = collectSettingsFromPopup();
    const currentData = getScriptData();
    const merged = { ...currentData, ...newSettings };
    saveScriptData(merged as ScriptDataType);
    toastr.success('设置已保存');
    $overlay.remove();
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
