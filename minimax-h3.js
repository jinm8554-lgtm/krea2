const API_BASE = 'https://www.runninghub.ai/openapi/v2';
const CANCEL_TASK_URL = 'https://www.runninghub.ai/task/openapi/cancel';
const WORKFLOW_JSON_URL = 'https://www.runninghub.ai/api/openapi/getJsonApiFormat';
const WORKFLOW_ID = '2086493935005970434';
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 10 * 60 * 1000;
const MAX_CONCURRENT_TASKS = 3;
const POOL_DB_NAME = 'krea2-runninghub-image-pool';
const POOL_STORE_NAME = 'images';
const CONFIG_STORAGE_KEY = 'krea2-minimax-h3-configuration-v1';

const $ = (id) => document.getElementById(id);
const ui = {
  form: $('minimaxForm'), prompt: $('prompt'), constraint: $('characterConstraint'), width: $('width'), height: $('height'), steps: $('steps'), cfg: $('cfg'), seed: $('seed'), instance: $('instanceType'),
  files: [$('referenceImage1'), $('referenceImage2'), $('referenceImage3')], previews: [$('referencePreview1'), $('referencePreview2'), $('referencePreview3')],
  uploadTitles: [$('uploadTitle1'), $('uploadTitle2'), $('uploadTitle3')], uploadDetails: [$('uploadDetail1'), $('uploadDetail2'), $('uploadDetail3')],
  button: $('generateButton'), message: $('formMessage'), keyStatus: $('keyStatus'), status: $('status'), empty: $('empty'), progress: $('progress'), results: $('results'),
  progressTitle: $('progressTitle'), progressDetail: $('progressDetail'), taskQueue: $('taskQueue'), poolGrid: $('poolGrid'), poolCount: $('poolCount'), poolEmpty: $('poolEmpty'), clearPool: $('clearPool'), facePreview: $('facePreview'), facePreviewHint: $('facePreviewHint'),
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
function updateKeyStatus() { const ready = Boolean(apiKey()); ui.keyStatus.textContent = ready ? '已共享 API Key' : '主页面尚未保存 API Key'; ui.keyStatus.classList.toggle('ready', ready); }
function readJobInput() {
  return { key: apiKey(), files: ui.files.map((input) => input.files[0] || null), prompt: ui.prompt.value.trim(), constraint: ui.constraint.value.trim(), width: Number(ui.width.value), height: Number(ui.height.value), steps: Number(ui.steps.value), cfg: Number(ui.cfg.value), seed: ui.seed.value === '' ? null : Number(ui.seed.value), instance: ui.instance.value };
}
function saveCurrentConfiguration() {
  const configuration = { prompt: ui.prompt.value, constraint: ui.constraint.value, width: ui.width.value, height: ui.height.value, steps: ui.steps.value, cfg: ui.cfg.value, seed: ui.seed.value, instance: ui.instance.value };
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configuration)); ui.message.textContent = '当前配置已保存，刷新页面后会自动恢复。'; ui.message.className = 'form-message info';
}
function restoreCurrentConfiguration() {
  try {
    const configuration = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null'); if (!configuration) return;
    const values = { prompt: ui.prompt, constraint: ui.constraint, width: ui.width, height: ui.height, steps: ui.steps, cfg: ui.cfg, seed: ui.seed, instance: ui.instance };
    Object.entries(values).forEach(([key, input]) => { if (configuration[key] !== undefined && configuration[key] !== null) input.value = configuration[key]; });
  } catch { localStorage.removeItem(CONFIG_STORAGE_KEY); }
}
function createTaskRecord(job) { return { key: imageId(), taskId: '', apiKey: job.key, status: '正在提交', detail: '准备上传参考图', state: 'working', isActive: true, error: '', zipUrl: '', cancelRequested: false, cancelling: false }; }
function updateTaskRecord(record, status, detail, state = 'working') { record.status = status; record.detail = detail; record.state = state; renderTaskQueue(); updateOutputVisibility(); }
function renderTaskQueue() {
  const records = taskRecords.slice(-6).reverse(); ui.taskQueue.innerHTML = ''; ui.taskQueue.classList.toggle('hidden', records.length === 0);
  records.forEach((record) => {
    const card = document.createElement('article'); card.className = `task-card ${record.state}`;
    const marker = document.createElement('i'); marker.className = 'task-marker';
    const summary = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `MiniMax H3 · ${record.status}`;
    const detail = document.createElement('small'); detail.textContent = record.taskId ? `${record.detail} · ${record.taskId}` : record.detail; summary.append(title, detail);
    const time = document.createElement('time'); time.textContent = record.isActive ? '进行中' : '已结束'; card.append(marker, summary, time);
    if (record.isActive && record.taskId) { const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'cancel-task'; cancel.textContent = record.cancelling ? '取消中…' : '取消'; cancel.disabled = record.cancelling; cancel.addEventListener('click', () => cancelTask(record)); card.append(cancel); }
    if (record.zipUrl) { const link = document.createElement('a'); link.href = record.zipUrl; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '下载 ZIP ↗'; card.append(link); }
    if (record.error) { const error = document.createElement('p'); error.className = 'task-error'; error.textContent = record.error; card.append(error); }
    ui.taskQueue.append(card);
  });
}
function updateOutputVisibility() {
  const hasImages = ui.poolGrid.children.length > 0; const hasRunning = runningTaskKeys.size > 0;
  ui.empty.classList.toggle('hidden', hasImages || hasRunning); ui.progress.classList.toggle('hidden', hasImages || !hasRunning); ui.results.classList.toggle('hidden', !hasImages);
  ui.button.querySelector('span').textContent = hasRunning ? `开始 MiniMax H3 编辑（${runningTaskKeys.size}/${MAX_CONCURRENT_TASKS}）` : hasImages ? '再次 MiniMax H3 编辑' : '开始 MiniMax H3 编辑';
  if (hasRunning) { setStatus('working', `${runningTaskKeys.size}/${MAX_CONCURRENT_TASKS} 个任务运行中`); ui.progressTitle.textContent = '正在编辑画面…'; ui.progressDetail.textContent = '已生成图片会持续显示在共享图片池中'; }
  else if (hasImages) setStatus('success', '图片池已就绪'); else setStatus('idle', '等待提交');
}
async function requestJson(url, options) {
  const response = await fetch(url, options); let data;
  try { data = await response.json(); } catch { throw new Error(`服务器返回了无法解析的响应（HTTP ${response.status}）。`); }
  if (!response.ok || data.errorCode || (typeof data.code === 'number' && data.code !== 0)) throw new Error(data.errorMessage || data.message || `请求失败（HTTP ${response.status}）`);
  return data;
}
async function uploadReference(file, key) {
  const formData = new FormData(); formData.append('file', file);
  const response = await fetch(`${API_BASE}/media/upload/binary`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: formData });
  let data; try { data = await response.json(); } catch { throw new Error(`上传服务返回异常（HTTP ${response.status}）。`); }
  if (!response.ok || data.code !== 0 || !data.data?.fileName) throw new Error(data.message || '参考图上传失败。');
  return data.data.fileName;
}
function buildNodeInfoList(job, fileNames) {
  const [first, second, third] = fileNames;
  const list = [
    node(71, 'image', first), node(78, 'text', job.prompt), node(53, 'text', job.constraint),
    node(60, 'value', job.width), node(61, 'value', job.height), node(77, 'length', 5), node(45, 'steps', job.steps), node(45, 'cfg', job.cfg),
  ];
  if (job.referenceBranches.two) list.push(node(69, 'image', second || first));
  if (job.referenceBranches.three) list.push(node(72, 'image', third || first));
  if (job.seed !== null) list.push(node(45, 'seed', job.seed));
  return list;
}
async function submitTask(job, fileNames) { return requestJson(`${API_BASE}/run/workflow/${WORKFLOW_ID}`, { method: 'POST', headers: headers(job.key), body: JSON.stringify({ addMetadata: true, nodeInfoList: buildNodeInfoList(job, fileNames), instanceType: job.instance, usePersonalQueue: false }) }); }
async function getTask(taskId, key) { return requestJson(`${API_BASE}/query`, { method: 'POST', headers: headers(key), body: JSON.stringify({ taskId }) }); }
async function getPublishedWorkflowPrompt(key) {
  const data = await requestJson(WORKFLOW_JSON_URL, { method: 'POST', headers: headers(key), body: JSON.stringify({ apiKey: key, workflowId: WORKFLOW_ID }) });
  const rawPrompt = data.data?.prompt;
  if (!rawPrompt) throw new Error('无法读取当前云端工作流配置，请稍后重试。');
  try { return JSON.parse(rawPrompt); } catch { throw new Error('云端工作流配置格式异常，请在 RunningHub 中重新保存该工作流。'); }
}
async function prepareReferenceBranches(job) {
  const prompt = await getPublishedWorkflowPrompt(job.key);
  const branches = { two: Boolean(prompt['69']), three: Boolean(prompt['72']) };
  if (job.files[1] && !branches.two) throw new Error('当前 API 工作流没有“2图”节点，无法使用第二张图。请在 RunningHub 中启用 2 图分支并另存/发布为一个新工作流，然后把新工作流 ID 发给我接入。');
  if (job.files[2] && !branches.three) throw new Error('当前 API 工作流没有“3图”节点，无法使用第三张图。请在 RunningHub 中启用 3 图分支并另存/发布为一个新工作流，然后把新工作流 ID 发给我接入。');
  return branches;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function pollTask(taskId, record) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT) {
    await pause(POLL_INTERVAL); if (record.cancelRequested) return null;
    const task = await getTask(taskId, record.apiKey); const status = String(task.status || '').toUpperCase();
    if (status === 'SUCCESS') return task;
    if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') throw new Error(task.errorMessage || task.failedReason?.message || `任务状态：${status}`);
    updateTaskRecord(record, status === 'QUEUED' ? '正在排队…' : '正在云端编辑…', status === 'QUEUED' ? 'RunningHub 正在等待可用算力' : 'MiniMax H3 正在重绘你的画面');
  }
  throw new Error('任务等待超过 10 分钟，请前往 RunningHub 控制台确认任务状态。');
}
async function cancelTask(record) {
  if (!record.isActive || !record.taskId || record.cancelling) return;
  record.cancelling = true; updateTaskRecord(record, '正在取消…', '正在向 RunningHub 发送取消指令');
  try { await requestJson(CANCEL_TASK_URL, { method: 'POST', headers: headers(record.apiKey), body: JSON.stringify({ apiKey: record.apiKey, taskId: record.taskId }) }); record.cancelRequested = true; updateTaskRecord(record, '已发送取消指令', '云端任务将停止执行'); }
  catch (error) { record.cancelling = false; updateTaskRecord(record, '取消失败', friendlyError(error), 'working'); }
}
function isImage(file) { return /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name); }
function isZip(result) { return String(result.outputType || '').toLowerCase() === 'zip' || /\.zip(?:$|\?)/i.test(result.url || ''); }
async function unpackZip(result) {
  const response = await fetch(result.url); if (!response.ok) throw new Error(`无法下载 ZIP 结果（HTTP ${response.status}）。`);
  const zip = await JSZip.loadAsync(await response.blob()); const images = [];
  for (const file of Object.values(zip.files)) if (!file.dir && isImage(file)) images.push({ name: file.name.split('/').pop(), blob: await file.async('blob') });
  if (!images.length) throw new Error('ZIP 已下载，但未识别到可预览图片。'); return images;
}
async function imageResultToCacheEntry(result) { const response = await fetch(result.url); if (!response.ok) throw new Error(`无法下载图片结果（HTTP ${response.status}）。`); return { name: `MiniMax-H3-${result.nodeId || 'result'}.${result.outputType || 'png'}`, blob: await response.blob() }; }
async function renderFacePreview(result) {
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`无法下载节点 65 预览图（HTTP ${response.status}）。`);
  if (ui.facePreview.dataset.objectUrl) URL.revokeObjectURL(ui.facePreview.dataset.objectUrl);
  const objectUrl = URL.createObjectURL(await response.blob());
  ui.facePreview.dataset.objectUrl = objectUrl; ui.facePreview.src = objectUrl; ui.facePreview.classList.remove('hidden');
  ui.facePreviewHint.textContent = '节点 82 返回的最新人脸捕捉预览。';
}
function setFacePreviewHint(text) {
  if (ui.facePreview.dataset.objectUrl) { URL.revokeObjectURL(ui.facePreview.dataset.objectUrl); delete ui.facePreview.dataset.objectUrl; }
  ui.facePreview.removeAttribute('src'); ui.facePreview.classList.add('hidden'); ui.facePreviewHint.textContent = text;
}
function openPoolDb() { return new Promise((resolve, reject) => { const request = indexedDB.open(POOL_DB_NAME, 1); request.onupgradeneeded = () => request.result.createObjectStore(POOL_STORE_NAME, { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function poolRequest(operation) { return openPoolDb().then((db) => new Promise((resolve, reject) => { const transaction = db.transaction(POOL_STORE_NAME, 'readwrite'); const request = operation(transaction.objectStore(POOL_STORE_NAME)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })); }
async function cacheImages(images) { for (const image of images) { if (!(image.blob instanceof Blob)) throw new Error('图片缓存数据无效，无法写入本地图片池。'); await poolRequest((store) => store.put({ id: imageId(), name: image.name, blob: image.blob, createdAt: Date.now(), source: 'MiniMax H3' })); } }
async function getCachedImages() { const images = await poolRequest((store) => store.getAll()); return images.sort((a, b) => b.createdAt - a.createdAt); }
async function deleteCachedImage(id) { await poolRequest((store) => store.delete(id)); }
async function clearCachedImages() { await poolRequest((store) => store.clear()); }
function closeLightbox() { ui.lightbox.classList.add('hidden'); ui.lightboxImage.removeAttribute('src'); }
function openLightbox(image) { ui.lightboxImage.src = image.url; ui.lightboxImage.alt = image.name; ui.lightboxName.textContent = image.name; ui.lightbox.classList.remove('hidden'); ui.closeLightbox.focus(); }
function addImageCard(image) {
  const fragment = $('imageCardTemplate').content.cloneNode(true); const button = fragment.querySelector('.image-button'); const img = fragment.querySelector('img'); const download = fragment.querySelector('.download-image');
  button.addEventListener('click', () => openLightbox(image)); img.src = image.url; img.alt = image.name; fragment.querySelector('.image-name').textContent = image.name; download.href = image.url; download.download = image.name;
  fragment.querySelector('.delete-image').addEventListener('click', async () => { await deleteCachedImage(image.id); URL.revokeObjectURL(image.url); await renderImagePool(); }); ui.poolGrid.append(fragment);
}
async function renderImagePool() {
  const cached = await getCachedImages(); const invalid = cached.filter((image) => !(image.blob instanceof Blob)); await Promise.all(invalid.map((image) => deleteCachedImage(image.id)));
  const valid = cached.filter((image) => image.blob instanceof Blob); ui.poolGrid.querySelectorAll('img').forEach((image) => URL.revokeObjectURL(image.src)); ui.poolGrid.innerHTML = '';
  ui.poolCount.textContent = `${valid.length} 张图片`; ui.poolEmpty.classList.toggle('hidden', valid.length > 0); valid.forEach((image) => addImageCard({ ...image, url: URL.createObjectURL(image.blob) })); updateOutputVisibility();
}
async function renderResults(task, record) {
  const outputs = task.results || []; if (!outputs.length) throw new Error('任务已完成，但未返回任何结果文件。'); const images = [];
  const node82Preview = outputs.find((result) => String(result.nodeId) === '82' && result.url && !isZip(result));
  if (node82Preview) {
    try { await renderFacePreview(node82Preview); } catch (error) { setFacePreviewHint(`节点 82 预览图下载失败：${friendlyError(error)}`); }
  } else setFacePreviewHint('本次云端未返回节点 #82 的人脸捕捉图，请确认新版工作流的 Save Image 节点已启用并发布。');
  for (const result of outputs) { if (!result.url || String(result.nodeId) === '82') continue; if (isZip(result)) { record.zipUrl = result.url; updateTaskRecord(record, '正在解压结果…', '浏览器正在读取 ZIP 中的图片'); images.push(...await unpackZip(result)); } else if (/\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i.test(result.url)) images.push(await imageResultToCacheEntry(result)); }
  if (!images.length) throw new Error('任务已完成，但没有可预览的图片输出。'); await cacheImages(images); await renderImagePool(); updateTaskRecord(record, '编辑完成', `${images.length} 张图片已加入共享图片池`, 'completed');
}
function bindFilePreview(index) {
  ui.files[index].addEventListener('change', () => {
    const file = ui.files[index].files[0]; if (!file) return;
    if (ui.previews[index].src) URL.revokeObjectURL(ui.previews[index].src);
    ui.previews[index].src = URL.createObjectURL(file); ui.previews[index].classList.remove('hidden'); ui.uploadTitles[index].textContent = file.name; ui.uploadDetails[index].textContent = `已选择 ${(file.size / 1024 / 1024).toFixed(1)} MB 图片`;
  });
}
ui.files.forEach((_, index) => bindFilePreview(index));
ui.saveConfig.addEventListener('click', saveCurrentConfiguration);
document.querySelectorAll('.preset-prompts button').forEach((button) => button.addEventListener('click', () => { ui.prompt.value = button.dataset.prompt; ui.prompt.focus(); }));
document.querySelectorAll('.size-presets button').forEach((button) => button.addEventListener('click', () => {
  const [width, height] = button.dataset.size.split(',');
  ui.width.value = width; ui.height.value = height;
  document.querySelectorAll('.size-presets button').forEach((item) => item.classList.toggle('active', item === button));
}));
ui.form.addEventListener('submit', async (event) => {
  event.preventDefault(); ui.message.textContent = ''; const job = readJobInput();
  if (!job.key) { ui.message.textContent = '主创作台尚未保存 RunningHub API Key。'; return; }
  if (!job.files[0]) { ui.message.textContent = '请先上传参考图 1。'; return; }
  if (!job.prompt) { ui.message.textContent = '请先写下编辑指令。'; ui.prompt.focus(); return; }
  if (!window.JSZip) { ui.message.textContent = 'ZIP 解压组件加载失败，请检查网络后刷新。'; return; }
  if (runningTaskKeys.size >= MAX_CONCURRENT_TASKS) { ui.message.textContent = `最多同时运行 ${MAX_CONCURRENT_TASKS} 个任务，请等待任一任务完成后再提交。`; return; }
  try {
    ui.message.textContent = '正在校验云端参考图分支…';
    job.referenceBranches = await prepareReferenceBranches(job);
    ui.message.textContent = '';
  } catch (error) { ui.message.textContent = friendlyError(error); return; }
  const record = createTaskRecord(job); taskRecords.push(record); runningTaskKeys.add(record.key); setFacePreviewHint('等待本次运行结果。节点 #82 的人脸捕捉图会显示在这里。'); renderTaskQueue(); updateOutputVisibility();
  try {
    const filesToUpload = job.files.filter(Boolean); updateTaskRecord(record, '正在上传参考图…', `正在上传 ${filesToUpload.length} 张参考图至 RunningHub`);
    const uploaded = await Promise.all(job.files.map((file) => file ? uploadReference(file, job.key) : Promise.resolve(null)));
    const fileNames = uploaded;
    updateTaskRecord(record, '正在提交任务…', 'RunningHub 已接收编辑素材'); const task = await submitTask(job, fileNames);
    if (!task.taskId) throw new Error(task.errorMessage || 'RunningHub 未返回 taskId。'); record.taskId = task.taskId; updateTaskRecord(record, task.status === 'QUEUED' ? '正在排队…' : '正在云端编辑…', 'MiniMax H3 正在重绘你的画面');
    const finalTask = String(task.status).toUpperCase() === 'SUCCESS' ? task : await pollTask(task.taskId, record); if (!record.cancelRequested) await renderResults(finalTask, record);
  } catch (error) { if (!record.cancelRequested) { record.error = friendlyError(error); updateTaskRecord(record, '任务异常', record.error, 'failed'); } }
  finally { record.isActive = false; if (record.cancelRequested) updateTaskRecord(record, '任务已取消', '已停止本地轮询；取消请求已发送至云端', 'cancelled'); runningTaskKeys.delete(record.key); renderTaskQueue(); updateOutputVisibility(); }
});
ui.clearPool.addEventListener('click', async () => { await clearCachedImages(); await renderImagePool(); });
ui.closeLightbox.addEventListener('click', closeLightbox); ui.lightbox.addEventListener('click', (event) => { if (event.target === ui.lightbox) closeLightbox(); }); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLightbox(); });
window.addEventListener('storage', (event) => { if (event.key === 'runninghub_api_key') updateKeyStatus(); });
restoreCurrentConfiguration(); updateKeyStatus(); renderImagePool().catch((error) => { ui.message.textContent = friendlyError(error); });
