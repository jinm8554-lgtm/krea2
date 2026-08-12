const $ = (id) => document.getElementById(id);
const ui = { file: $('sourceFile'), canvas: $('cropCanvas'), dropzone: $('cropDropzone'), placeholder: $('dropPlaceholder'), sourceInfo: $('sourceInfo'), scale: $('cropScale'), sizeValue: $('sizeValue'), reset: $('resetCrop'), download: $('downloadCrop'), preview: $('cropResult'), previewHint: $('previewHint'), status: $('cropStatus'), ratioButtons: Array.from(document.querySelectorAll('[data-ratio]')) };
const state = { image: null, sourceUrl: '', resultUrl: '', ratio: '9:16', scale: 1, centerX: .5, centerY: .5, display: null, dragging: null, renderSerial: 0 };
const ratioValue = () => state.ratio === '16:9' ? 16 / 9 : 9 / 16;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function cleanUrls() { if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl); if (state.resultUrl) URL.revokeObjectURL(state.resultUrl); state.sourceUrl = ''; state.resultUrl = ''; }
function cropRect() {
  const image = state.image; const target = ratioValue(); const sourceRatio = image.naturalWidth / image.naturalHeight;
  const maxHeight = sourceRatio > target ? image.naturalHeight : image.naturalWidth / target;
  const maxWidth = maxHeight * target; const width = maxWidth * state.scale; const height = maxHeight * state.scale;
  const halfWidth = width / 2; const halfHeight = height / 2;
  const centerX = clamp(state.centerX * image.naturalWidth, halfWidth, image.naturalWidth - halfWidth);
  const centerY = clamp(state.centerY * image.naturalHeight, halfHeight, image.naturalHeight - halfHeight);
  return { x: centerX - halfWidth, y: centerY - halfHeight, width, height, centerX, centerY };
}
function fitImage(canvasWidth, canvasHeight) {
  const image = state.image; const scale = Math.min(canvasWidth / image.naturalWidth, canvasHeight / image.naturalHeight); const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
  return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height, scale };
}
function drawEditor() {
  if (!state.image) return;
  const bounds = ui.dropzone.getBoundingClientRect(); const density = window.devicePixelRatio || 1; const width = Math.max(1, Math.floor(bounds.width * density)); const height = Math.max(1, Math.floor(bounds.height * density));
  ui.canvas.width = width; ui.canvas.height = height; const context = ui.canvas.getContext('2d'); context.setTransform(density, 0, 0, density, 0, 0); const cssWidth = bounds.width; const cssHeight = bounds.height;
  const display = fitImage(cssWidth, cssHeight); state.display = display; context.clearRect(0, 0, cssWidth, cssHeight); context.drawImage(state.image, display.x, display.y, display.width, display.height);
  const rect = cropRect(); const box = { x: display.x + rect.x * display.scale, y: display.y + rect.y * display.scale, width: rect.width * display.scale, height: rect.height * display.scale };
  context.fillStyle = 'rgba(4,5,5,.62)'; context.fillRect(display.x, display.y, display.width, Math.max(0, box.y - display.y)); context.fillRect(display.x, box.y, Math.max(0, box.x - display.x), box.height); context.fillRect(box.x + box.width, box.y, Math.max(0, display.x + display.width - box.x - box.width), box.height); context.fillRect(display.x, box.y + box.height, display.width, Math.max(0, display.y + display.height - box.y - box.height));
  context.strokeStyle = '#bc8af8'; context.lineWidth = 2; context.strokeRect(box.x, box.y, box.width, box.height); context.fillStyle = '#bc8af8'; [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].forEach(([x,y]) => context.fillRect(x - 4, y - 4, 8, 8));
  renderPreview(rect);
}
function renderPreview(rect) {
  const canvas = document.createElement('canvas'); canvas.width = Math.round(rect.width); canvas.height = Math.round(rect.height); canvas.getContext('2d').drawImage(state.image, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height), 0, 0, canvas.width, canvas.height);
  const serial = ++state.renderSerial;
  canvas.toBlob((blob) => { if (!blob || serial !== state.renderSerial) return; if (state.resultUrl) URL.revokeObjectURL(state.resultUrl); state.resultUrl = URL.createObjectURL(blob); ui.preview.src = state.resultUrl; ui.preview.classList.remove('hidden'); ui.previewHint.classList.add('hidden'); ui.download.disabled = false; ui.status.textContent = `输出尺寸：${canvas.width} × ${canvas.height}`; }, 'image/png');
}
function resetCrop() { state.scale = 1; state.centerX = .5; state.centerY = .5; ui.scale.value = '100'; ui.sizeValue.textContent = '100%'; drawEditor(); }
function loadImage(file) {
  if (!file || !/^image\//i.test(file.type)) { ui.status.textContent = '请选择或粘贴有效的图片文件'; return; }
  cleanUrls(); state.sourceUrl = URL.createObjectURL(file); const image = new Image(); ui.status.textContent = '正在读取图片…';
  image.onload = () => { state.image = image; state.image.fileName = file.name; ui.canvas.classList.remove('hidden'); ui.placeholder.classList.add('hidden'); ui.reset.disabled = false; resetCrop(); ui.sourceInfo.textContent = `${image.naturalWidth} × ${image.naturalHeight}`; };
  image.onerror = () => { ui.status.textContent = '无法读取该图片，请换一张重试'; };
  image.src = state.sourceUrl;
}
function pointOnCanvas(event) { const bounds = ui.canvas.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; }
ui.canvas.addEventListener('pointerdown', (event) => { if (!state.image || !state.display) return; const point = pointOnCanvas(event); const rect = cropRect(); const box = { x: state.display.x + rect.x * state.display.scale, y: state.display.y + rect.y * state.display.scale, width: rect.width * state.display.scale, height: rect.height * state.display.scale }; if (point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height) return; state.dragging = { point, centerX: state.centerX, centerY: state.centerY }; ui.canvas.setPointerCapture(event.pointerId); ui.canvas.classList.add('dragging'); });
ui.canvas.addEventListener('pointermove', (event) => { if (!state.dragging || !state.display) return; const point = pointOnCanvas(event); const deltaX = (point.x - state.dragging.point.x) / state.display.scale; const deltaY = (point.y - state.dragging.point.y) / state.display.scale; state.centerX = state.dragging.centerX + deltaX / state.image.naturalWidth; state.centerY = state.dragging.centerY + deltaY / state.image.naturalHeight; drawEditor(); });
function stopDrag() { state.dragging = null; ui.canvas.classList.remove('dragging'); }
ui.canvas.addEventListener('pointerup', stopDrag); ui.canvas.addEventListener('pointercancel', stopDrag);
ui.file.addEventListener('change', () => loadImage(ui.file.files[0]));
ui.dropzone.addEventListener('click', () => { if (!state.image) ui.file.click(); });
ui.scale.addEventListener('input', () => { state.scale = Number(ui.scale.value) / 100; ui.sizeValue.textContent = `${ui.scale.value}%`; drawEditor(); });
ui.ratioButtons.forEach((button) => button.addEventListener('click', () => { state.ratio = button.dataset.ratio; ui.ratioButtons.forEach((item) => item.classList.toggle('active', item === button)); resetCrop(); }));
ui.reset.addEventListener('click', resetCrop);
ui.download.addEventListener('click', () => { if (!state.resultUrl) return; const link = document.createElement('a'); link.href = state.resultUrl; const name = String(state.image?.fileName || 'image').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-') || 'image'; link.download = `${name}-${state.ratio.replace(':', 'x')}.png`; link.click(); });
document.addEventListener('paste', (event) => { const item = Array.from(event.clipboardData?.items || []).find((candidate) => /^image\//i.test(candidate.type)); const file = item?.getAsFile(); if (!file) return; event.preventDefault(); loadImage(file); ui.dropzone.focus(); });
window.addEventListener('resize', () => { if (state.image) drawEditor(); }); window.addEventListener('beforeunload', cleanUrls);
