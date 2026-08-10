const API_BASE = 'https://www.runninghub.ai/openapi/v2';
const CANCEL_TASK_URL = 'https://www.runninghub.ai/task/openapi/cancel';
const WORKFLOW_JSON_URL = 'https://www.runninghub.ai/api/openapi/getJsonApiFormat';
const PRIMARY_WORKFLOW_ID = '2086798440302235650';
const MULTI_REFERENCE_WORKFLOW_ID = '2086851246439739394';
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 15 * 60 * 1000;
const MAX_CONCURRENT_TASKS = 3;
const VIDEO_POOL_DB = 'krea2-runninghub-video-pool';
const VIDEO_STORE = 'videos';
const IMAGE_POOL_DB = 'krea2-runninghub-image-pool';
const IMAGE_STORE = 'images';
const CONFIG_KEY = 'krea2-minimax-h3-video-configuration-v1';
const MODEL_CALLER_STORAGE_KEY = 'krea2-openai-compatible-caller-v1';

const $ = (id) => document.getElementById(id);
const ui = { form: $('videoForm'), modeSwitch: $('modeSwitch'), modeHint: $('modeHint'), workflowLabel: $('workflowLabel'), workflowDetail: $('workflowDetail'), referenceSection: $('referenceSection'), referenceGrid: $('referenceGrid'), prompt: $('prompt'), optimize: $('optimizePrompt'), storyFlow: $('storyFlow'), aspectRatio: $('aspectRatio'), megapixels: $('megapixels'), duration: $('duration'), instance: $('instanceType'), saveConfig: $('saveConfig'), button: $('generateButton'), message: $('formMessage'), keyStatus: $('keyStatus'), status: $('status'), empty: $('empty'), progress: $('progress'), progressTitle: $('progressTitle'), progressDetail: $('progressDetail'), taskQueue: $('taskQueue'), results: $('results'), poolGrid: $('poolGrid'), poolCount: $('poolCount'), poolEmpty: $('poolEmpty'), clearPool: $('clearPool') };
const taskRecords = [];
const runningTaskKeys = new Set();
let referenceInputs = [];

const MODE = Object.freeze({
  text: { name: '文生视频', hint: '当前调用主工作流的「文生视频」分支，不需要上传参考素材。', workflowId: PRIMARY_WORKFLOW_ID, prompt: 249, resolution: 250, duration: 260, files: [] },
  image: { name: '单图参考', hint: '当前调用主工作流的「单图参考」分支。上传的图片会作为视频的参考画面。', workflowId: PRIMARY_WORKFLOW_ID, prompt: 266, resolution: 267, duration: 277, files: [{ node: 282, title: '图片 1（必填）', detail: '人物、主体或场景参考', accept: 'image/png,image/jpeg,image/webp' }] },
  multi: { name: '多图参考', hint: '当前调用独立的多图参考工作流（#2086851246439739394）。三张图片会分别传入该工作流的三路参考图节点。', workflowId: MULTI_REFERENCE_WORKFLOW_ID, prompt: 301, resolution: 308, duration: 309, files: [{ node: 297, title: '图片 1（必填）', detail: '主要人物或场景参考', accept: 'image/png,image/jpeg,image/webp' }, { node: 298, title: '图片 2（可选）', detail: '第二人物、道具或场景参考', accept: 'image/png,image/jpeg,image/webp' }, { node: 299, title: '图片 3（可选）', detail: '第三人物、道具或风格参考', accept: 'image/png,image/jpeg,image/webp' }] }
});
const STORY_FLOW = Object.freeze({ drama: '文戏：人物关系、对白、微表情、情绪转折与剧情结果', action: '武戏：高密度打斗、连续攻防、快慢节奏、受力与反制', storyboard: '九宫格：先将关键画面按 3×3 时序梳理，再编写对应视频提示词' });

function apiKey() { return localStorage.getItem('runninghub_api_key') || ''; }
function headers(key) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }; }
function node(nodeId, fieldName, fieldValue) { return { nodeId: String(nodeId), fieldName, fieldValue }; }
function id() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function currentModeKey() { return ui.modeSwitch.querySelector('input:checked').value; }
function currentMode() { return MODE[currentModeKey()]; }
function friendlyError(error) { if (error?.name === 'TypeError' && /fetch/i.test(error.message)) return '无法连接到 RunningHub，请检查网络或浏览器跨域限制。'; return error?.message || '发生未知错误，请稍后重试。'; }
function setStatus(type, text) { ui.status.className = `status ${type}`; ui.status.textContent = text; }
function updateKeyStatus() { const ready = Boolean(apiKey()); ui.keyStatus.textContent = ready ? '已共享 API Key' : '主页面尚未保存 API Key'; ui.keyStatus.classList.toggle('ready', ready); }

function renderReferenceInputs() {
  const mode = currentMode();
  ui.modeHint.textContent = mode.hint;
  ui.referenceGrid.innerHTML = '';
  referenceInputs = [];
  ui.referenceSection.classList.toggle('hidden', mode.files.length === 0);
  mode.files.forEach((spec, index) => {
    const fragment = $('referenceTemplate').content.cloneNode(true);
    const box = fragment.querySelector('.upload-box'); const input = fragment.querySelector('input'); const title = fragment.querySelector('strong'); const detail = fragment.querySelector('small'); const imagePreview = fragment.querySelector('img'); const videoPreview = fragment.querySelector('video');
    input.id = `reference-${index}`; input.accept = spec.accept; title.textContent = spec.title; detail.textContent = spec.detail;
    input.addEventListener('change', () => {
      const file = input.files[0]; if (!file) return;
      [imagePreview, videoPreview].forEach((preview) => { if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url); preview.removeAttribute('src'); preview.classList.add('hidden'); });
      const objectUrl = URL.createObjectURL(file); const preview = file.type.startsWith('video/') ? videoPreview : imagePreview; preview.dataset.url = objectUrl; preview.src = objectUrl; preview.classList.remove('hidden');
      title.textContent = file.name; detail.textContent = `已选择 ${(file.size / 1024 / 1024).toFixed(1)} MB 图片`;
      box.classList.add('selected');
    });
    referenceInputs.push({ input, spec }); ui.referenceGrid.append(fragment);
  });
}
function updateModeControls() {
  renderReferenceInputs();
  ui.workflowLabel.textContent = `MINIMAX H3 VIDEO / WORKFLOW #${currentMode().workflowId}`;
  ui.workflowDetail.textContent = currentModeKey() === 'multi' ? '多图参考使用独立工作流，自动共享主创作台的 API Key' : '自动使用主创作台中保存的 RunningHub API Key';
  const ultra = ui.instance.querySelector('option[value="ultra"]');
  ultra.disabled = currentModeKey() !== 'multi';
  if (ultra.disabled && ui.instance.value === 'ultra') ui.instance.value = 'default';
}

function readJob() {
  const mode = currentMode();
  return { key: apiKey(), modeKey: currentModeKey(), mode, prompt: ui.prompt.value.trim(), storyFlow: ui.storyFlow.value, aspectRatio: ui.aspectRatio.value, megapixels: Number(ui.megapixels.value), duration: Number(ui.duration.value), instance: ui.instance.value, files: referenceInputs.map(({ input, spec }) => ({ file: input.files[0] || null, spec })) };
}
function saveConfiguration() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ mode: currentModeKey(), prompt: ui.prompt.value, storyFlow: ui.storyFlow.value, aspectRatio: ui.aspectRatio.value, megapixels: ui.megapixels.value, duration: ui.duration.value, instance: ui.instance.value }));
  ui.message.className = 'form-message'; ui.message.textContent = '当前模式、提示词与参数已保存，刷新页面后会自动恢复。';
}
function restoreConfiguration() {
  try { const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); if (!saved) return; if (MODE[saved.mode]) ui.modeSwitch.querySelector(`input[value="${saved.mode}"]`).checked = true; ['prompt', 'storyFlow', 'aspectRatio', 'megapixels', 'duration', 'instance'].forEach((key) => { if (saved[key] !== undefined) ui[key].value = saved[key]; }); } catch { localStorage.removeItem(CONFIG_KEY); }
}
function modelCallerConfiguration() { try { return JSON.parse(localStorage.getItem(MODEL_CALLER_STORAGE_KEY) || '{}'); } catch { return {}; } }
function chatCompletionsUrl(endpoint) { const base = endpoint.trim().replace(/\/+$/, '').replace(/\/models(?:\?.*)?$/i, ''); if (!base) throw new Error('请先在模型调用器中保存服务地址。'); return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`; }
function fileAsDataUri(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(`无法读取参考素材：${file.name}`)); reader.readAsDataURL(file); }); }
function completionText(payload) { const content = payload?.choices?.[0]?.message?.content; if (typeof content === 'string') return content.trim(); if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || '').join('').trim(); return ''; }
function templateDuration(seconds) { return seconds <= 5 ? 5 : seconds <= 10 ? 10 : 15; }
function durationTemplateRules(seconds, flow) {
  const template = templateDuration(seconds); const timing = template === 5 ? '用 2—4 个无缺口时间段覆盖 0—5 秒；文戏只保留一次明确转折，武戏安排 6—10 个可读有效动作。' : template === 10 ? '用紧凑、无缺口的时间段覆盖 0—10 秒；让事件、动作或情绪在结尾前完整落地。' : '用 5—8 个无缺口时间段覆盖 0—15 秒；保留清晰的建立、升级、转折与结尾余波。';
  const flowRule = flow === 'action' ? '武戏必须让每个攻击、闪避、格挡、受力和反制改变下一步路径，镜头保持接触点与受力结果可读。' : flow === 'storyboard' ? '九宫格流程要把 3×3 关键状态按从左到右、从上到下映射为连续时间线；允许有关联的硬切，不要误写为强制一镜到底。' : '文戏必须围绕一次可见的关系或情绪变化组织画面；对白短、自然、能在时长内说完，并写清语言与口型同步。';
  return `请以工作流内置的 ${template} 秒三流程模板为规范，同时严格按用户当前设置的 ${seconds} 秒输出。${timing}${flowRule}`;
}
async function optimizeVideoPrompt() {
  const job = readJob(); const modelConfig = modelCallerConfiguration(); const imageReferences = job.files.map(({ file }, index) => ({ file, index: index + 1 })).filter(({ file }) => file?.type.startsWith('image/'));
  if (!job.prompt && !imageReferences.length) { ui.message.textContent = '请先填写故事或上传至少一张参考图，再使用 AI 优化。'; ui.prompt.focus(); return; }
  if (!modelConfig.endpoint || !modelConfig.apiKey || !modelConfig.model) { ui.message.textContent = '请先在“模型调用器”页面保存服务地址、密钥并选择模型。'; return; }
  ui.optimize.disabled = true; ui.optimize.textContent = '优化中…'; ui.message.className = 'form-message'; ui.message.textContent = `正在按 ${templateDuration(job.duration)} 秒工作流模板读取参考素材并优化提示词…`;
  try {
    const mediaList = job.files.length ? job.files.map(({ file }, index) => `@图片${index + 1}：${file ? `${file.name}（${file.type.startsWith('video/') ? '视频参考，需保留为参考素材' : '图片参考'}）` : '未上传'}`).join('\n') : '当前没有参考素材。';
    const content = [{ type: 'text', text: `当前 H3 输入模式：${job.mode.name}\n创作流程：${STORY_FLOW[job.storyFlow]}\n当前视频时长：${job.duration} 秒\n画面比例：${job.aspectRatio}\n用户原始构思：${job.prompt || '未填写，请根据参考图片完成构思。'}\n当前提交素材顺序：\n${mediaList}\n请保留所有已上传参考素材及其顺序，不要遗漏或重排。` }];
    for (const { file, index } of imageReferences) { content.push({ type: 'text', text: `以下为参考图片 ${index}，它对应最终提示词中的 @图片${index}：` }); content.push({ type: 'image_url', image_url: { url: await fileAsDataUri(file) } }); }
    const response = await fetch(chatCompletionsUrl(modelConfig.endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modelConfig.apiKey}` }, body: JSON.stringify({ model: modelConfig.model, temperature: 0.35, messages: [
      { role: 'system', content: `你是 MiniMax H3 视频导演与中文提示词编剧。${durationTemplateRules(job.duration, job.storyFlow)} 参考图片锁定可见人物/主体、服装、道具、场景、材质、光线、色彩与构图；用户故事锁定事件顺序、角色关系、动作结果和结尾。两者冲突时优先保持图片中可见身份特征。最终只输出一份可直接粘贴到 MiniMax H3 的完整中文自然语言提示词，不要解释、标题、思考过程、Markdown 或引号。若有参考素材，最终结果的绝对第一行必须按实际顺序连续包含每个已上传素材的 @图片N 引用，例如“@图片1作为主角身份与服装参考@图片2作为场景与光影参考”；下一行才从“生成一段${job.duration}秒、${job.aspectRatio.includes('16:9') ? '16:9' : job.aspectRatio}、2K、原生立体声……”开始。不要遗漏、改号或遗忘任何参考图信息。` },
      { role: 'user', content },
    ] }) });
    let payload; try { payload = await response.json(); } catch { throw new Error(`模型服务返回了无法解析的数据（HTTP ${response.status}）。`); }
    if (!response.ok) throw new Error(payload.error?.message || payload.message || `模型调用失败（HTTP ${response.status}）。`);
    const optimized = completionText(payload).replace(/^```(?:text|markdown)?\s*/i, '').replace(/```$/i, '').trim(); if (!optimized) throw new Error('模型未返回可用的视频提示词。');
    ui.prompt.value = optimized; ui.message.textContent = '已按当前流程、时长和参考素材生成提示词。'; ui.message.className = 'form-message';
  } catch (error) { ui.message.textContent = error.message || 'AI 优化失败，请检查模型调用器配置或跨域设置。'; ui.message.className = 'form-message'; }
  finally { ui.optimize.disabled = false; ui.optimize.textContent = '✦ AI 优化'; }
}
function buildNodeInfoList(job, uploadedFiles) {
  const list = [node(job.mode.prompt, 'value', job.prompt), node(job.mode.resolution, 'aspect_ratio', job.aspectRatio), node(job.mode.resolution, 'megapixels', job.megapixels), node(job.mode.duration, 'value', job.duration)];
  job.files.forEach(({ spec }, index) => { if (uploadedFiles[index]) list.push(node(spec.node, 'image', uploadedFiles[index])); });
  return list;
}
async function requestJson(url, options) { const response = await fetch(url, options); let data; try { data = await response.json(); } catch { throw new Error(`服务器返回了无法解析的响应（HTTP ${response.status}）。`); } if (!response.ok || data.errorCode || (typeof data.code === 'number' && data.code !== 0)) throw new Error(data.errorMessage || data.message || `请求失败（HTTP ${response.status}）。`); return data; }
async function uploadMedia(file, key) { const body = new FormData(); body.append('file', file); const response = await fetch(`${API_BASE}/media/upload/binary`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body }); let data; try { data = await response.json(); } catch { throw new Error(`上传服务返回异常（HTTP ${response.status}）。`); } if (!response.ok || data.code !== 0 || !data.data?.fileName) throw new Error(data.message || '参考素材上传失败。'); return data.data.fileName; }
async function submitTask(job, uploadedFiles) { return requestJson(`${API_BASE}/run/workflow/${job.mode.workflowId}`, { method: 'POST', headers: headers(job.key), body: JSON.stringify({ addMetadata: true, nodeInfoList: buildNodeInfoList(job, uploadedFiles), instanceType: job.instance, usePersonalQueue: false }) }); }
async function getTask(taskId, key) { return requestJson(`${API_BASE}/query`, { method: 'POST', headers: headers(key), body: JSON.stringify({ taskId }) }); }
async function getPublishedWorkflowPrompt(key, workflowId) {
  const data = await requestJson(WORKFLOW_JSON_URL, { method: 'POST', headers: headers(key), body: JSON.stringify({ apiKey: key, workflowId }) });
  try { return JSON.parse(data.data?.prompt || '{}'); } catch { throw new Error('无法读取当前已发布工作流配置，请稍后重试。'); }
}
function createTaskRecord(job) { return { key: id(), taskId: '', apiKey: job.key, mode: job.mode.name, status: '正在提交', detail: '准备上传素材', state: 'working', isActive: true, cancelling: false, cancelRequested: false, error: '', zipUrls: [] }; }
function updateTaskRecord(record, status, detail, state = 'working') { record.status = status; record.detail = detail; record.state = state; renderTaskQueue(); updateOutputVisibility(); }
function renderTaskQueue() { const rows = taskRecords.slice(-6).reverse(); ui.taskQueue.innerHTML = ''; ui.taskQueue.classList.toggle('hidden', rows.length === 0); rows.forEach((record) => { const card = document.createElement('article'); card.className = `task-card ${record.state}`; card.innerHTML = `<i class="task-marker"></i><div><strong>${record.mode} · ${record.status}</strong><small>${record.taskId ? `${record.detail} · ${record.taskId}` : record.detail}</small></div><time>${record.isActive ? '进行中' : '已结束'}</time>`; if (record.isActive && record.taskId) { const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = record.cancelling ? '取消中…' : '取消'; cancel.disabled = record.cancelling; cancel.addEventListener('click', () => cancelTask(record)); card.append(cancel); } record.zipUrls.forEach((url, index) => { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = `下载 ZIP ${index + 1} ↗`; card.append(link); }); if (record.error) { const error = document.createElement('p'); error.className = 'task-error'; error.textContent = record.error; card.append(error); } ui.taskQueue.append(card); }); }
function updateOutputVisibility() { const hasVideos = ui.poolGrid.children.length > 0; const running = runningTaskKeys.size > 0; ui.empty.classList.toggle('hidden', hasVideos || running); ui.progress.classList.toggle('hidden', hasVideos || !running); ui.results.classList.toggle('hidden', !hasVideos); ui.button.querySelector('span').textContent = running ? `继续生成视频（${running}/${MAX_CONCURRENT_TASKS}）` : hasVideos ? '再次生成视频' : '开始生成视频'; if (running) { setStatus('working', `${running}/${MAX_CONCURRENT_TASKS} 个任务运行中`); ui.progressTitle.textContent = '正在生成视频…'; ui.progressDetail.textContent = '已完成的视频会持续显示在视频池中。'; } else if (hasVideos) setStatus('success', '视频池已就绪'); else setStatus('idle', '等待提交'); }
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function pollTask(taskId, record) { const startedAt = Date.now(); while (Date.now() - startedAt < POLL_TIMEOUT) { await pause(POLL_INTERVAL); if (record.cancelRequested) return null; const task = await getTask(taskId, record.apiKey); const status = String(task.status || '').toUpperCase(); if (status === 'SUCCESS') return task; if (['FAILED', 'CANCELED', 'CANCELLED'].includes(status)) throw new Error(task.errorMessage || task.failedReason?.message || `任务状态：${status}`); updateTaskRecord(record, status === 'QUEUED' ? '正在排队…' : '正在云端生成…', status === 'QUEUED' ? 'RunningHub 正在等待可用算力' : 'MiniMax H3 正在生成画面与声音'); } throw new Error('任务等待超过 15 分钟，请在 RunningHub 控制台确认任务状态。'); }
async function waitForTaskOutputs(task, record) {
  if (task?.results?.some((result) => result?.url)) return task;
  const attempts = 20;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (record.cancelRequested) return null;
    updateTaskRecord(record, '正在写入结果文件…', `云端任务已成功，正在等待 ZIP / 视频文件同步（${attempt}/${attempts}）`);
    await pause(POLL_INTERVAL);
    const refreshed = await getTask(record.taskId, record.apiKey);
    if (refreshed?.results?.some((result) => result?.url)) return refreshed;
    const status = String(refreshed?.status || '').toUpperCase();
    if (['FAILED', 'CANCELED', 'CANCELLED'].includes(status)) throw new Error(refreshed.errorMessage || `任务状态：${status}`);
  }
  throw new Error(`任务已成功但结果文件在 ${Math.round((attempts * POLL_INTERVAL) / 1000)} 秒内尚未同步。请稍后在 RunningHub 任务记录中确认 ZIP 文件。`);
}
async function cancelTask(record) { if (!record.isActive || !record.taskId || record.cancelling) return; record.cancelling = true; updateTaskRecord(record, '正在取消…', '正在向 RunningHub 发送取消指令'); try { await requestJson(CANCEL_TASK_URL, { method: 'POST', headers: headers(record.apiKey), body: JSON.stringify({ apiKey: record.apiKey, taskId: record.taskId }) }); record.cancelRequested = true; updateTaskRecord(record, '已发送取消指令', '已停止本地轮询，云端将取消该任务'); } catch (error) { record.cancelling = false; updateTaskRecord(record, '取消失败', friendlyError(error)); } }

function isZip(result) { return String(result.outputType || '').toLowerCase() === 'zip' || /\.zip(?:$|\?)/i.test(result.url || ''); }
function isVideoName(name) { return /\.(mp4|webm|mov|m4v|avi)$/i.test(name || ''); }
function videoType(name) { const ext = (name || '').split('.').pop().toLowerCase(); return ({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo' })[ext] || 'video/mp4'; }
function zipText(bytes) { return new TextDecoder('utf-8').decode(bytes); }
async function inflateRaw(bytes) { if (!('DecompressionStream' in window)) throw new Error('当前浏览器不支持本地 ZIP 解压，请使用最新版 Chrome 或 Edge。'); return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(); }
async function unzipVideos(result) {
  const response = await fetch(result.url); if (!response.ok) throw new Error(`无法下载 ZIP 结果（HTTP ${response.status}）。`);
  if (window.JSZip) {
    const zip = await JSZip.loadAsync(await response.blob()); const videos = [];
    for (const file of Object.values(zip.files)) if (!file.dir && isVideoName(file.name)) videos.push({ name: file.name.split('/').pop(), blob: new Blob([await file.async('arraybuffer')], { type: videoType(file.name) }) });
    if (!videos.length) throw new Error('ZIP 已下载，但未识别到可预览的视频文件。'); return videos;
  }
  const bytes = await (await response.blob()).arrayBuffer(); const view = new DataView(bytes); const data = new Uint8Array(bytes); let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65557); offset -= 1) if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  if (eocd < 0) throw new Error('结果文件不是可识别的 ZIP 压缩包。');
  const count = view.getUint16(eocd + 10, true); let cursor = view.getUint32(eocd + 16, true); const videos = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('ZIP 目录格式异常。');
    const flags = view.getUint16(cursor + 8, true); const compression = view.getUint16(cursor + 10, true); const compressedSize = view.getUint32(cursor + 20, true); const nameLength = view.getUint16(cursor + 28, true); const extraLength = view.getUint16(cursor + 30, true); const commentLength = view.getUint16(cursor + 32, true); const localOffset = view.getUint32(cursor + 42, true); const name = zipText(data.slice(cursor + 46, cursor + 46 + nameLength)); cursor += 46 + nameLength + extraLength + commentLength;
    if (!isVideoName(name)) continue; if (flags & 1) throw new Error('ZIP 中的视频文件已加密，无法在浏览器中预览。'); if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('ZIP 本地文件头格式异常。');
    const localNameLength = view.getUint16(localOffset + 26, true); const localExtraLength = view.getUint16(localOffset + 28, true); const start = localOffset + 30 + localNameLength + localExtraLength; const compressed = data.slice(start, start + compressedSize); const raw = compression === 0 ? compressed : compression === 8 ? new Uint8Array(await inflateRaw(compressed)) : (() => { throw new Error(`不支持 ZIP 的压缩方式 #${compression}。`); })();
    videos.push({ name: name.split('/').pop(), blob: new Blob([raw], { type: videoType(name) }) });
  }
  if (!videos.length) throw new Error('ZIP 已下载，但未识别到可预览的视频文件。'); return videos;
}
async function directVideo(result) { const response = await fetch(result.url); if (!response.ok) throw new Error(`无法下载视频结果（HTTP ${response.status}）。`); const name = `MiniMax-H3-${result.nodeId || 'result'}.${result.outputType || 'mp4'}`; return { name, blob: await response.blob() }; }
function openDb() { return new Promise((resolve, reject) => { const request = indexedDB.open(VIDEO_POOL_DB, 1); request.onupgradeneeded = () => request.result.createObjectStore(VIDEO_STORE, { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function dbRequest(operation) { return openDb().then((db) => new Promise((resolve, reject) => { const transaction = db.transaction(VIDEO_STORE, 'readwrite'); const request = operation(transaction.objectStore(VIDEO_STORE)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })); }
function imageDbRequest(operation) { return new Promise((resolve, reject) => { const request = indexedDB.open(IMAGE_POOL_DB, 1); request.onupgradeneeded = () => request.result.createObjectStore(IMAGE_STORE, { keyPath: 'id' }); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const transaction = db.transaction(IMAGE_STORE, 'readwrite'); const write = operation(transaction.objectStore(IMAGE_STORE)); write.onsuccess = () => resolve(write.result); write.onerror = () => reject(write.error); }; }); }
async function cacheVideos(videos) { for (const video of videos) await dbRequest((store) => store.put({ id: id(), name: video.name, blob: video.blob, createdAt: Date.now(), source: 'MiniMax H3 Video' })); }
async function getVideos() { const videos = await dbRequest((store) => store.getAll()); return videos.filter((video) => video.blob instanceof Blob).sort((a, b) => b.createdAt - a.createdAt); }
function waitForVideoEvent(video, eventName) { return new Promise((resolve, reject) => { const done = () => { cleanup(); resolve(); }; const fail = () => { cleanup(); reject(new Error('无法解码视频尾帧。')); }; const cleanup = () => { video.removeEventListener(eventName, done); video.removeEventListener('error', fail); }; video.addEventListener(eventName, done, { once: true }); video.addEventListener('error', fail, { once: true }); }); }
async function extractTailFrame(video, videoName) { if (video.readyState < HTMLMediaElement.HAVE_METADATA) await waitForVideoEvent(video, 'loadedmetadata'); if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) throw new Error('视频元数据尚未就绪，无法提取尾帧。'); const wasPlaying = !video.paused; video.pause(); video.currentTime = Math.max(0, video.duration - 0.08); await waitForVideoEvent(video, 'seeked'); const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('尾帧导出失败。'); if (wasPlaying) video.play().catch(() => {}); const name = `${videoName.replace(/\.[^.]+$/, '')}-尾帧.png`; await imageDbRequest((store) => store.put({ id: id(), name, blob, createdAt: Date.now(), source: 'MiniMax H3 Video 尾帧' })); const url = URL.createObjectURL(blob); const download = document.createElement('a'); download.href = url; download.download = name; download.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return name; }
async function renderVideoPool() { const videos = await getVideos(); ui.poolGrid.querySelectorAll('video').forEach((video) => { if (video.dataset.url) URL.revokeObjectURL(video.dataset.url); }); ui.poolGrid.innerHTML = ''; ui.poolCount.textContent = `${videos.length} 个视频`; ui.poolEmpty.classList.toggle('hidden', videos.length > 0); videos.forEach((video) => { const fragment = $('videoCardTemplate').content.cloneNode(true); const element = fragment.querySelector('video'); const url = URL.createObjectURL(video.blob); element.dataset.url = url; element.src = url; fragment.querySelector('.video-name').textContent = video.name; const download = fragment.querySelector('.download-video'); download.href = url; download.download = video.name; const extract = fragment.querySelector('.extract-tail-frame'); extract.addEventListener('click', async () => { extract.disabled = true; extract.textContent = '提取中…'; try { const name = await extractTailFrame(element, video.name); extract.textContent = '已加入图片池'; ui.message.className = 'form-message'; ui.message.textContent = `已提取尾帧：${name}，并加入共享图片池。`; } catch (error) { extract.textContent = '尾帧提取'; ui.message.textContent = friendlyError(error); } finally { setTimeout(() => { extract.disabled = false; if (extract.textContent === '已加入图片池') extract.textContent = '尾帧提取'; }, 1800); } }); fragment.querySelector('.delete-video').addEventListener('click', async () => { await dbRequest((store) => store.delete(video.id)); URL.revokeObjectURL(url); await renderVideoPool(); }); ui.poolGrid.append(fragment); }); updateOutputVisibility(); }
async function renderResults(task, record) { const outputs = task.results || []; if (!outputs.length) throw new Error('任务已完成，但未返回任何结果文件。'); const videos = []; for (const result of outputs) { if (!result.url) continue; if (isZip(result)) { record.zipUrls.push(result.url); updateTaskRecord(record, '正在解压结果…', '浏览器正在读取 ZIP 中的视频文件'); videos.push(...await unzipVideos(result)); } else if (isVideoName(result.url) || /^(mp4|webm|mov|m4v)$/i.test(result.outputType || '')) videos.push(await directVideo(result)); } if (!videos.length) throw new Error('任务已完成，但未找到可预览的视频输出。'); try { await cacheVideos(videos); } catch (error) { console.warn('视频缓存失败', error); } await renderVideoPool(); updateTaskRecord(record, '视频生成完成', `${videos.length} 个视频已加入本地视频池`, 'completed'); }

ui.modeSwitch.addEventListener('change', updateModeControls);
ui.saveConfig.addEventListener('click', saveConfiguration);
ui.optimize.addEventListener('click', optimizeVideoPrompt);
ui.form.addEventListener('submit', async (event) => { event.preventDefault(); ui.message.textContent = ''; const job = readJob(); if (!job.key) { ui.message.textContent = '主创作台尚未保存 RunningHub API Key。'; return; } if (!job.prompt) { ui.message.textContent = '请先填写视频提示词。'; ui.prompt.focus(); return; } if (!Number.isFinite(job.duration) || job.duration < 2 || job.duration > 15) { ui.message.textContent = '视频时长需在 2–15 秒之间。'; return; } if (job.files[0] && !job.files[0].file) { ui.message.textContent = '请上传第 1 个参考素材。'; return; } if (runningTaskKeys.size >= MAX_CONCURRENT_TASKS) { ui.message.textContent = `最多同时运行 ${MAX_CONCURRENT_TASKS} 个任务，请等待任一任务完成后再提交。`; return; }
  try { ui.message.textContent = '正在校验当前模式的独立工作流…'; const publishedPrompt = await getPublishedWorkflowPrompt(job.key, job.mode.workflowId); const needed = [job.mode.prompt, job.mode.resolution, job.mode.duration, ...job.files.filter(({ file }) => file).map(({ spec }) => spec.node)]; const missing = needed.find((nodeId) => !publishedPrompt[String(nodeId)]); if (missing) throw new Error(`「${job.mode.name}」工作流未包含节点 #${missing}，请确认该模式的 API 工作流已发布。`); ui.message.textContent = ''; } catch (error) { ui.message.textContent = friendlyError(error); return; }
  const record = createTaskRecord(job); taskRecords.push(record); runningTaskKeys.add(record.key); renderTaskQueue(); updateOutputVisibility();
  try { const count = job.files.filter(({ file }) => file).length; if (count) updateTaskRecord(record, '正在上传参考素材…', `正在上传 ${count} 个素材至 RunningHub`); const uploaded = await Promise.all(job.files.map(({ file }) => file ? uploadMedia(file, job.key) : Promise.resolve(null))); updateTaskRecord(record, '正在提交任务…', 'RunningHub 正在接收视频生成请求'); const task = await submitTask(job, uploaded); if (!task.taskId) throw new Error(task.errorMessage || 'RunningHub 未返回 taskId。'); record.taskId = task.taskId; updateTaskRecord(record, String(task.status).toUpperCase() === 'QUEUED' ? '正在排队…' : '正在云端生成…', 'MiniMax H3 正在生成画面与声音'); const finalTask = String(task.status).toUpperCase() === 'SUCCESS' ? task : await pollTask(task.taskId, record); const taskWithOutputs = await waitForTaskOutputs(finalTask, record); if (!record.cancelRequested) await renderResults(taskWithOutputs, record); } catch (error) { if (!record.cancelRequested) { record.error = friendlyError(error); updateTaskRecord(record, '任务异常', record.error, 'failed'); } } finally { record.isActive = false; if (record.cancelRequested) updateTaskRecord(record, '任务已取消', '取消指令已发送至云端', 'cancelled'); runningTaskKeys.delete(record.key); renderTaskQueue(); updateOutputVisibility(); }
});
ui.clearPool.addEventListener('click', async () => { await dbRequest((store) => store.clear()); await renderVideoPool(); });
window.addEventListener('storage', (event) => { if (event.key === 'runninghub_api_key') updateKeyStatus(); });
restoreConfiguration(); updateModeControls(); updateKeyStatus(); renderVideoPool().catch((error) => { ui.message.textContent = friendlyError(error); });
