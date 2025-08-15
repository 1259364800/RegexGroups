import { extension_settings, renderExtensionTemplateAsync, writeExtensionField } from '../../../extensions.js';
import { characters } from '../../../../script.js';
import { t } from '../../../i18n.js';
import { getSortableDelay, uuidv4 } from '../../../utils.js';
import { getContext } from '../../../st-context.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';

const MODULE_NAME = 'RegexGroups';
const PATH = '/third-party/RegexGroups';

function getAllRegexScripts() {
	const ctx = getContext();
	const global = extension_settings.regex ?? [];
	const scoped = characters[ctx.characterId]?.data?.extensions?.regex_scripts ?? [];
	return { global, scoped };
}

function getGroupsStorage() {
	// groups 保存在全局设置中，并按角色也支持scoped
	extension_settings.regex_groups = extension_settings.regex_groups ?? { global: [], scoped: {} };
	return extension_settings.regex_groups;
}

function getCurrentScopedGroups() {
	const ctx = getContext();
	const storage = getGroupsStorage();
	const key = String(ctx.characterId ?? '');
	storage.scoped[key] = storage.scoped[key] ?? [];
	return storage.scoped[key];
}

function setCurrentScopedGroups(groups) {
	const ctx = getContext();
	const storage = getGroupsStorage();
	const key = String(ctx.characterId ?? '');
	storage.scoped[key] = groups;
}

function saveGroupsDebounced() {
	// 复用全局设置保存
	getContext().saveSettingsDebounced();
}

function buildGroupItem(group) {
	const li = $(`<div class="regex-group-item" data-id="${group.id}" style="display: flex; align-items: center; margin: 3px 0; padding: 5px 8px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; height: 36px;">
		<span class="drag-handle menu-handle" style="margin-right: 8px; cursor: move;">&#9776;</span>
		<span class="group-name text_pole" value="${group.name}" style="flex: 1; margin-right: 8px; height: 24px;">${group.name}</span>
		<input type="checkbox" class="group-enabled" ${group.disabled ? '' : 'checked'} />
		<span class="fa-solid ${group.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></span>
		<div class="group-actions" style="display: flex; align-items: center; gap: 3px; white-space: nowrap;">
		<button class="menu_button view-scripts" title="查看正则" style="padding: 2px 5px; min-height: 28px;"><i class="fa-solid fa-eye"></i></button>
		<button class="menu_button add-script" title="添加正则" style="padding: 2px 5px; min-height: 28px;"><i class="fa-solid fa-plus"></i></button>
		<button class="menu_button remove-group" title="删除分组" style="padding: 2px 5px; min-height: 28px;"><i class="fa-solid fa-trash"></i></button>
		</div>
	</div>`);
	return li;
}

function buildScriptChip(script) {
	const div = $(`<div class="regex-chip" data-id="${script.id}" style="display: flex; align-items: center; margin: 2px 0; padding: 3px 5px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; width: 100%; height: 32px;">
		<span class="chip-text" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;">${script.scriptName}</span>
		<label class="checkbox flex-container" style="margin: 0 5px;">
			<input type="checkbox" class="script-enabled" ${script.disabled ? '' : 'checked'} />
			<span class="fa-solid ${script.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></span>
		</label>
		<button class="menu_button remove-chip" style="padding: 1px 4px; min-height: 24px;">移除</button>
	</div>`);
	return div;
}

function findScriptById(id) {
	const { global, scoped } = getAllRegexScripts();
	return [...global, ...scoped].find(s => s.id === id);
}

async function persistScript(script, isScoped) {
	const ctx = getContext();
	const array = isScoped ? (characters[ctx.characterId]?.data?.extensions?.regex_scripts ?? []) : (extension_settings.regex ?? []);
	const idx = array.findIndex(s => s.id === script.id);
	if (idx === -1) array.push(script); else array[idx] = script;
	if (isScoped) {
		await writeExtensionField(ctx.characterId, 'regex_scripts', array);
	}
	getContext().saveSettingsDebounced();
	// 同步复选框到Regex列表
	const row = $(`#${script.id}`);
	row.find('.disable_regex').prop('checked', !!script.disabled);
}

function isScriptScoped(script) {
	const ctx = getContext();
	return !!characters[ctx.characterId]?.data?.extensions?.regex_scripts?.some(s => s.id === script.id);
}

function applyOrderToRegexUI(orderIds, containerSelector) {
	const container = $(containerSelector);
	if (container.length === 0) return;
	for (const id of orderIds) {
		const el = container.children(`#${id}`);
		if (el.length) {
			container.append(el);
		}
	}
}

async function toggleGroup(group, enabled) {
	group.disabled = !enabled;
	// 同步组内脚本
	for (const { id } of group.scripts) {
		const script = findScriptById(id);
		if (!script) continue;
		script.disabled = !enabled;
		await persistScript(script, isScriptScoped(script));
	}
	saveGroupsDebounced();
}

async function reorderAccordingToGroups(groups) {
	const { global, scoped } = getAllRegexScripts();
	const ctx = getContext();
	const orderIds = [];
	for (const g of groups) {
		for (const s of g.scripts) {
			orderIds.push(s.id);
		}
	}
	// 未在分组内的保持在末尾，维持原相对顺序
	const remainingGlobal = global.filter(s => !orderIds.includes(s.id));
	const remainingScoped = scoped.filter(s => !orderIds.includes(s.id));
	const newGlobal = [...global.filter(s => orderIds.includes(s.id)), ...remainingGlobal];
	const newScoped = [...scoped.filter(s => orderIds.includes(s.id)), ...remainingScoped];
	extension_settings.regex = newGlobal;
	await writeExtensionField(ctx.characterId, 'regex_scripts', newScoped);
	getContext().saveSettingsDebounced();
	// 同步UI顺序
	applyOrderToRegexUI(newGlobal.map(s => s.id), '#saved_regex_scripts');
	applyOrderToRegexUI(newScoped.map(s => s.id), '#saved_scoped_scripts');
}

function openAddScriptPopup(onPick) {
	const { global, scoped } = getAllRegexScripts();
	const all = [...global, ...scoped];
	const html = $('<div class="flex-container flexFlowColumn"></div>');
	const list = $('<div class="flex-container flexFlowColumn" style="overflow-y: auto;"></div>');
	for (const s of all) {
		const row = $(`<label class="checkbox flex-container"><input type="checkbox" value="${s.id}"><span>${s.scriptName}</span></label>`);
		list.append(row);
	}
	html.append('<div>选择要加入分组的正则：</div>');
	html.append(list);
	return new Promise(async (resolve) => {
		const popup = new Popup(html, POPUP_TYPE.CONFIRM, '', { okButton: t`Add` });
		const result = await popup.show();
		if (!result) return resolve();
		const ids = list.find('input:checked').toArray().map(x => x.value);
		onPick?.(ids);
		resolve();
	});
}

async function render() {
	const container = $('#regex_container');
	const root = $(await renderExtensionTemplateAsync(PATH, 'panel'));
	container.append(root);

	const tabSelector = root.find('#regex_groups_scope');
	const groupsList = root.find('#regex_groups_list');
	const addGroupBtn = root.find('#add_regex_group');
	
	// 优化添加按钮样式
	addGroupBtn.html('<i class="fa-solid fa-plus"></i> 新建分组');
	addGroupBtn.css({
		'margin-left': 'auto',
		'display': 'flex',
		'align-items': 'center',
		'gap': '5px'
	});
	
	// 添加样式
	groupsList.css({
		'border': '1px solid var(--SmartThemeBorderColor)',
		'border-radius': '5px',
		'padding': '5px',
		'margin-top': '5px',
		'max-height': '500px',
		'overflow-y': 'auto'
	});
	
	// 创建标题行，包含标题和添加按钮
	const titleRow = $(`<div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px; margin-bottom: 3px;">
		<div>
			<h3 style="margin-bottom: 3px;">正则分组管理</h3>
			<p style="font-size: 0.9em; opacity: 0.8; margin: 0;">创建分组来组织和管理您的正则表达式</p>
		</div>
	</div>`);
	
	// 将添加按钮移动到标题行
	addGroupBtn.detach();
	titleRow.append(addGroupBtn);
	
	// 添加标题行
	groupsList.before(titleRow);

	function getActiveGroupsRef() {
		return tabSelector.val() === 'global' ? getGroupsStorage().global : getCurrentScopedGroups();
	}

	async function refreshList() {
		groupsList.empty();
		const groups = getActiveGroupsRef();
		for (const g of groups) {
			const li = buildGroupItem(g);

			li.find('.group-name').on('input', function () {
				g.name = String($(this).val());
				saveGroupsDebounced();
			});
			li.find('.group-enabled').on('change', async function () {
				await toggleGroup(g, $(this).is(':checked'));
				await refreshList();
			});
			li.find('.view-scripts').on('click', async function () {
				const scripts = [];
				for (const s of g.scripts) {
					const full = findScriptById(s.id);
					if (full) scripts.push(full);
				}
				if (scripts.length === 0) {
					alert('该分组没有正则脚本。');
					return;
				}
				const html = $('<div class="flex-container flexFlowColumn"></div>');
				html.append(`<h3 style="margin: 0 0 5px 0;">${g.name} - 正则脚本列表</h3>`);
				const scriptsList = $('<div class="flex-container flexFlowColumn" style="max-height: 400px; overflow-y: auto; margin-top: 5px;"></div>');
				
				for (const s of scripts) {
					const scriptItem = buildScriptChip(s);
					// 添加拖动手柄
					scriptItem.prepend('<span class="drag-handle menu-handle" style="margin-right: 5px; cursor: move;">&#9776;</span>');
					
					scriptItem.find('.script-enabled').on('change', async function() {
						s.disabled = !$(this).is(':checked');
						$(this).next('span').attr('class', `fa-solid ${s.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}`);
						await persistScript(s, isScriptScoped(s));
					});
					scriptItem.find('.remove-chip').on('click', function() {
						g.scripts = g.scripts.filter(x => x.id !== s.id);
						saveGroupsDebounced();
						scriptItem.remove();
						if (scriptsList.children().length === 0) {
							html.find('.popup-ok').trigger('click');
						}
					});
					scriptsList.append(scriptItem);
				}
				
				html.append(scriptsList);
				
				// 使脚本列表可排序
				scriptsList.sortable({
					handle: '.drag-handle',
					delay: getSortableDelay(),
					stop: async function() {
						const newOrder = [];
						$(this).children('.regex-chip').each(function() {
							newOrder.push({ id: $(this).data('id') });
						});
						g.scripts = newOrder;
						saveGroupsDebounced();
						await reorderAccordingToGroups(getActiveGroupsRef());
					}
				});
				
				new Popup(html, POPUP_TYPE.CONFIRM, '分组正则脚本', { okButton: t`Close` }).show();
			});
			li.find('.add-script').on('click', async function () {
				await openAddScriptPopup(async (ids) => {
					for (const id of ids) {
						if (!g.scripts.some(x => x.id === id)) g.scripts.push({ id });
					}
					saveGroupsDebounced();
					await refreshList();
				});
			});
			li.find('.remove-group').on('click', function () {
				const arr = getActiveGroupsRef();
				const idx = arr.indexOf(g);
				if (idx >= 0) arr.splice(idx, 1);
				saveGroupsDebounced();
				li.remove();
			});

			groupsList.append(li);
		}

		groupsList.sortable({
			delay: getSortableDelay(),
			stop: async function () {
				const arr = getActiveGroupsRef();
				const newGroups = [];
				$(this).children('.regex-group-item').each(function () {
					const id = $(this).data('id');
					const g = arr.find(x => x.id === id);
					if (g) newGroups.push(g);
				});
				if (tabSelector.val() === 'global') {
					getGroupsStorage().global = newGroups;
				} else {
					setCurrentScopedGroups(newGroups);
				}
				saveGroupsDebounced();
				await reorderAccordingToGroups(getActiveGroupsRef());
			}
		});
	}

	addGroupBtn.on('click', async function () {
		const html = $('<div class="flex-container flexFlowColumn"></div>');
		const input = $('<input type="text" class="text_pole" placeholder="请输入分组名称" value="新建分组" />');
		html.append(input);
		
		const popup = new Popup(html, POPUP_TYPE.CONFIRM, '添加正则分组', { okButton: t`Add` });
		const result = await popup.show();
		if (!result) return;
		
		const groupName = input.val() || '新建分组';
		const groups = getActiveGroupsRef();
		groups.push({ id: uuidv4(), name: groupName, disabled: false, scripts: [] });
		saveGroupsDebounced();
		await refreshList();
	});

	tabSelector.on('change', refreshList);
	await refreshList();
}

jQuery(async () => {
	if (extension_settings.disabledExtensions.includes(MODULE_NAME)) return;
	await render();
});
