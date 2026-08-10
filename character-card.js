const API_BASE = 'https://www.runninghub.ai/openapi/v2';
const CANCEL_TASK_URL = 'https://www.runninghub.ai/task/openapi/cancel';
const WORKFLOW_ID = '2085397311380172802';
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 10 * 60 * 1000;
const MAX_CONCURRENT_TASKS = 3;
const POOL_DB_NAME = 'krea2-runninghub-image-pool';
const POOL_STORE_NAME = 'images';
const CONFIG_STORAGE_KEY = 'krea2-character-card-configuration-v1';
const MODEL_CALLER_STORAGE_KEY = 'krea2-openai-compatible-caller-v1';
const DEFAULT_BASE_PROMPT = 'Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views';

const $ = (id) => document.getElementById(id);
const ui = {
  form: $('cardForm'), file: $('referenceImage'), preview: $('referencePreview'), uploadTitle: $('uploadTitle'), uploadDetail: $('uploadDetail'),
  prompt: $('characterPrompt'), basePrompt: $('basePrompt'), optimize: $('optimizeCharacterPrompt'), anime: $('animeCharacter'), width: $('width'), height: $('height'), steps: $('steps'), cfg: $('cfg'), seed: $('seed'), negative: $('negativePrompt'),
  button: $('generateButton'), message: $('formMessage'), keyStatus: $('keyStatus'), status: $('status'), empty: $('empty'), progress: $('progress'), results: $('results'),
  progressTitle: $('progressTitle'), progressDetail: $('progressDetail'), taskQueue: $('taskQueue'), poolGrid: $('poolGrid'), poolCount: $('poolCount'), poolEmpty: $('poolEmpty'), clearPool: $('clearPool'),
  lightbox: $('lightbox'), lightboxImage: $('lightboxImage'), lightboxName: $('lightboxName'), closeLightbox: $('closeLightbox'), saveConfig: $('saveConfig'),
};

const taskRecords = [];
const runningTaskKeys = new Set();

function apiKey() { return localStorage.getItem('runninghub_api_key') || ''; }
function headers(key) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }; }
function node(nodeId, fieldName, fieldValue) { return { nodeId: String(nodeId), fieldName, fieldValue }; }
function imageId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function setStatus(type, text) { ui.status.className = `status ${type}`; ui.status.textContent = text; }
function friendlyError(error) {
  if (error.name === 'TypeError' && /fetch/i.test(error.message)) return '无法连接到 RunningHub，请检查网络或浏览器跨域限制。';
  return error.message || '发生未知错误，请稍后重试。';
}
function updateKeyStatus() {
  const ready = Boolean(apiKey());
  ui.keyStatus.textContent = ready ? '已共享 API Key' : '主页面尚未保存 API Key';
  ui.keyStatus.classList.toggle('ready', ready);
}
function readJobInput() {
  return {
    key: apiKey(), file: ui.file.files[0], prompt: ui.prompt.value.trim(), basePrompt: ui.basePrompt.value.trim(), anime: ui.anime.checked,
    width: Number(ui.width.value), height: Number(ui.height.value), steps: Number(ui.steps.value), cfg: Number(ui.cfg.value),
    seed: ui.seed.value === '' ? null : Number(ui.seed.value), negative: ui.negative.value.trim(),
  };
}
function saveCurrentConfiguration() {
  const configuration = { prompt: ui.prompt.value, basePrompt: ui.basePrompt.value, anime: ui.anime.checked, width: ui.width.value, height: ui.height.value, steps: ui.steps.value, cfg: ui.cfg.value, seed: ui.seed.value, negative: ui.negative.value };
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configuration)); ui.message.textContent = '当前配置已保存，刷新页面后会自动恢复。'; ui.message.className = 'form-message info';
}
function restoreCurrentConfiguration() {
  try {
    const configuration = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null'); if (!configuration) return;
    const values = { prompt: ui.prompt, basePrompt: ui.basePrompt, width: ui.width, height: ui.height, steps: ui.steps, cfg: ui.cfg, seed: ui.seed, negative: ui.negative };
    Object.entries(values).forEach(([key, input]) => { if (configuration[key] !== undefined && configuration[key] !== null) input.value = configuration[key]; });
    if (typeof configuration.anime === 'boolean') ui.anime.checked = configuration.anime;
  } catch { localStorage.removeItem(CONFIG_STORAGE_KEY); }
}
function createTaskRecord(job) {
  return { key: imageId(), taskId: '', apiKey: job.key, status: '正在提交', detail: '准备上传角色参考图', state: 'working', isActive: true, error: '', zipUrl: '', cancelRequested: false, cancelling: false };
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
    const card = document.createElement('article'); card.className = `task-card ${record.state}`;
    const marker = document.createElement('i'); marker.className = 'task-marker';
    const summary = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `四视图角色卡 · ${record.status}`;
    const detail = document.createElement('small'); detail.textContent = record.taskId ? `${record.detail} · ${record.taskId}` : record.detail;
    summary.append(title, detail);
    const time = document.createElement('time'); time.textContent = record.isActive ? '进行中' : '已结束';
    card.append(marker, summary, time);
    if (record.isActive && record.taskId) {
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'cancel-task';
      cancel.textContent = record.cancelling ? '取消中…' : '取消'; cancel.disabled = record.cancelling;
      cancel.addEventListener('click', () => cancelTask(record)); card.append(cancel);
    }
    if (record.zipUrl) { const link = document.createElement('a'); link.href = record.zipUrl; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '下载 ZIP ↗'; card.append(link); }
    if (record.error) { const error = document.createElement('p'); error.className = 'task-error'; error.textContent = record.error; card.append(error); }
    ui.taskQueue.append(card);
  });
}
function updateOutputVisibility() {
  const hasImages = ui.poolGrid.children.length > 0;
  const hasRunning = runningTaskKeys.size > 0;
  ui.empty.classList.toggle('hidden', hasImages || hasRunning);
  ui.progress.classList.toggle('hidden', hasImages || !hasRunning);
  ui.results.classList.toggle('hidden', !hasImages);
  ui.button.querySelector('span').textContent = hasRunning ? `生成四视图角色卡（${runningTaskKeys.size}/${MAX_CONCURRENT_TASKS}）` : hasImages ? '再次生成四视图角色卡' : '生成四视图角色卡';
  if (hasRunning) { setStatus('working', `${runningTaskKeys.size}/${MAX_CONCURRENT_TASKS} 个任务运行中`); ui.progressTitle.textContent = '正在生成四视图角色卡…'; ui.progressDetail.textContent = '已生成图片会持续显示在共享图片池中'; }
  else if (hasImages) setStatus('success', '图片池已就绪');
  else setStatus('idle', '等待提交');
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); } catch { throw new Error(`服务器返回了无法解析的响应（HTTP ${response.status}）。`); }
  if (!response.ok || data.errorCode || (typeof data.code === 'number' && data.code !== 0)) throw new Error(data.errorMessage || data.message || `请求失败（HTTP ${response.status}）`);
  return data;
}
async function uploadReference(file, key) {
  const formData = new FormData(); formData.append('file', file);
  const response = await fetch(`${API_BASE}/media/upload/binary`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: formData });
  let data; try { data = await response.json(); } catch { throw new Error(`上传服务返回异常（HTTP ${response.status}）。`); }
  if (!response.ok || data.code !== 0 || !data.data?.fileName) throw new Error(data.message || '角色参考图上传失败。');
  return data.data.fileName;
}
function buildNodeInfoList(job, fileName) {
  const basePrompt = job.basePrompt || DEFAULT_BASE_PROMPT;
  const list = [
    node(72, 'image', fileName), node(119, 'prompt', job.prompt ? `${basePrompt}. ${job.prompt}` : basePrompt),
    node(85, 'prompt', job.negative), node(170, 'value', job.anime), node(135, 'width', job.width), node(135, 'height', job.height),
    node(53, 'steps', job.steps), node(53, 'cfg', job.cfg),
  ];
  if (job.seed !== null) list.push(node(53, 'seed', job.seed));
  return list;
}
function modelCallerConfiguration() { try { return JSON.parse(localStorage.getItem(MODEL_CALLER_STORAGE_KEY) || '{}'); } catch { return {}; } }
function chatCompletionsUrl(endpoint) { const base = endpoint.trim().replace(/\/+$/, '').replace(/\/models(?:\?.*)?$/i, ''); if (!base) throw new Error('请先在模型调用器中保存服务地址。'); return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`; }
function fileAsDataUri(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取角色参考图。')); reader.readAsDataURL(file); }); }
function completionText(payload) { const content = payload?.choices?.[0]?.message?.content; if (typeof content === 'string') return content.trim(); if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || '').join('').trim(); return ''; }
async function optimizeCharacterPrompt() {
  const file = ui.file.files[0]; const extra = ui.prompt.value.trim(); const modelConfig = modelCallerConfiguration();
  if (!file) { ui.message.textContent = '请先上传角色参考图，再使用 AI 优化。'; return; }
  if (!modelConfig.endpoint || !modelConfig.apiKey || !modelConfig.model) { ui.message.textContent = '请先在“模型调用器”页面保存服务地址、密钥并选择模型。'; return; }
  ui.optimize.disabled = true; ui.optimize.textContent = '分析中…'; ui.message.textContent = '正在调用已保存模型识别角色参考图…'; ui.message.className = 'form-message info';
  try {
    const response = await fetch(chatCompletionsUrl(modelConfig.endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modelConfig.apiKey}` }, body: JSON.stringify({ model: modelConfig.model, temperature: 0.35, messages: [
      { role: 'system', content: '你是角色设定提示词助手。根据用户上传的角色参考图，生成一段简洁、可用于四视图角色卡生成的中文角色描述。只描述可见的人物外观特征：五官与脸部特征、发型与发色、衣着、体型与肢体特征、饰品、妆容和材质风格。不要描述人物姿势、动作、手势、镜头构图、场景或背景。用户已有文字时，将其与图片信息自然融合。只输出最终描述本身，不要标题、解释、思考过程、Markdown 或引号，也不要推断真实身份或不可见信息。' },
      { role: 'user', content: [{ type: 'text', text: extra ? `用户补充描述：${extra}\n请结合图片优化角色描述。` : '用户没有文字描述。请仅根据图片生成角色描述。' }, { type: 'image_url', image_url: { url: await fileAsDataUri(file) } }] },
    ] }) });
    let payload; try { payload = await response.json(); } catch { throw new Error(`模型服务返回了无法解析的数据（HTTP ${response.status}）。`); }
    if (!response.ok) throw new Error(payload.error?.message || payload.message || `模型调用失败（HTTP ${response.status}）。`);
    const optimized = completionText(payload).replace(/^```(?:text)?\s*/i, '').replace(/```$/i, '').trim(); if (!optimized) throw new Error('模型未返回可用的角色描述。');
    ui.prompt.value = optimized; ui.message.textContent = '角色描述已由模型生成并替换。'; ui.message.className = 'form-message info';
  } catch (error) { ui.message.textContent = error.message || 'AI 优化失败，请检查模型调用器配置或跨域设置。'; ui.message.className = 'form-message'; }
  finally { ui.optimize.disabled = false; ui.optimize.textContent = '✦ AI 优化'; }
}
async function submitTask(job, fileName) {
  return requestJson(`${API_BASE}/run/workflow/${WORKFLOW_ID}`, {
    method: 'POST', headers: headers(job.key),
    body: JSON.stringify({ addMetadata: true, nodeInfoList: buildNodeInfoList(job, fileName), instanceType: 'default', usePersonalQueue: false }),
  });
}
async function getTask(taskId, key) { return requestJson(`${API_BASE}/query`, { method: 'POST', headers: headers(key), body: JSON.stringify({ taskId }) }); }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function pollTask(taskId, record) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT) {
    await pause(POLL_INTERVAL);
    if (record.cancelRequested) return null;
    const task = await getTask(taskId, record.apiKey);
    const status = String(task.status || '').toUpperCase();
    if (status === 'SUCCESS') return task;
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') throw new Error(task.errorMessage || task.failedReason?.message || `任务状态：${status}`);
    updateTaskRecord(record, status === 'QUEUED' ? '正在排队…' : '正在云端生成…', status === 'QUEUED' ? 'RunningHub 正在等待可用算力' : 'Krea 2 正在绘制角色全角度视图');
  }
  throw new Error('任务等待超过 10 分钟，请前往 RunningHub 控制台确认任务状态。');
}
async function cancelTask(record) {
  if (!record.isActive || !record.taskId || record.cancelling) return;
  record.cancelling = true; updateTaskRecord(record, '正在取消…', '正在向 RunningHub 发送取消指令');
  try {
    await requestJson(CANCEL_TASK_URL, { method: 'POST', headers: headers(record.apiKey), body: JSON.stringify({ apiKey: record.apiKey, taskId: record.taskId }) });
    record.cancelRequested = true; updateTaskRecord(record, '已发送取消指令', '云端任务将停止执行');
  } catch (error) {
    record.cancelling = false; updateTaskRecord(record, '取消失败', friendlyError(error), 'working');
  }
}

function isImage(file) { return /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name); }
function isZip(result) { return String(result.outputType || '').toLowerCase() === 'zip' || /\.zip(?:$|\?)/i.test(result.url || ''); }
async function unpackZip(result) {
  const response = await fetch(result.url); if (!response.ok) throw new Error(`无法下载 ZIP 结果（HTTP ${response.status}）。`);
  const zip = await JSZip.loadAsync(await response.blob()); const images = [];
  for (const file of Object.values(zip.files)) if (!file.dir && isImage(file)) images.push({ name: file.name.split('/').pop(), blob: await file.async('blob') });
  if (!images.length) throw new Error('ZIP 已下载，但未识别到可预览图片。');
  return images;
}
async function imageResultToCacheEntry(result) {
  const response = await fetch(result.url); if (!response.ok) throw new Error(`无法下载图片结果（HTTP ${response.status}）。`);
  return { name: `角色卡-${result.nodeId || 'result'}.${result.outputType || 'png'}`, blob: await response.blob() };
}
function openPoolDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POOL_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(POOL_STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
function poolRequest(operation) {
  return openPoolDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(POOL_STORE_NAME, 'readwrite'); const request = operation(transaction.objectStore(POOL_STORE_NAME));
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }));
}
async function cacheImages(images) {
  for (const image of images) {
    if (!(image.blob instanceof Blob)) throw new Error('图片缓存数据无效，无法写入本地图片池。');
    await poolRequest((store) => store.put({ id: imageId(), name: image.name, blob: image.blob, createdAt: Date.now(), source: '四视图角色卡' }));
  }
}
async function getCachedImages() { const images = await poolRequest((store) => store.getAll()); return images.sort((a, b) => b.createdAt - a.createdAt); }
async function deleteCachedImage(id) { await poolRequest((store) => store.delete(id)); }
async function clearCachedImages() { await poolRequest((store) => store.clear()); }
function closeLightbox() { ui.lightbox.classList.add('hidden'); ui.lightboxImage.removeAttribute('src'); }
function openLightbox(image) { ui.lightboxImage.src = image.url; ui.lightboxImage.alt = image.name; ui.lightboxName.textContent = image.name; ui.lightbox.classList.remove('hidden'); ui.closeLightbox.focus(); }
function addImageCard(image) {
  const fragment = $('imageCardTemplate').content.cloneNode(true); const button = fragment.querySelector('.image-button'); const img = fragment.querySelector('img'); const download = fragment.querySelector('.download-image');
  button.addEventListener('click', () => openLightbox(image)); img.src = image.url; img.alt = image.name; fragment.querySelector('.image-name').textContent = image.name;
  download.href = image.url; download.download = image.name;
  fragment.querySelector('.delete-image').addEventListener('click', async () => { await deleteCachedImage(image.id); URL.revokeObjectURL(image.url); await renderImagePool(); });
  ui.poolGrid.append(fragment);
}
async function renderImagePool() {
  const cached = await getCachedImages(); const invalid = cached.filter((image) => !(image.blob instanceof Blob));
  await Promise.all(invalid.map((image) => deleteCachedImage(image.id))); const valid = cached.filter((image) => image.blob instanceof Blob);
  ui.poolGrid.querySelectorAll('img').forEach((image) => URL.revokeObjectURL(image.src)); ui.poolGrid.innerHTML = '';
  ui.poolCount.textContent = `${valid.length} 张图片`; ui.poolEmpty.classList.toggle('hidden', valid.length > 0);
  valid.forEach((image) => addImageCard({ ...image, url: URL.createObjectURL(image.blob) })); updateOutputVisibility();
}
async function renderResults(task, record) {
  const outputs = task.results || []; if (!outputs.length) throw new Error('任务已完成，但未返回任何结果文件。');
  const images = [];
  for (const result of outputs) {
    if (!result.url) continue;
    if (isZip(result)) { record.zipUrl = result.url; updateTaskRecord(record, '正在解压结果…', '浏览器正在读取 ZIP 中的图片'); images.push(...await unpackZip(result)); }
    else if (/\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i.test(result.url)) images.push(await imageResultToCacheEntry(result));
  }
  if (!images.length) throw new Error('任务已完成，但没有可预览的图片输出。');
  await cacheImages(images); await renderImagePool(); updateTaskRecord(record, '生成完成', `${images.length} 张图片已加入共享图片池`, 'completed');
}

ui.file.addEventListener('change', () => {
  const file = ui.file.files[0]; if (!file) return;
  if (ui.preview.src) URL.revokeObjectURL(ui.preview.src);
  ui.preview.src = URL.createObjectURL(file); ui.preview.classList.remove('hidden'); ui.uploadTitle.textContent = file.name; ui.uploadDetail.textContent = `已选择 ${(file.size / 1024 / 1024).toFixed(1)} MB 参考图`;
});
ui.saveConfig.addEventListener('click', saveCurrentConfiguration);
ui.optimize.addEventListener('click', optimizeCharacterPrompt);
ui.form.addEventListener('submit', async (event) => {
  event.preventDefault(); ui.message.textContent = '';
  const job = readJobInput();
  if (!job.key) { ui.message.textContent = '主创作台尚未保存 RunningHub API Key。'; return; }
  if (!job.file) { ui.message.textContent = '请先上传角色参考图。'; return; }
  if (!window.JSZip) { ui.message.textContent = 'ZIP 解压组件加载失败，请检查网络后刷新。'; return; }
  if (runningTaskKeys.size >= MAX_CONCURRENT_TASKS) { ui.message.textContent = `最多同时运行 ${MAX_CONCURRENT_TASKS} 个任务，请等待任一任务完成后再提交。`; return; }
  const record = createTaskRecord(job); taskRecords.push(record); runningTaskKeys.add(record.key); renderTaskQueue(); updateOutputVisibility();
  try {
    updateTaskRecord(record, '正在上传参考图…', '安全上传至 RunningHub');
    const fileName = await uploadReference(job.file, job.key);
    updateTaskRecord(record, '正在提交任务…', 'RunningHub 已接收角色参考图');
    const task = await submitTask(job, fileName); if (!task.taskId) throw new Error(task.errorMessage || 'RunningHub 未返回 taskId。');
    record.taskId = task.taskId; updateTaskRecord(record, task.status === 'QUEUED' ? '正在排队…' : '正在云端生成…', 'Krea 2 正在绘制角色全角度视图');
    const finalTask = String(task.status).toUpperCase() === 'SUCCESS' ? task : await pollTask(task.taskId, record);
    if (!record.cancelRequested) await renderResults(finalTask, record);
  } catch (error) {
    if (!record.cancelRequested) { record.error = friendlyError(error); updateTaskRecord(record, '任务异常', record.error, 'failed'); }
  } finally {
    record.isActive = false;
    if (record.cancelRequested) updateTaskRecord(record, '任务已取消', '已停止本地轮询；取消请求已发送至云端', 'cancelled');
    runningTaskKeys.delete(record.key); renderTaskQueue(); updateOutputVisibility();
  }
});
ui.clearPool.addEventListener('click', async () => { await clearCachedImages(); await renderImagePool(); });
ui.closeLightbox.addEventListener('click', closeLightbox);
ui.lightbox.addEventListener('click', (event) => { if (event.target === ui.lightbox) closeLightbox(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLightbox(); });
window.addEventListener('storage', (event) => { if (event.key === 'runninghub_api_key') updateKeyStatus(); });
restoreCurrentConfiguration(); updateKeyStatus();
renderImagePool().catch((error) => { ui.message.textContent = friendlyError(error); });
