const STORAGE_KEY = 'krea2-openai-compatible-caller-v1';
const $ = (id) => document.getElementById(id);
const ui = { button: $('callerButton'), panel: $('callerPanel'), close: $('closeCaller'), state: $('callerState'), endpoint: $('endpoint'), apiKey: $('apiKey'), toggleKey: $('toggleKey'), save: $('saveCaller'), fetch: $('fetchModels'), message: $('callerMessage'), select: $('modelSelect'), refresh: $('refreshModels'), saveModel: $('saveModel'), endpointPreview: $('endpointPreview'), empty: $('emptyState'), ready: $('readyState'), selectedName: $('selectedModelName'), selectedDetail: $('selectedModelDetail') };

function readConfiguration() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { localStorage.removeItem(STORAGE_KEY); return {}; } }
function saveConfiguration(next = {}) { const config = { ...readConfiguration(), ...next, endpoint: ui.endpoint.value.trim(), apiKey: ui.apiKey.value.trim() }; localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); return config; }
function normalizeModelsUrl(value) { const endpoint = value.trim().replace(/\/+$/, ''); if (!endpoint) throw new Error('请先填写服务地址。'); return /\/models(?:\?.*)?$/i.test(endpoint) ? endpoint : `${endpoint}/models`; }
function setMessage(text = '', error = false) { ui.message.textContent = text; ui.message.classList.toggle('error', error); }
function updateStatus() { const configured = Boolean(ui.endpoint.value.trim() && ui.apiKey.value.trim()); ui.state.textContent = configured ? '已配置' : '未配置'; ui.state.classList.toggle('ready', configured); ui.endpointPreview.textContent = ui.endpoint.value.trim() || '尚未配置'; const selected = ui.select.value; ui.empty.classList.toggle('hidden', Boolean(selected)); ui.ready.classList.toggle('hidden', !selected); if (selected) { ui.selectedName.textContent = selected; ui.selectedDetail.textContent = '所选模型已保存在当前浏览器。'; } }
function populateModels(models, selected = '') { ui.select.innerHTML = ''; if (!models.length) { ui.select.add(new Option('未找到可用模型', '')); ui.select.disabled = true; return; } models.forEach((model) => ui.select.add(new Option(model, model, false, model === selected))); ui.select.disabled = false; }
function openPanel(open) { ui.panel.classList.toggle('hidden', !open); ui.button.setAttribute('aria-expanded', String(open)); if (open) ui.endpoint.focus(); }
async function fetchModels() {
  const endpoint = ui.endpoint.value.trim(); const apiKey = ui.apiKey.value.trim();
  if (!endpoint || !apiKey) { setMessage('请先填写服务地址和 API Key。', true); openPanel(true); return; }
  saveConfiguration(); setMessage('正在拉取模型列表…'); ui.fetch.disabled = true; ui.refresh.disabled = true;
  try {
    const response = await fetch(normalizeModelsUrl(endpoint), { headers: { Authorization: `Bearer ${apiKey}` } });
    let payload; try { payload = await response.json(); } catch { throw new Error(`服务返回了无法解析的数据（HTTP ${response.status}）。`); }
    if (!response.ok) throw new Error(payload.error?.message || payload.message || `拉取失败（HTTP ${response.status}）。`);
    const models = Array.isArray(payload.data) ? payload.data : (Array.isArray(payload) ? payload : []);
    const names = [...new Set(models.map((model) => typeof model === 'string' ? model : model.id).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (!names.length) throw new Error('接口已响应，但未返回 OpenAI 格式的模型列表。');
    const current = readConfiguration().model || ''; populateModels(names, current); const selected = ui.select.value || names[0]; ui.select.value = selected; saveConfiguration({ model: selected, models: names }); setMessage(`已拉取 ${names.length} 个模型。`); updateStatus();
  } catch (error) { setMessage(error.message || '拉取模型失败。请检查地址、密钥或跨域设置。', true); }
  finally { ui.fetch.disabled = false; ui.refresh.disabled = false; }
}

const config = readConfiguration(); ui.endpoint.value = config.endpoint || ''; ui.apiKey.value = config.apiKey || ''; populateModels(Array.isArray(config.models) ? config.models : [], config.model || ''); updateStatus();
ui.button.addEventListener('click', () => openPanel(ui.panel.classList.contains('hidden'))); ui.close.addEventListener('click', () => openPanel(false));
ui.toggleKey.addEventListener('click', () => { const show = ui.apiKey.type === 'password'; ui.apiKey.type = show ? 'text' : 'password'; ui.toggleKey.textContent = show ? '隐藏' : '显示'; });
ui.save.addEventListener('click', () => { saveConfiguration(); setMessage('模型调用器配置已保存到当前浏览器。'); updateStatus(); }); ui.fetch.addEventListener('click', fetchModels); ui.refresh.addEventListener('click', fetchModels);
ui.saveModel.addEventListener('click', () => { if (!ui.select.value) return; saveConfiguration({ model: ui.select.value }); updateStatus(); }); ui.select.addEventListener('change', updateStatus);
document.addEventListener('click', (event) => { if (!event.target.closest('.caller-wrap')) openPanel(false); });
