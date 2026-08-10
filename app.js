const API_BASE = 'https://www.runninghub.ai/openapi/v2';
const CANCEL_TASK_URL = 'https://www.runninghub.ai/task/openapi/cancel';
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 10 * 60 * 1000;
const POOL_DB_NAME = 'krea2-runninghub-image-pool';
const POOL_STORE_NAME = 'images';
const WORKFLOWS = Object.freeze({
  mj: {
    id: '2080711492936511490',
    name: 'MJ 风格',
    description: '多 LoRA 艺术画像 · PNG 打包为 ZIP 输出',
    nodes: { prompt: 164, negativePrompt: 173, canvas: 156, sampler: 158 },
  },
  street: {
    id: '2085388143034281986',
    name: '街拍风格',
    description: '真实感街头人像 · PNG 打包为 ZIP 输出',
    nodes: { prompt: 164, negativePrompt: 173, canvas: 156, sampler: 158 },
  },
});

const $ = (id) => document.getElementById(id);
const ui = {
  form: $('generationForm'), prompt: $('prompt'), negative: $('negativePrompt'), width: $('width'), height: $('height'),
  steps: $('steps'), cfg: $('cfg'), batch: $('batchSize'), seed: $('seed'), sampler: $('sampler'), scheduler: $('scheduler'),
  instance: $('instanceType'), apiKey: $('apiKey'), addMetadata: $('addMetadata'), personalQueue: $('personalQueue'),
  button: $('generateButton'), message: $('formMessage'), badge: $('statusBadge'), empty: $('emptyState'), progress: $('progressState'), taskQueue: $('taskQueue'),
  progressTitle: $('progressTitle'), progressDetail: $('progressDetail'), taskId: $('taskIdDisplay'), results: $('results'),
  error: $('errorState'), errorText: $('errorMessage'), errorTitle: $('errorTitle'), count: $('promptCount'), toggleKey: $('toggleKey'), retry: $('retryButton'),
  settingsButton: $('settingsButton'), settingsPanel: $('settingsPanel'), closeSettings: $('closeSettings'), saveKey: $('saveKey'), clearKey: $('clearKey'),
  settingsMessage: $('settingsMessage'), keyState: $('keyState'), openSettingsHint: $('openSettingsHint'),
  poolGrid: $('poolGrid'), poolCount: $('poolCount'), poolEmpty: $('poolEmpty'), clearPool: $('clearPool'), zipDownload: $('zipDownload'),
  lightbox: $('lightbox'), lightboxImage: $('lightboxImage'), lightboxName: $('lightboxName'), closeLightbox: $('closeLightbox'),
  workflowIdLabel: $('workflowIdLabel'), workflowName: $('workflowName'), workflowDescription: $('workflowDescription'),
  workflowButtons: document.querySelectorAll('.workflow-choice'), saveConfig: $('saveConfig'),
};

const MAX_CONCURRENT_TASKS = 3;
const CONFIG_STORAGE_KEY = 'krea2-main-configuration-v1';
const taskRecords = [];
const runningTaskKeys = new Set();
let selectedWorkflowKey = localStorage.getItem('krea2_selected_workflow');
if (!WORKFLOWS[selectedWorkflowKey]) selectedWorkflowKey = 'mj';

function currentWorkflow() { return WORKFLOWS[selectedWorkflowKey]; }
function updateWorkflowUi() {
  const workflow = currentWorkflow();
  ui.workflowIdLabel.textContent = `IMAGE GENERATION / WORKFLOW #${workflow.id}`;
  ui.workflowName.textContent = workflow.name;
  ui.workflowDescription.textContent = workflow.description;
  ui.workflowButtons.forEach((button) => {
    const active = button.dataset.workflow === selectedWorkflowKey;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function saveCurrentConfiguration() {
  const configuration = {
    workflow: selectedWorkflowKey, prompt: ui.prompt.value, negative: ui.negative.value, width: ui.width.value, height: ui.height.value,
    steps: ui.steps.value, cfg: ui.cfg.value, batch: ui.batch.value, seed: ui.seed.value, sampler: ui.sampler.value, scheduler: ui.scheduler.value,
    instance: ui.instance.value, addMetadata: ui.addMetadata.checked, personalQueue: ui.personalQueue.checked,
  };
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configuration));
  ui.message.textContent = '当前配置已保存，刷新页面后会自动恢复。'; ui.message.className = 'form-message info';
}
function restoreCurrentConfiguration() {
  try {
    const configuration = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null'); if (!configuration) return;
    if (WORKFLOWS[configuration.workflow]) selectedWorkflowKey = configuration.workflow;
    const values = { prompt: ui.prompt, negative: ui.negative, width: ui.width, height: ui.height, steps: ui.steps, cfg: ui.cfg, batch: ui.batch, seed: ui.seed, sampler: ui.sampler, scheduler: ui.scheduler, instance: ui.instance };
    Object.entries(values).forEach(([key, input]) => { if (configuration[key] !== undefined && configuration[key] !== null) input.value = configuration[key]; });
    if (typeof configuration.addMetadata === 'boolean') ui.addMetadata.checked = configuration.addMetadata;
    if (typeof configuration.personalQueue === 'boolean') ui.personalQueue.checked = configuration.personalQueue;
  } catch { localStorage.removeItem(CONFIG_STORAGE_KEY); }
}

function node(nodeId, fieldName, fieldValue) { return { nodeId: String(nodeId), fieldName, fieldValue }; }

function buildNodeInfoList(workflow) {
  const nodes = workflow.nodes;
  const list = [
    node(nodes.prompt, 'text', ui.prompt.value.trim()),
    node(nodes.negativePrompt, 'text', ui.negative.value.trim()),
    node(nodes.canvas, 'width', Number(ui.width.value)),
    node(nodes.canvas, 'height', Number(ui.height.value)),
    node(nodes.canvas, 'batch_size', Number(ui.batch.value)),
    node(nodes.sampler, 'steps', Number(ui.steps.value)),
    node(nodes.sampler, 'cfg', Number(ui.cfg.value)),
    node(nodes.sampler, 'sampler_name', ui.sampler.value),
    node(nodes.sampler, 'scheduler', ui.scheduler.value),
  ];
  if (ui.seed.value !== '') list.push(node(nodes.sampler, 'seed', Number(ui.seed.value)));
  return list;
}

function headers(key = ui.apiKey.value.trim()) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }; }
function setStatus(type, text) { ui.badge.className = `status ${type}`; ui.badge.textContent = text; }
function friendlyError(error) {
  if (error.name === 'TypeError' && /fetch/i.test(error.message)) return '无法连接到 RunningHub。请确认网络正常；若浏览器拦截跨域请求，请通过本地 HTTP 服务打开页面。';
  return error.message || '发生未知错误，请稍后重试。';
}
function createTaskRecord(workflow) {
  return { key: imageId(), taskId: '', workflowName: workflow.name, status: '正在提交', detail: '连接 RunningHub 云端', state: 'working', isActive: true, startedAt: Date.now(), zipUrl: '', error: '', apiKey: ui.apiKey.value.trim(), cancelRequested: false, cancelling: false };
}
function updateTaskRecord(record, status, detail, state = 'working') {
  record.status = status; record.detail = detail; record.state = state;
  renderTaskQueue(); updateOutputVisibility();
}
function renderTaskQueue() {
  const records = taskRecords.slice(-6).reverse();
  ui.taskQueue.innerHTML = '';
  ui.taskQueue.classList.toggle('hidden', records.length === 0);
  records.forEach((record) => {
    const card = document.createElement('article');
    card.className = `task-card ${record.state}`;
    const marker = document.createElement('i'); marker.className = 'task-marker';
    const summary = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${record.workflowName} · ${record.status}`;
    const detail = document.createElement('small'); detail.textContent = record.taskId ? `${record.detail} · ${record.taskId}` : record.detail;
    summary.append(title, detail);
    const time = document.createElement('time'); time.textContent = record.isActive ? '进行中' : '已结束';
    card.append(marker, summary, time);
    if (record.isActive && record.taskId) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'cancel-task';
      cancel.textContent = record.cancelling ? '取消中…' : '取消';
      cancel.disabled = record.cancelling;
      cancel.addEventListener('click', () => cancelTask(record));
      card.append(cancel);
    }
    if (record.zipUrl) { const zipLink = document.createElement('a'); zipLink.href = record.zipUrl; zipLink.target = '_blank'; zipLink.rel = 'noreferrer'; zipLink.textContent = '下载 ZIP ↗'; card.append(zipLink); }
    if (record.error) { const error = document.createElement('p'); error.className = 'task-error'; error.textContent = record.error; card.append(error); }
    ui.taskQueue.append(card);
  });
}
function updateOutputVisibility() {
  const hasImages = ui.poolGrid.children.length > 0;
  const hasRunningTasks = runningTaskKeys.size > 0;
  ui.error.classList.add('hidden');
  ui.empty.classList.toggle('hidden', hasImages || hasRunningTasks);
  ui.progress.classList.toggle('hidden', hasImages || !hasRunningTasks);
  ui.results.classList.toggle('hidden', !hasImages);
  ui.button.querySelector('span').textContent = hasRunningTasks ? `开始生成（${runningTaskKeys.size}/${MAX_CONCURRENT_TASKS}）` : hasImages ? '再次生成' : '开始生成';
  if (hasRunningTasks) { setStatus('working', `${runningTaskKeys.size}/${MAX_CONCURRENT_TASKS} 个任务运行中`); ui.progressTitle.textContent = '正在生成图片…'; ui.progressDetail.textContent = '已有图片会持续显示在图片池中'; }
  else if (hasImages) setStatus('success', '图片池已就绪');
  else setStatus('idle', '等待提交');
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); } catch { throw new Error(`服务返回了无法解析的响应（HTTP ${response.status}）。`); }
  if (!response.ok || data.errorCode || (typeof data.code === 'number' && data.code !== 0)) throw new Error(data.errorMessage || data.message || `请求失败（HTTP ${response.status}）`);
  return data;
}

async function submitTask(workflow, key) {
  const payload = {
    addMetadata: ui.addMetadata.checked,
    nodeInfoList: buildNodeInfoList(workflow),
    instanceType: ui.instance.value,
    usePersonalQueue: ui.personalQueue.checked,
  };
  return requestJson(`${API_BASE}/run/workflow/${workflow.id}`, { method: 'POST', headers: headers(key), body: JSON.stringify(payload) });
}
async function getTask(taskId, key) { return requestJson(`${API_BASE}/query`, { method: 'POST', headers: headers(key), body: JSON.stringify({ taskId }) }); }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollTask(taskId, record) {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT) {
    await pause(POLL_INTERVAL);
    if (record.cancelRequested) return null;
    const task = await getTask(taskId, record.apiKey);
    const status = String(task.status || '').toUpperCase();
    if (status === 'SUCCESS') return task;
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') throw new Error(task.errorMessage || task.failedReason?.message || `任务状态：${status}`);
    const display = status === 'QUEUED' ? '正在排队…' : '正在云端生成…';
    updateTaskRecord(record, display, status === 'QUEUED' ? 'RunningHub 正在等待可用算力' : 'Krea 2 正在渲染你的画面');
  }
  throw new Error('任务等待超过 10 分钟，请前往 RunningHub 控制台确认任务状态。');
}

async function cancelTask(record) {
  if (!record.isActive || !record.taskId || record.cancelling) return;
  record.cancelling = true;
  updateTaskRecord(record, '正在取消…', '正在向 RunningHub 发送取消指令');
  try {
    await requestJson(CANCEL_TASK_URL, {
      method: 'POST',
      headers: headers(record.apiKey),
      body: JSON.stringify({ apiKey: record.apiKey, taskId: record.taskId }),
    });
    record.cancelRequested = true;
    updateTaskRecord(record, '已发送取消指令', '云端任务将停止执行');
  } catch (error) {
    record.cancelling = false;
    updateTaskRecord(record, '取消失败', friendlyError(error), 'working');
  }
}

function isImage(file) { return /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name); }
function isZip(result) { return String(result.outputType || '').toLowerCase() === 'zip' || /\.zip(?:$|\?)/i.test(result.url || ''); }

async function unpackZip(result) {
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`无法下载 ZIP 结果（HTTP ${response.status}）。`);
  const zip = await JSZip.loadAsync(await response.blob());
  const images = [];
  for (const file of Object.values(zip.files)) {
    if (!file.dir && isImage(file)) {
      const blob = await file.async('blob');
      images.push({ name: file.name.split('/').pop(), blob });
    }
  }
  if (!images.length) throw new Error('ZIP 已下载，但其中没有识别到 PNG、JPG、WEBP、GIF 或 AVIF 图片。');
  return images;
}

function openPoolDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POOL_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(POOL_STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function poolRequest(operation) {
  return openPoolDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(POOL_STORE_NAME, 'readwrite');
    const request = operation(transaction.objectStore(POOL_STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
function imageId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
async function cacheImages(images) {
  for (const image of images) {
    if (!(image.blob instanceof Blob)) throw new Error('图片缓存数据无效，无法写入本地图片池。');
    await poolRequest((store) => store.put({ id: imageId(), name: image.name, blob: image.blob, createdAt: Date.now() }));
  }
}
async function getCachedImages() {
  const images = await poolRequest((store) => store.getAll());
  return images.sort((a, b) => b.createdAt - a.createdAt);
}
async function deleteCachedImage(id) { await poolRequest((store) => store.delete(id)); }
async function clearCachedImages() { await poolRequest((store) => store.clear()); }
function closeLightbox() { ui.lightbox.classList.add('hidden'); ui.lightboxImage.removeAttribute('src'); }
function openLightbox(image) {
  ui.lightboxImage.src = image.url; ui.lightboxImage.alt = image.name; ui.lightboxName.textContent = image.name;
  ui.lightbox.classList.remove('hidden'); ui.closeLightbox.focus();
}
function addImageCard(image) {
  const fragment = $('imageCardTemplate').content.cloneNode(true);
  const imageLink = fragment.querySelector('.image-link'); const img = fragment.querySelector('img'); const download = fragment.querySelector('.download-image');
  imageLink.addEventListener('click', () => openLightbox(image));
  img.src = image.url; img.alt = image.name; fragment.querySelector('.image-name').textContent = image.name;
  download.href = image.url; download.download = image.name;
  fragment.querySelector('.delete-image').addEventListener('click', async () => { await deleteCachedImage(image.id); URL.revokeObjectURL(image.url); await renderImagePool(); });
  ui.poolGrid.append(fragment);
}
async function renderImagePool() {
  const cachedImages = await getCachedImages();
  const invalidImages = cachedImages.filter((image) => !(image.blob instanceof Blob));
  await Promise.all(invalidImages.map((image) => deleteCachedImage(image.id)));
  const validImages = cachedImages.filter((image) => image.blob instanceof Blob);
  ui.poolGrid.querySelectorAll('img').forEach((image) => URL.revokeObjectURL(image.src));
  ui.poolGrid.innerHTML = '';
  ui.poolCount.textContent = `${validImages.length} 张图片`;
  ui.poolEmpty.classList.toggle('hidden', validImages.length > 0);
  validImages.forEach((image) => addImageCard({ ...image, url: URL.createObjectURL(image.blob) }));
  updateOutputVisibility();
}
async function imageResultToCacheEntry(result) {
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`无法下载图片结果（HTTP ${response.status}）。`);
  return { name: `结果-${result.nodeId || 'image'}.${result.outputType || 'png'}`, blob: await response.blob() };
}

async function renderResults(task, record) {
  const outputs = task.results || [];
  if (!outputs.length) throw new Error('任务已成功，但未返回任何结果文件。');
  const imagesToCache = [];
  let zipUrl = '';
  for (const result of outputs) {
    if (result.text) continue;
    if (!result.url) continue;
    if (isZip(result)) {
      zipUrl = result.url;
      updateTaskRecord(record, '正在解压结果…', '浏览器正在读取 ZIP 中的图片');
      const images = await unpackZip(result);
      imagesToCache.push(...images);
    } else if (/\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i.test(result.url)) imagesToCache.push(await imageResultToCacheEntry(result));
  }
  if (!imagesToCache.length) throw new Error('任务已完成，但没有可预览的图片输出。');
  await cacheImages(imagesToCache);
  ui.zipDownload.href = zipUrl;
  ui.zipDownload.classList.toggle('hidden', !zipUrl);
  record.zipUrl = zipUrl;
  await renderImagePool();
  updateTaskRecord(record, '生成完成', `${imagesToCache.length} 张图片已加入图片池`, 'completed');
}

ui.form.addEventListener('submit', async (event) => {
  event.preventDefault(); ui.message.textContent = '';
  if (!ui.prompt.value.trim()) { ui.message.textContent = '请先写下你想生成的画面。'; ui.prompt.focus(); return; }
  if (!ui.apiKey.value.trim()) { ui.message.textContent = '请填写 RunningHub API Key。'; ui.apiKey.focus(); return; }
  if (!window.JSZip) { ui.message.textContent = 'ZIP 解压组件加载失败，请检查网络后刷新。'; return; }
  if (runningTaskKeys.size >= MAX_CONCURRENT_TASKS) { ui.message.textContent = `最多同时运行 ${MAX_CONCURRENT_TASKS} 个任务，请等待任一任务完成后再提交。`; return; }
  const workflow = currentWorkflow();
  const record = createTaskRecord(workflow);
  taskRecords.push(record);
  runningTaskKeys.add(record.key);
  renderTaskQueue(); updateOutputVisibility();
  try {
    const task = await submitTask(workflow, record.apiKey);
    if (!task.taskId) throw new Error(task.errorMessage || 'RunningHub 未返回 taskId。');
    record.taskId = task.taskId;
    updateTaskRecord(record, task.status === 'QUEUED' ? '正在排队…' : '正在云端生成…', 'Krea 2 已接收你的创作请求');
    const finalTask = String(task.status).toUpperCase() === 'SUCCESS' ? task : await pollTask(task.taskId, record);
    if (!record.cancelRequested) await renderResults(finalTask, record);
  } catch (error) {
    if (!record.cancelRequested) {
      record.error = friendlyError(error);
      updateTaskRecord(record, '任务异常', record.error, 'failed');
    }
  } finally {
    record.isActive = false;
    if (record.cancelRequested) updateTaskRecord(record, '任务已取消', '已停止本地轮询；取消请求已发送至云端', 'cancelled');
    runningTaskKeys.delete(record.key);
    renderTaskQueue(); updateOutputVisibility();
  }
});

ui.prompt.addEventListener('input', () => { if (ui.prompt.value.length > 4000) ui.prompt.value = ui.prompt.value.slice(0, 4000); ui.count.textContent = ui.prompt.value.length; });
document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => { const [width, height] = button.dataset.size.split(','); ui.width.value = width; ui.height.value = height; document.querySelectorAll('.preset').forEach((item) => item.classList.toggle('active', item === button)); }));
ui.workflowButtons.forEach((button) => button.addEventListener('click', () => {
  const workflowKey = button.dataset.workflow;
  if (!WORKFLOWS[workflowKey] || workflowKey === selectedWorkflowKey) return;
  selectedWorkflowKey = workflowKey;
  localStorage.setItem('krea2_selected_workflow', selectedWorkflowKey);
  updateWorkflowUi();
  ui.message.textContent = `已切换到${currentWorkflow().name}工作流。`;
  ui.message.className = 'form-message info';
}));
ui.saveConfig.addEventListener('click', saveCurrentConfiguration);
ui.toggleKey.addEventListener('click', () => { const show = ui.apiKey.type === 'password'; ui.apiKey.type = show ? 'text' : 'password'; ui.toggleKey.textContent = show ? '隐藏' : '显示'; });
ui.retry.addEventListener('click', () => { ui.error.classList.add('hidden'); updateOutputVisibility(); });

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
ui.apiKey.value = localStorage.getItem('runninghub_api_key') || '';
restoreCurrentConfiguration();
ui.prompt.dispatchEvent(new Event('input'));
updateWorkflowUi();
updateKeyState();
ui.settingsButton.addEventListener('click', () => toggleSettings());
ui.closeSettings.addEventListener('click', () => toggleSettings(false));
ui.openSettingsHint.addEventListener('click', () => toggleSettings(true));
ui.saveKey.addEventListener('click', () => {
  const key = ui.apiKey.value.trim();
  if (!key) { ui.settingsMessage.textContent = '请先填写 API Key。'; ui.settingsMessage.className = 'settings-message error'; return; }
  localStorage.setItem('runninghub_api_key', key);
  ui.settingsMessage.textContent = '设置已保存到此浏览器。'; ui.settingsMessage.className = 'settings-message'; updateKeyState();
  setTimeout(() => toggleSettings(false), 650);
});
ui.clearKey.addEventListener('click', () => {
  localStorage.removeItem('runninghub_api_key'); ui.apiKey.value = ''; ui.settingsMessage.textContent = '本机已保存的 API Key 已清除。'; ui.settingsMessage.className = 'settings-message'; updateKeyState();
});
document.addEventListener('click', (event) => { if (!event.target.closest('.settings-wrap')) toggleSettings(false); });

ui.clearPool.addEventListener('click', async () => {
  await clearCachedImages();
  ui.zipDownload.classList.add('hidden');
  await renderImagePool();
});
ui.closeLightbox.addEventListener('click', closeLightbox);
ui.lightbox.addEventListener('click', (event) => { if (event.target === ui.lightbox) closeLightbox(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLightbox(); });

// Restores cached images after a refresh without exposing them to a server.
getCachedImages().then(async (images) => {
  if (images.length) await renderImagePool();
  updateOutputVisibility();
}).catch(() => { /* Browser storage may be unavailable in private browsing. */ });
