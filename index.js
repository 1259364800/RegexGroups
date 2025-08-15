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
	const li = $(`<div class="regex-group-item" data-id="${group.id}">
		<span class="drag-handle menu-handle">&#9776;</span>
		<input class="group-name text_pole" value="${group.name}"/>
		<div class="group-actions">
			<label class="checkbox flex-container">
				<input type="checkbox" class="group-enabled" ${group.disabled ? '' : 'checked'} />
				<span class="fa-solid ${group.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></span>
			</label>
			<button class="menu_button view-scripts">查看正则</button>
			<button class="menu_button add-script">添加正则</button>
			<button class="menu_button remove-group">删除</button>
		</div>
	</div>`);
	return li;
}

function buildScriptChip(script) {
	const div = $(`<div class="regex-chip" data-id="${script.id}" style="display: flex; align-items: center; margin: 5px 0; padding: 5px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; width: 100%;">
		<span class="chip-text" style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${script.scriptName}</span>
		<label class="checkbox flex-container" style="margin: 0 10px;">
			<input type="checkbox" class="script-enabled" ${script.disabled ? '' : 'checked'} />
			<span class="fa-solid ${script.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></span>
		</label>
		<button class="menu_button remove-chip">移除</button>
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
	const list = $('<div class="flex-container flexFlowColumn" style="max-height: 500px; overflow-y: auto;"></div>');
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
				const html = $('<div class="flex-container flexFlowColumn" style="min-width: 400px;"></div>');
				html.append(`<h3>${g.name} - 正则脚本列表</h3>`);
				const scriptsList = $('<div class="flex-container flexFlowColumn" style="max-height: 500px; overflow-y: auto;"></div>');
				
				for (const s of scripts) {
					const scriptItem = buildScriptChip(s);
					// 添加拖动手柄
					scriptItem.prepend('<span class="drag-handle menu-handle">&#9776;</span>');
					
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
		const groups = getActiveGroupsRef();
		groups.push({ id: uuidv4(), name: '新建分组', disabled: false, scripts: [] });
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
