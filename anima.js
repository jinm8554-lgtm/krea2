const API_BASE = 'https://www.runninghub.ai/openapi/v2';
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 10 * 60 * 1000;
const CONFIG_KEY = 'anima-generation-configuration-v2';

const WORKFLOWS = Object.freeze({
  soft: {
    id: '2089732282689421313',
    label: '柔和画风',
    description: '原 Anima 主流 · 多 LoRA 画风融合',
    hint: '原 Anima 流程，适合柔和、稳定的二次元画面。',
    progressName: '柔和画风',
    tag: 'ANIME',
  },
  janima: {
    id: '2100536212313731074',
    label: 'JANIMA',
    description: 'JANIMA 29B · 高细节渲染',
    hint: 'JANIMA 发布流程，使用远端工作流的固定高细节处理。',
    progressName: 'JANIMA',
    tag: 'JANIMA',
  },
});

const FLOW_DEFAULTS = {
  soft: { steps: '13', cfg: '1', sampler: 'dpmpp_2m_sde_gpu', scheduler: 'beta57', denoise: '1' },
  janima: { steps: '30', cfg: '4', sampler: 'euler_ancestral', scheduler: 'beta57', denoise: '1' },
};

const $ = id => document.getElementById(id);
const ui = {
  form: $('generationForm'),
  prompt: $('prompt'),
  negative: $('negativePrompt'),
  width: $('width'),
  height: $('height'),
  batch: $('batchSize'),
  steps: $('steps'),
  cfg: $('cfg'),
  seed: $('seed'),
  sampler: $('sampler'),
  scheduler: $('scheduler'),
  denoise: $('denoise'),
  instance: $('instanceType'),
  addMetadata: $('addMetadata'),
  personalQueue: $('personalQueue'),
  button: $('generateButton'),
  message: $('formMessage'),
  badge: $('statusBadge'),
  empty: $('emptyState'),
  progress: $('progressState'),
  progressTitle: $('progressTitle'),
  progressDetail: $('progressDetail'),
  taskId: $('taskIdDisplay'),
  results: $('results'),
  poolGrid: $('poolGrid'),
  poolCount: $('poolCount'),
  poolEmpty: $('poolEmpty'),
  zipDownload: $('zipDownload'),
  error: $('errorState'),
  errorText: $('errorMessage'),
  retry: $('retryButton'),
  settingsButton: $('settingsButton'),
  settingsPanel: $('settingsPanel'),
  closeSettings: $('closeSettings'),
  saveKey: $('saveKey'),
  clearKey: $('clearKey'),
  toggleKey: $('toggleKey'),
  apiKey: $('apiKey'),
  keyState: $('keyState'),
  settingsMessage: $('settingsMessage'),
  openSettingsHint: $('openSettingsHint'),
  clearPool: $('clearPool'),
  saveConfig: $('saveConfig'),
  count: $('promptCount'),
  lightbox: $('lightbox'),
  lightboxImage: $('lightboxImage'),
  lightboxName: $('lightboxName'),
  closeLightbox: $('closeLightbox'),
  workflowEyebrow: $('workflowEyebrow'),
  workflowLabel: $('workflowLabel'),
  workflowDescription: $('workflowDescription'),
  workflowHint: $('workflowHint'),
  workflowTag: $('workflowTag'),
  workflowChoices: [...document.querySelectorAll('[data-workflow]')],
};

let active = false;
let activeWorkflow = 'soft';
let images = [];
const flowSnapshots = {};

function headers(key) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`服务返回了无法解析的响应（HTTP ${response.status}）。`);
  }
  if (!response.ok || data.errorCode || (typeof data.code === 'number' && data.code !== 0)) {
    throw new Error(data.errorMessage || data.message || `请求失败（HTTP ${response.status}）`);
  }
  return data;
}

function node(nodeId, fieldName, fieldValue) {
  return { nodeId: String(nodeId), fieldName, fieldValue };
}

function formValues() {
  return {
    prompt: ui.prompt.value.trim(),
    negative: ui.negative.value.trim(),
    width: Number(ui.width.value),
    height: Number(ui.height.value),
    batch: Number(ui.batch.value),
    steps: Number(ui.steps.value),
    cfg: Number(ui.cfg.value),
    seed: ui.seed.value === '' ? null : Number(ui.seed.value),
    sampler: ui.sampler.value,
    scheduler: ui.scheduler.value,
    denoise: Number(ui.denoise.value),
  };
}

function buildSoftNodeInfoList(values) {
  const list = [
    node(11, 'text', values.prompt),
    node(12, 'text', values.negative),
    node(62, 'width', values.width),
    node(62, 'height', values.height),
    node(62, 'batch_size', values.batch),
    node(19, 'steps', values.steps),
    node(19, 'cfg', values.cfg),
    node(19, 'sampler_name', values.sampler),
    node(19, 'scheduler', values.scheduler),
    node(19, 'denoise', values.denoise),
  ];
  if (values.seed !== null) list.push(node(19, 'seed', values.seed));
  return list;
}

function buildJanimaNodeInfoList(values) {
  const list = [
    node(11, 'text', values.prompt),
    node(12, 'text', values.negative),
    node(62, 'width', values.width),
    node(62, 'height', values.height),
    node(62, 'batch_size', values.batch),
    node(19, 'steps', values.steps),
    node(19, 'cfg', values.cfg),
    node(19, 'sampler_name', values.sampler),
    node(19, 'scheduler', values.scheduler),
    node(19, 'denoise', values.denoise),
  ];
  if (values.seed !== null) list.push(node(19, 'seed', values.seed));
  return list;
}

function buildNodeInfoList(flowKey, values) {
  return flowKey === 'janima' ? buildJanimaNodeInfoList(values) : buildSoftNodeInfoList(values);
}

function setStatus(type, text) {
  ui.badge.className = `status ${type}`;
  ui.badge.textContent = text;
}

function showMessage(text, type = '') {
  ui.message.textContent = text;
  ui.message.className = `form-message${type ? ` ${type}` : ''}`;
}

function friendlyError(error) {
  if (error.name === 'TypeError' && /fetch/i.test(error.message)) {
    return '无法连接到 RunningHub。请确认网络正常；若浏览器拦截跨域请求，请通过本地 HTTP 服务打开页面。';
  }
  return error.message || '发生未知错误，请稍后重试。';
}

function updatePool() {
  ui.poolGrid.innerHTML = '';
  ui.poolCount.textContent = `${images.length} 张图片`;
  ui.poolEmpty.classList.toggle('hidden', images.length > 0);
  ui.results.classList.toggle('hidden', images.length === 0);
  images.forEach(image => {
    const fragment = $('imageCardTemplate').content.cloneNode(true);
    const url = URL.createObjectURL(image.blob);
    const img = fragment.querySelector('img');
    img.src = url;
    img.alt = image.name;
    fragment.querySelector('.image-name').textContent = image.name;
    const link = fragment.querySelector('.download-image');
    link.href = url;
    link.download = image.name;
    fragment.querySelector('.image-link').addEventListener('click', () => {
      ui.lightboxImage.src = url;
      ui.lightboxName.textContent = image.name;
      ui.lightbox.classList.remove('hidden');
    });
    fragment.querySelector('.delete-image').addEventListener('click', () => {
      URL.revokeObjectURL(url);
      images = images.filter(item => item !== image);
      updatePool();
    });
    ui.poolGrid.append(fragment);
  });
}

function isImage(file) {
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name);
}

async function unpackZip(result) {
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`无法下载 ZIP 结果（HTTP ${response.status}）。`);
  const zip = await JSZip.loadAsync(await response.blob());
  const out = [];
  for (const file of Object.values(zip.files)) {
    if (!file.dir && isImage(file)) {
      out.push({ name: file.name.split('/').pop(), blob: await file.async('blob') });
    }
  }
  if (!out.length) throw new Error('ZIP 已下载，但其中没有识别到图片。');
  return out;
}

async function submit(key, flowKey, values) {
  const flow = WORKFLOWS[flowKey];
  return requestJson(`${API_BASE}/run/workflow/${flow.id}`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      addMetadata: ui.addMetadata.checked,
      nodeInfoList: buildNodeInfoList(flowKey, values),
      instanceType: ui.instance.value,
      usePersonalQueue: ui.personalQueue.checked,
    }),
  });
}

async function query(taskId, key) {
  return requestJson(`${API_BASE}/query`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ taskId }),
  });
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function poll(taskId, key, flowKey) {
  const start = Date.now();
  const flow = WORKFLOWS[flowKey];
  while (Date.now() - start < POLL_TIMEOUT) {
    await pause(POLL_INTERVAL);
    const task = await query(taskId, key);
    const status = String(task.status || '').toUpperCase();
    if (status === 'SUCCESS') return task;
    if (['FAILED', 'CANCELED', 'CANCELLED'].includes(status)) {
      throw new Error(task.errorMessage || task.failedReason?.message || `任务状态：${status}`);
    }
    ui.progressDetail.textContent = status === 'QUEUED'
      ? 'RunningHub 正在等待可用算力'
      : `${flow.progressName} 正在渲染你的画面`;
  }
  throw new Error('任务等待超过 10 分钟，请前往 RunningHub 控制台确认任务状态。');
}

async function addTaskResults(task, flowKey) {
  const flow = WORKFLOWS[flowKey];
  const results = task.results || [];
  const zip = results.find(item => String(item.outputType || '').toLowerCase() === 'zip' || /\.zip(?:$|\?)/i.test(item.url || ''));
  if (zip) {
    const unpacked = await unpackZip(zip);
    images.push(...unpacked.map(item => ({ ...item, name: `${flow.label}-${item.name}` })));
    ui.zipDownload.href = zip.url;
    ui.zipDownload.classList.remove('hidden');
    return;
  }
  for (const result of results) {
    if (result.url && /\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i.test(result.url)) {
      const response = await fetch(result.url);
      if (response.ok) {
        images.push({
          name: `${flow.label}-${result.nodeId || 'result'}.${result.outputType || 'png'}`,
          blob: await response.blob(),
        });
      }
    }
  }
}

function captureFlowFields() {
  return {
    steps: ui.steps.value,
    cfg: ui.cfg.value,
    sampler: ui.sampler.value,
    scheduler: ui.scheduler.value,
    denoise: ui.denoise.value,
  };
}

function restoreFlowFields(values) {
  Object.entries(values || {}).forEach(([key, value]) => {
    if (ui[key]) ui[key].value = value;
  });
}

function updateWorkflowMeta() {
  const flow = WORKFLOWS[activeWorkflow];
  ui.workflowEyebrow.textContent = `ANIME IMAGE GENERATION / WORKFLOW #${flow.id}`;
  ui.workflowLabel.textContent = flow.label;
  ui.workflowDescription.textContent = flow.description;
  ui.workflowHint.textContent = flow.hint;
  ui.workflowTag.textContent = flow.tag;
  ui.button.querySelector('span').textContent = `开始生成 ${flow.label}`;
  ui.workflowChoices.forEach(choice => {
    const selected = choice.dataset.workflow === activeWorkflow;
    choice.classList.toggle('active', selected);
    choice.setAttribute('aria-pressed', String(selected));
  });
}

function selectWorkflow(workflowKey) {
  if (!WORKFLOWS[workflowKey] || workflowKey === activeWorkflow) return;
  flowSnapshots[activeWorkflow] = captureFlowFields();
  activeWorkflow = workflowKey;
  restoreFlowFields(flowSnapshots[workflowKey] || FLOW_DEFAULTS[workflowKey]);
  updateWorkflowMeta();
}

function saveConfig() {
  const values = {
    workflow: activeWorkflow,
    prompt: ui.prompt.value,
    negative: ui.negative.value,
    width: ui.width.value,
    height: ui.height.value,
    batch: ui.batch.value,
    steps: ui.steps.value,
    cfg: ui.cfg.value,
    seed: ui.seed.value,
    sampler: ui.sampler.value,
    scheduler: ui.scheduler.value,
    denoise: ui.denoise.value,
    instance: ui.instance.value,
    addMetadata: ui.addMetadata.checked,
    personalQueue: ui.personalQueue.checked,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(values));
  showMessage('当前配置已保存，刷新页面后会自动恢复。', 'info');
}

function restoreConfig() {
  try {
    const values = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (!values) return null;
    const fields = {
      prompt: ui.prompt,
      negative: ui.negative,
      width: ui.width,
      height: ui.height,
      batch: ui.batch,
      steps: ui.steps,
      cfg: ui.cfg,
      seed: ui.seed,
      sampler: ui.sampler,
      scheduler: ui.scheduler,
      denoise: ui.denoise,
      instance: ui.instance,
    };
    Object.entries(fields).forEach(([key, input]) => {
      if (values[key] !== undefined) input.value = values[key];
    });
    if (typeof values.addMetadata === 'boolean') ui.addMetadata.checked = values.addMetadata;
    if (typeof values.personalQueue === 'boolean') ui.personalQueue.checked = values.personalQueue;
    return values;
  } catch {
    localStorage.removeItem(CONFIG_KEY);
    return null;
  }
}

function updateKeyState() {
  const saved = Boolean(localStorage.getItem('runninghub_api_key'));
  ui.keyState.textContent = saved ? '已保存' : '未设置';
  ui.keyState.classList.toggle('saved', saved);
}

function toggleSettings(force) {
  const open = typeof force === 'boolean' ? force : ui.settingsPanel.classList.contains('hidden');
  ui.settingsPanel.classList.toggle('hidden', !open);
  ui.settingsButton.setAttribute('aria-expanded', String(open));
  if (open) ui.apiKey.focus();
}

ui.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (active) return;
  const key = ui.apiKey.value.trim() || localStorage.getItem('runninghub_api_key') || '';
  if (!key) {
    showMessage('请先在右上角 API 设置中填写 RunningHub API Key。');
    return;
  }
  if (!ui.prompt.value.trim()) {
    showMessage('请先填写正向提示词。');
    ui.prompt.focus();
    return;
  }

  const flowKey = activeWorkflow;
  const values = formValues();
  active = true;
  ui.button.disabled = true;
  showMessage('');
  ui.empty.classList.add('hidden');
  ui.progress.classList.remove('hidden');
  ui.error.classList.add('hidden');
  ui.zipDownload.classList.add('hidden');
  setStatus('working', '生成中');
  ui.progressTitle.textContent = `正在提交 ${WORKFLOWS[flowKey].label} 任务…`;
  try {
    const submitted = await submit(key, flowKey, values);
    ui.taskId.textContent = submitted.taskId || '';
    const task = String(submitted.status || '').toUpperCase() === 'SUCCESS'
      ? submitted
      : await poll(submitted.taskId, key, flowKey);
    await addTaskResults(task, flowKey);
    updatePool();
    setStatus('success', '生成完成');
    ui.progress.classList.add('hidden');
    showMessage(`${WORKFLOWS[flowKey].label} 生成完成，结果已加入本地图片池。`, 'info');
  } catch (error) {
    ui.progress.classList.add('hidden');
    ui.error.classList.remove('hidden');
    ui.errorText.textContent = friendlyError(error);
    setStatus('error', '生成失败');
  } finally {
    active = false;
    ui.button.disabled = false;
  }
});

ui.prompt.addEventListener('input', () => {
  if (ui.prompt.value.length > 4000) ui.prompt.value = ui.prompt.value.slice(0, 4000);
  ui.count.textContent = ui.prompt.value.length;
});

document.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => {
  const [width, height] = button.dataset.size.split(',');
  ui.width.value = width;
  ui.height.value = height;
  document.querySelectorAll('.preset').forEach(item => item.classList.toggle('active', item === button));
}));

ui.workflowChoices.forEach(choice => choice.addEventListener('click', () => selectWorkflow(choice.dataset.workflow)));
ui.apiKey.value = localStorage.getItem('runninghub_api_key') || '';
const restored = restoreConfig();
if (restored?.workflow && WORKFLOWS[restored.workflow]) activeWorkflow = restored.workflow;
flowSnapshots[activeWorkflow] = captureFlowFields();
updateWorkflowMeta();
ui.prompt.dispatchEvent(new Event('input'));
updateKeyState();

ui.settingsButton.addEventListener('click', () => toggleSettings());
ui.closeSettings.addEventListener('click', () => toggleSettings(false));
ui.openSettingsHint.addEventListener('click', () => toggleSettings(true));
ui.toggleKey.addEventListener('click', () => {
  const show = ui.apiKey.type === 'password';
  ui.apiKey.type = show ? 'text' : 'password';
  ui.toggleKey.textContent = show ? '隐藏' : '显示';
});
ui.saveKey.addEventListener('click', () => {
  const key = ui.apiKey.value.trim();
  if (!key) {
    ui.settingsMessage.textContent = '请先填写 API Key。';
    ui.settingsMessage.className = 'settings-message error';
    return;
  }
  localStorage.setItem('runninghub_api_key', key);
  ui.settingsMessage.textContent = '设置已保存，主站与二次元页会同步使用。';
  ui.settingsMessage.className = 'settings-message';
  updateKeyState();
  setTimeout(() => toggleSettings(false), 650);
});
ui.clearKey.addEventListener('click', () => {
  localStorage.removeItem('runninghub_api_key');
  ui.apiKey.value = '';
  ui.settingsMessage.textContent = '本机已保存的 API Key 已清除。';
  ui.settingsMessage.className = 'settings-message';
  updateKeyState();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.settings-wrap')) toggleSettings(false);
});
ui.saveConfig.addEventListener('click', saveConfig);
ui.clearPool.addEventListener('click', () => {
  images = [];
  ui.zipDownload.classList.add('hidden');
  updatePool();
});
ui.retry.addEventListener('click', () => ui.error.classList.add('hidden'));
ui.closeLightbox.addEventListener('click', () => ui.lightbox.classList.add('hidden'));
ui.lightbox.addEventListener('click', event => {
  if (event.target === ui.lightbox) ui.lightbox.classList.add('hidden');
});
