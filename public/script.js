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

async function copyCode(outputId) {
  const text = document.getElementById(outputId).textContent;
  await navigator.clipboard.writeText(text);
  const btn = event.target.closest('.btn');
  const orig = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = orig; }, 1600);
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

  try {
    const r = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Generation failed');
    setOutput('gen-output', data.code, 'copy-btn');
    setStatus('gen-status', `Generated "${data.featureLabel}"`, 'ok');
  } catch (e) {
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

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  currentMime = file.type;
  const reader = new FileReader();
  reader.onload = e => {
    currentImageBase64 = e.target.result.split(',')[1];
    document.getElementById('drop-text').style.display = 'none';
    const img = document.getElementById('img-preview');
    img.src = e.target.result;
    img.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
}

async function analyzeImg() {
  if (!currentImageBase64) {
    setStatus('analyze-status', 'Please upload an image first.', 'error');
    return;
  }
  const prompt = document.getElementById('analyze-prompt').value.trim();

  setStatus('analyze-status', 'Analyzing image...', 'loading');
  document.getElementById('analyze-desc').textContent = 'Analyzing...';

  try {
    const r = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: currentImageBase64, mimeType: currentMime, prompt })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Analysis failed');

    const descEl = document.getElementById('analyze-desc');
    descEl.textContent = data.description;
    descEl.style.fontStyle = 'normal';
    descEl.style.color = 'var(--text)';

    setOutput('analyze-output', data.code, 'analyze-copy-btn');
    setStatus('analyze-status', `Generated "${data.featureLabel}"`, 'ok');
  } catch (e) {
    setStatus('analyze-status', `Error: ${e.message}`, 'error');
    document.getElementById('analyze-desc').textContent = 'Analysis failed.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gen-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) generate();
  });
});