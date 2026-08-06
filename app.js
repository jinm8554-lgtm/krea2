const API_BASE = 'https://www.runninghub.ai/openapi/v2';
const WORKFLOW_ID = '2080711492936511490';
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 10 * 60 * 1000;
const POOL_DB_NAME = 'krea2-runninghub-image-pool';
const POOL_STORE_NAME = 'images';

const $ = (id) => document.getElementById(id);
const ui = {
  form: $('generationForm'), prompt: $('prompt'), negative: $('negativePrompt'), width: $('width'), height: $('height'),
  steps: $('steps'), cfg: $('cfg'), batch: $('batchSize'), seed: $('seed'), sampler: $('sampler'), scheduler: $('scheduler'),
  instance: $('instanceType'), apiKey: $('apiKey'), addMetadata: $('addMetadata'), personalQueue: $('personalQueue'),
  button: $('generateButton'), message: $('formMessage'), badge: $('statusBadge'), empty: $('emptyState'), progress: $('progressState'),
  progressTitle: $('progressTitle'), progressDetail: $('progressDetail'), taskId: $('taskIdDisplay'), results: $('results'),
  error: $('errorState'), errorText: $('errorMessage'), errorTitle: $('errorTitle'), count: $('promptCount'), toggleKey: $('toggleKey'), retry: $('retryButton'),
  settingsButton: $('settingsButton'), settingsPanel: $('settingsPanel'), closeSettings: $('closeSettings'), saveKey: $('saveKey'), clearKey: $('clearKey'),
  settingsMessage: $('settingsMessage'), keyState: $('keyState'), openSettingsHint: $('openSettingsHint'),
  poolGrid: $('poolGrid'), poolCount: $('poolCount'), poolEmpty: $('poolEmpty'), clearPool: $('clearPool'), zipDownload: $('zipDownload'),
  lightbox: $('lightbox'), lightboxImage: $('lightboxImage'), lightboxName: $('lightboxName'), closeLightbox: $('closeLightbox'),
};

let activeTask = null;

function node(nodeId, fieldName, fieldValue) { return { nodeId: String(nodeId), fieldName, fieldValue }; }

function buildNodeInfoList() {
  const list = [
    node(164, 'text', ui.prompt.value.trim()),
    node(173, 'text', ui.negative.value.trim()),
    node(156, 'width', Number(ui.width.value)),
    node(156, 'height', Number(ui.height.value)),
    node(156, 'batch_size', Number(ui.batch.value)),
    node(158, 'steps', Number(ui.steps.value)),
    node(158, 'cfg', Number(ui.cfg.value)),
    node(158, 'sampler_name', ui.sampler.value),
    node(158, 'scheduler', ui.scheduler.value),
  ];
  if (ui.seed.value !== '') list.push(node(158, 'seed', Number(ui.seed.value)));
  return list;
}

function headers() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${ui.apiKey.value.trim()}` }; }
function setStatus(type, text) { ui.badge.className = `status ${type}`; ui.badge.textContent = text; }
function showView(view) { [ui.empty, ui.progress, ui.results, ui.error].forEach((element) => element.classList.add('hidden')); view.classList.remove('hidden'); }
function friendlyError(error) {
  if (error.name === 'TypeError' && /fetch/i.test(error.message)) return '无法连接到 RunningHub。请确认网络正常；若浏览器拦截跨域请求，请通过本地 HTTP 服务打开页面。';
  return error.message || '发生未知错误，请稍后重试。';
}
function setWorking(title, detail, taskId = '') { showView(ui.progress); setStatus('working', '处理中'); ui.progressTitle.textContent = title; ui.progressDetail.textContent = detail; ui.taskId.textContent = taskId ? `TASK ID · ${taskId}` : ''; }
function finishError(message, previewFailed = false) {
  activeTask = null; ui.button.disabled = false; ui.button.querySelector('span').textContent = '开始生成';
  ui.errorTitle.textContent = previewFailed ? '图片预览未完成' : '任务未能完成';
  setStatus(previewFailed ? 'success' : 'error', previewFailed ? '已生成，预览异常' : '生成失败');
  ui.errorText.textContent = previewFailed ? `云端任务已成功完成；${message}` : message;
  showView(ui.error);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); } catch { throw new Error(`服务返回了无法解析的响应（HTTP ${response.status}）。`); }
  if (!response.ok || data.errorCode || (typeof data.code === 'number' && data.code !== 0)) throw new Error(data.errorMessage || data.message || `请求失败（HTTP ${response.status}）`);
  return data;
}

async function submitTask() {
  const payload = {
    addMetadata: ui.addMetadata.checked,
    nodeInfoList: buildNodeInfoList(),
    instanceType: ui.instance.value,
    usePersonalQueue: ui.personalQueue.checked,
  };
  return requestJson(`${API_BASE}/run/workflow/${WORKFLOW_ID}`, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
}
async function getTask(taskId) { return requestJson(`${API_BASE}/query`, { method: 'POST', headers: headers(), body: JSON.stringify({ taskId }) }); }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollTask(taskId) {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT) {
    await pause(POLL_INTERVAL);
    const task = await getTask(taskId);
    activeTask = task;
    const status = String(task.status || '').toUpperCase();
    if (status === 'SUCCESS') return task;
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') throw new Error(task.errorMessage || task.failedReason?.message || `任务状态：${status}`);
    const display = status === 'QUEUED' ? '正在排队…' : '正在云端生成…';
    setWorking(display, status === 'QUEUED' ? 'RunningHub 正在等待可用算力' : 'Krea 2 正在渲染你的画面', taskId);
  }
  throw new Error('任务等待超过 10 分钟，请前往 RunningHub 控制台确认任务状态。');
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
}
async function imageResultToCacheEntry(result) {
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`无法下载图片结果（HTTP ${response.status}）。`);
  return { name: `结果-${result.nodeId || 'image'}.${result.outputType || 'png'}`, blob: await response.blob() };
}

async function renderResults(task) {
  const outputs = task.results || [];
  if (!outputs.length) throw new Error('任务已成功，但未返回任何结果文件。');
  const imagesToCache = [];
  let zipUrl = '';
  for (const result of outputs) {
    if (result.text) continue;
    if (!result.url) continue;
    if (isZip(result)) {
      zipUrl = result.url;
      setWorking('正在解压生成结果…', '浏览器正在读取 ZIP 中的图片', task.taskId);
      const images = await unpackZip(result);
      imagesToCache.push(...images);
    } else if (/\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i.test(result.url)) imagesToCache.push(await imageResultToCacheEntry(result));
  }
  if (!imagesToCache.length) throw new Error('任务已完成，但没有可预览的图片输出。');
  await cacheImages(imagesToCache);
  ui.zipDownload.href = zipUrl;
  ui.zipDownload.classList.toggle('hidden', !zipUrl);
  await renderImagePool();
  ui.button.disabled = false; ui.button.querySelector('span').textContent = '再次生成'; setStatus('success', '生成完成'); showView(ui.results);
}

ui.form.addEventListener('submit', async (event) => {
  event.preventDefault(); ui.message.textContent = '';
  if (!ui.prompt.value.trim()) { ui.message.textContent = '请先写下你想生成的画面。'; ui.prompt.focus(); return; }
  if (!ui.apiKey.value.trim()) { ui.message.textContent = '请填写 RunningHub API Key。'; ui.apiKey.focus(); return; }
  if (!window.JSZip) { ui.message.textContent = 'ZIP 解压组件加载失败，请检查网络后刷新。'; return; }
  try {
    ui.button.disabled = true; ui.button.querySelector('span').textContent = '正在提交…';
    setWorking('正在提交任务…', '加密发送请求至 RunningHub');
    const task = await submitTask(); activeTask = task;
    if (!task.taskId) throw new Error(task.errorMessage || 'RunningHub 未返回 taskId。');
    setWorking(task.status === 'QUEUED' ? '任务正在排队…' : '正在云端生成…', 'Krea 2 已接收你的创作请求', task.taskId);
    const finalTask = String(task.status).toUpperCase() === 'SUCCESS' ? task : await pollTask(task.taskId);
    await renderResults(finalTask);
  } catch (error) { finishError(friendlyError(error), String(activeTask?.status || '').toUpperCase() === 'SUCCESS'); }
});

ui.prompt.addEventListener('input', () => { if (ui.prompt.value.length > 4000) ui.prompt.value = ui.prompt.value.slice(0, 4000); ui.count.textContent = ui.prompt.value.length; });
document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => { const [width, height] = button.dataset.size.split(','); ui.width.value = width; ui.height.value = height; document.querySelectorAll('.preset').forEach((item) => item.classList.toggle('active', item === button)); }));
ui.toggleKey.addEventListener('click', () => { const show = ui.apiKey.type === 'password'; ui.apiKey.type = show ? 'text' : 'password'; ui.toggleKey.textContent = show ? '隐藏' : '显示'; });
ui.retry.addEventListener('click', () => { ui.error.classList.add('hidden'); showView(ui.empty); setStatus('idle', '等待提交'); });

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
  if (!images.length) return;
  await renderImagePool();
  setStatus('success', '图片池已恢复');
  showView(ui.results);
}).catch(() => { /* Browser storage may be unavailable in private browsing. */ });
