function switchTab(name) {
  const tabs   = ['generate','debug','analyze','guide'];
  const tabEls = document.querySelectorAll('.tab');
  tabEls.forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  tabEls[tabs.indexOf(name)].classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
}

function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = `status show ${type}`;
}

function setOutput(id, code, copyBtnId) {
  const el = document.getElementById(id);
  el.textContent = code;
  el.classList.remove('empty');
  if (copyBtnId) document.getElementById(copyBtnId).disabled = false;
}

function setThinking(prefix, text) {
  const wrap = document.getElementById(`${prefix}-thinking-wrap`);
  const body = document.getElementById(`${prefix}-thinking-body`);
  const header = document.getElementById(`${prefix}-thinking-header`);
  if (!wrap || !body || !header) return;

  if (!text) {
    wrap.style.display = 'none';
    body.textContent = '';
    body.classList.remove('open');
    header.classList.remove('open');
    return;
  }

  wrap.style.display = 'block';
  body.textContent = text;
  body.classList.remove('open');
  header.classList.remove('open');
}

function toggleThinking(prefix) {
  const body = document.getElementById(`${prefix}-thinking-body`);
  const header = document.getElementById(`${prefix}-thinking-header`);
  if (!body || !header) return;

  body.classList.toggle('open');
  header.classList.toggle('open');
}

function showCopyToast() {
  const toast = document.getElementById('copy-toast');
  if (!toast) return;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

async function copyCode(outputId) {
  const text = document.getElementById(outputId).textContent;
  await navigator.clipboard.writeText(text);
  showCopyToast();
}

function setPrompt(text) {
  document.getElementById('gen-prompt').value = text;
  document.getElementById('gen-prompt').focus();
}

function sendToDebug() {
  const code = document.getElementById('gen-output').textContent;
  if (code && !document.getElementById('gen-output').classList.contains('empty')) {
    document.getElementById('debug-code').value = code;
    switchTab('debug');
  }
}

async function generate() {
  const prompt = document.getElementById('gen-prompt').value.trim();
  if (!prompt) return;

  const btn = document.getElementById('gen-btn');
  btn.innerHTML = '<div class="spinner"></div><span>Generating</span>';
  btn.disabled = true;
  setStatus('gen-status', 'Calling Groq AI...', 'loading');
  setThinking('gen', '');

  try {
    const r = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Generation failed');
    setOutput('gen-output', data.code, 'copy-btn');
    setThinking('gen', data.thinking || '');
    setStatus('gen-status', `Generated "${data.featureLabel}"`, 'ok');
  } catch (e) {
    setThinking('gen', '');
    setStatus('gen-status', `Error: ${e.message}`, 'error');
  } finally {
    btn.textContent = 'Generate FeatureScript';
    btn.disabled = false;
  }
}

async function debugCode() {
  const code   = document.getElementById('debug-code').value.trim();
  const errors = document.getElementById('debug-errors').value.trim();
  if (!code) return;

  setStatus('debug-status', 'Analyzing and fixing...', 'loading');
  document.getElementById('debug-explanation').classList.remove('show');

  try {
    const r = await fetch('/debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, errors })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Debug failed');

    const expEl = document.getElementById('debug-explanation');
    expEl.textContent = data.explanation;
    expEl.classList.add('show');

    setOutput('debug-output', data.fixed, 'debug-copy-btn');
    setStatus('debug-status', 'Fixed', 'ok');
  } catch (e) {
    setStatus('debug-status', `Error: ${e.message}`, 'error');
  }
}

let currentImageBase64 = null, currentMime = null;
let multiImages = [];

function getImageSlotElements(source) {
  const slot = source?.closest?.('.image-slot');
  if (!slot) return null;

  return {
    slot,
    dropText: slot.querySelector('.drop-text'),
    preview: slot.querySelector('.img-preview'),
    input: slot.querySelector('.img-input'),
    prompt: slot.querySelector('.slot-prompt')
  };
}

function updateAnalyzeDescription(text, isPlaceholder = false) {
  const descEl = document.getElementById('analyze-desc');
  descEl.textContent = text;
  descEl.style.fontStyle = isPlaceholder ? 'italic' : 'normal';
  descEl.style.color = isPlaceholder ? 'var(--muted)' : 'var(--text)';
}

function syncSlotLabels() {
  document.querySelectorAll('#image-slots-container .image-slot').forEach((slot, index) => {
    slot.dataset.index = String(index);

    const title = slot.querySelector('.slot-title');
    if (title) title.textContent = `Image ${index + 1}`;

    const removeBtn = slot.querySelector('.slot-remove-btn');
    if (removeBtn) removeBtn.style.display = index === 0 ? 'none' : 'inline-flex';
  });
}

function collectMultiImages() {
  return Array.from(document.querySelectorAll('#image-slots-container .image-slot'))
    .map(slot => {
      const index = Number(slot.dataset.index);
      const prompt = slot.querySelector('.slot-prompt')?.value.trim() || '';
      const image = multiImages[index];

      if (!image?.imageBase64) return null;
      return { ...image, context: prompt };
    })
    .filter(Boolean);
}

function handleFile(file, source) {
  if (!file || !file.type.startsWith('image/')) return;

  const els = getImageSlotElements(source);
  if (!els) {
    currentMime = file.type;
    const reader = new FileReader();
    reader.onload = e => {
      currentImageBase64 = e.target.result.split(',')[1];
    };
    reader.readAsDataURL(file);
    return;
  }

  const index = Number(els.slot.dataset.index);
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    multiImages[index] = {
      imageBase64: dataUrl.split(',')[1],
      mimeType: file.type
    };

    if (els.dropText) els.dropText.style.display = 'none';
    if (els.preview) {
      els.preview.src = dataUrl;
      els.preview.style.display = 'block';
    }

    if (index === 0) {
      currentImageBase64 = multiImages[index].imageBase64;
      currentMime = file.type;
    }
  };
  reader.readAsDataURL(file);
}

function handleDrop(e, dropZone) {
  e.preventDefault();
  if (dropZone) dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file, dropZone);
}

function addImageSlot() {
  const container = document.getElementById('image-slots-container');
  const currentCount = container.querySelectorAll('.image-slot').length;
  if (currentCount >= 4) {
    setStatus('analyze-status', 'You can upload up to 4 images.', 'error');
    return;
  }

  const slot = document.createElement('div');
  slot.className = 'image-slot';
  slot.innerHTML = `
    <div class="slot-header">
      <div class="card-label slot-title">Image ${currentCount + 1}</div>
      <button type="button" class="slot-remove-btn" onclick="removeImageSlot(this)">Remove</button>
    </div>
    <div class="image-drop drop-zone"
         onclick="this.querySelector('.img-input').click()"
         ondragover="event.preventDefault(); this.classList.add('drag-over')"
         ondragleave="this.classList.remove('drag-over')"
         ondrop="handleDrop(event, this)">
      <input type="file" class="img-input" accept="image/*" onchange="handleFile(this.files[0], this)" style="display:none;">
      <div class="drop-text">
        Click or drag an image here<br>
        <small style="color:var(--muted)">Add another reference angle, drawing, or dimension sheet</small>
      </div>
      <img class="img-preview" style="display:none; max-width:100%; margin-top:10px;" alt="Preview">
    </div>
    <p class="card-label" style="margin-top:10px; font-size: 0.85rem;">Image Label / Specifics</p>
    <input type="text" class="slot-prompt" placeholder="e.g. Side view dimensions or 'Use this hole spacing'">
  `;

  container.appendChild(slot);
  syncSlotLabels();
  requestAnimationFrame(() => slot.classList.add('slot-visible'));
}

function removeImageSlot(button) {
  const slot = button.closest('.image-slot');
  if (!slot) return;

  const index = Number(slot.dataset.index);
  multiImages.splice(index, 1);
  slot.remove();
  syncSlotLabels();
}

async function analyzeImg() {
  return analyzeMultiImg();
}

async function analyzeMultiImg() {
  const images = collectMultiImages();
  if (images.length === 0) {
    setStatus('analyze-status', 'Please upload at least one image.', 'error');
    return;
  }

  const globalPrompt = document.getElementById('global-prompt')?.value.trim() || '';
  setStatus('analyze-status', 'Analyzing images...', 'loading');
  updateAnalyzeDescription('Analyzing...', true);
  setThinking('analyze', '');

  try {
    const r = await fetch('/analyze-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, globalPrompt })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Analysis failed');

    updateAnalyzeDescription(data.description);
    setOutput('analyze-output', data.code, 'analyze-copy-btn');
    setThinking('analyze', data.thinking || '');
    setStatus('analyze-status', `Generated "${data.featureLabel}"`, 'ok');
  } catch (e) {
    setStatus('analyze-status', `Error: ${e.message}`, 'error');
    updateAnalyzeDescription('Analysis failed.', true);
    setThinking('analyze', '');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gen-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) generate();
  });

  syncSlotLabels();
  const firstSlot = document.querySelector('#image-slots-container .image-slot');
  if (firstSlot) firstSlot.classList.add('slot-visible');
});