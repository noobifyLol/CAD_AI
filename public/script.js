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

const outputGenerationIds = {};
let debugSourceGenerationId = null;
let runModalContext = null;

function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString();
  return date.toLocaleString();
}

function databaseStatusText(database) {
  if (!database) return 'No database status returned';
  if (database.ok) {
    if (database.schemaReady === false && database.missingAdaptiveTables?.length) {
      return `Saved generation; adaptive schema missing ${database.missingAdaptiveTables.length} table(s)`;
    }
    return 'Saved';
  }
  if (database.skipped) return database.error ? `Skipped: ${database.error}` : 'Skipped';
  return database.error ? `Not saved: ${database.error}` : 'Not saved';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showRunModal({ title, ok, message, createdAt, database, generationId, prompt, learning, outputKind, errorMessages }) {
  const backdrop = document.getElementById('run-modal-backdrop');
  const summary = document.getElementById('run-modal-summary');
  const feedbackPanel = document.getElementById('run-feedback-panel');
  const learningResult = document.getElementById('run-learning-result');
  const notes = document.getElementById('run-feedback-notes');
  if (!backdrop || !summary || !feedbackPanel || !learningResult || !notes) return;

  runModalContext = {
    generationId: generationId || null,
    prompt: prompt || '',
    outputKind: outputKind || 'generation',
    errorMessages: errorMessages || '',
  };

  setText('run-modal-title', title);
  setText('run-modal-time', `Timestamp: ${formatTimestamp(createdAt)}`);
  setText('run-modal-db', databaseStatusText(database));
  setText('run-modal-id', generationId || 'None');
  setText('run-modal-memory', String(learning?.memories ?? 0));
  setText('run-modal-docs', String(learning?.docs ?? 0));
  setText('run-modal-examples', String(learning?.examples ?? 0));

  summary.textContent = message;
  summary.className = `modal-summary ${ok ? 'ok' : 'error'}`;
  notes.value = '';
  learningResult.textContent = '';
  learningResult.classList.remove('show');
  feedbackPanel.classList.toggle('show', Boolean(generationId || prompt));
  backdrop.classList.add('show');
}

function closeRunModal() {
  const backdrop = document.getElementById('run-modal-backdrop');
  if (backdrop) backdrop.classList.remove('show');
}

async function submitRunFeedback(signal, rating) {
  if (!runModalContext) return;

  const resultEl = document.getElementById('run-learning-result');
  const notesEl = document.getElementById('run-feedback-notes');
  const feedback = notesEl?.value.trim() || '';
  if (!resultEl) return;

  resultEl.textContent = 'Analyzing this outcome against the learning database...';
  resultEl.classList.add('show');

  try {
    const r = await fetch('/learning/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationId: runModalContext.generationId,
        prompt: runModalContext.prompt,
        signal,
        rating,
        feedback,
        errorMessages: runModalContext.errorMessages,
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Learning analysis failed');

    const knowledgeStatus = data.memory?.details?.cadKnowledge;
    const memoryText = data.memory?.ok
      ? 'Saved a new weighted memory row.'
      : data.memory?.error
        ? `Memory not saved: ${data.memory.error}`
        : 'Memory save skipped.';
    const knowledgeText = knowledgeStatus?.ok
      ? 'Saved or updated a cad_knowledge lesson row.'
      : knowledgeStatus?.error
        ? `cad_knowledge not saved: ${knowledgeStatus.error}`
        : '';
    const pruneText = data.feedback?.prune?.details
      ? `Pruned memories this round: ${data.feedback.prune.details.prunedCount ?? 0}.`
      : '';

    resultEl.textContent = [
      data.analysis?.summary,
      data.analysis?.whatWentWrong ? `What was wrong: ${data.analysis.whatWentWrong}` : '',
      data.analysis?.weightAdvice ? `Weights: ${data.analysis.weightAdvice}` : '',
      memoryText,
      knowledgeText,
      pruneText,
    ].filter(Boolean).join('\n');
  } catch (e) {
    resultEl.textContent = `Learning analysis failed: ${e.message}`;
  }
}

async function checkLearningDiagnostics() {
  const box = document.getElementById('learning-diagnostics');
  if (!box) return;
  box.textContent = 'Checking database...';
  box.classList.add('show');

  try {
    const r = await fetch('/learning/diagnostics');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Diagnostics failed');

    const tableLines = (data.tables || []).map(table => {
      const status = table.available ? `${table.count} rows` : `missing/unavailable: ${table.error}`;
      return `${table.table}: ${status}`;
    });
    const recent = (data.recentGenerations || []).map(row => {
      return `- ${row.created_at} | ${row.shape_type || 'UNKNOWN'} | ${String(row.prompt || '').slice(0, 90)}`;
    });
    const memory = (data.topMemory || []).map(row => {
      return `- q=${row.quality_score} uses=${row.usage_count} ok=${row.success_count} fail=${row.failure_count} | ${row.title}`;
    });

    box.textContent = [
      `Connection: ${data.supabaseEnabled ? 'Connected' : 'Disabled'}`,
      `Adaptive schema: ${data.schemaReady ? 'Ready' : `Missing ${data.missingAdaptiveTables?.join(', ') || 'required tables'}`}`,
      `FeatureScript docs: ${data.featureScriptDocs?.enabled ? `${data.featureScriptDocs.chunks} indexed chunks` : 'Not found'}`,
      `Neural reranker: ${data.adaptiveNetwork ? `${data.adaptiveNetwork.hiddenLayers?.join('x') || 'configured'} hidden layers, ${data.adaptiveNetwork.trainedSteps || 0} training steps, source=${data.adaptiveNetwork.source}` : 'Not available'}`,
      '',
      'Tables:',
      ...tableLines,
      '',
      'Recent generations:',
      ...(recent.length ? recent : ['No generation rows visible.']),
      '',
      'Top memory:',
      ...(memory.length ? memory : ['No memory rows visible. Run the migration, then npm run seed:knowledge.']),
    ].join('\n');
  } catch (e) {
    box.textContent = `Diagnostics failed: ${e.message}`;
  }
}

function setOutput(id, code, copyBtnId, generationId = null) {
  const el = document.getElementById(id);
  el.textContent = code;
  el.classList.remove('empty');
  if (generationId) outputGenerationIds[id] = generationId;
  else delete outputGenerationIds[id];
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

  const generationId = outputGenerationIds[outputId];
  if (generationId) {
    fetch('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId, signal: 'copied' })
    }).catch(() => {});
  }
}

function sendToDebug() {
  const code = document.getElementById('gen-output').textContent;
  if (code && !document.getElementById('gen-output').classList.contains('empty')) {
    document.getElementById('debug-code').value = code;
    debugSourceGenerationId = outputGenerationIds['gen-output'] || null;
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
    setOutput('gen-output', data.code, 'copy-btn', data.generationId);
    setThinking('gen', data.thinking || '');
    setStatus('gen-status', `Generated "${data.featureLabel}" - ${databaseStatusText(data.database)}`, 'ok');
    showRunModal({
      title: 'Generation complete',
      ok: true,
      message: `Generated "${data.featureLabel}". ${databaseStatusText(data.database)}.`,
      createdAt: data.createdAt,
      database: data.database,
      generationId: data.generationId,
      prompt,
      learning: data.learning,
      outputKind: 'generation',
    });
  } catch (e) {
    setThinking('gen', '');
    setStatus('gen-status', `Error: ${e.message}`, 'error');
    showRunModal({
      title: 'Generation failed',
      ok: false,
      message: e.message,
      createdAt: new Date().toISOString(),
      prompt,
      outputKind: 'generation',
    });
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
      body: JSON.stringify({ code, errors, generationId: debugSourceGenerationId })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Debug failed');

    const expEl = document.getElementById('debug-explanation');
    expEl.textContent = data.explanation;
    expEl.classList.add('show');

    setOutput('debug-output', data.fixed, 'debug-copy-btn');
    setStatus('debug-status', `Fixed - ${databaseStatusText(data.database)}`, 'ok');
    showRunModal({
      title: 'Debug complete',
      ok: true,
      message: data.explanation || 'FeatureScript was analyzed and fixed.',
      createdAt: data.createdAt,
      database: data.database,
      generationId: debugSourceGenerationId,
      prompt: code.slice(0, 400),
      outputKind: 'debug',
      errorMessages: errors,
    });
  } catch (e) {
    setStatus('debug-status', `Error: ${e.message}`, 'error');
    showRunModal({
      title: 'Debug failed',
      ok: false,
      message: e.message,
      createdAt: new Date().toISOString(),
      prompt: code.slice(0, 400),
      outputKind: 'debug',
      errorMessages: errors,
    });
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

function formatAnalyzeDescription(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([^\n])\n(?=[^\n])/g, '$1 ')
    .trim();
}

function updateAnalyzeDescription(text, isPlaceholder = false) {
  const descEl = document.getElementById('analyze-desc');
  descEl.textContent = isPlaceholder ? text : formatAnalyzeDescription(text);
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
    setOutput('analyze-output', data.code, 'analyze-copy-btn', data.generationId);
    setThinking('analyze', data.thinking || '');
    setStatus('analyze-status', `Generated "${data.featureLabel}" - ${databaseStatusText(data.database)}`, 'ok');
    showRunModal({
      title: 'Image generation complete',
      ok: true,
      message: `Generated "${data.featureLabel}". ${databaseStatusText(data.database)}.`,
      createdAt: data.createdAt,
      database: data.database,
      generationId: data.generationId,
      prompt: globalPrompt,
      learning: data.learning,
      outputKind: 'image',
    });
  } catch (e) {
    setStatus('analyze-status', `Error: ${e.message}`, 'error');
    updateAnalyzeDescription('Analysis failed.', true);
    setThinking('analyze', '');
    showRunModal({
      title: 'Image generation failed',
      ok: false,
      message: e.message,
      createdAt: new Date().toISOString(),
      prompt: globalPrompt,
      outputKind: 'image',
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gen-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) generate();
  });

  syncSlotLabels();
  const firstSlot = document.querySelector('#image-slots-container .image-slot');
  if (firstSlot) firstSlot.classList.add('slot-visible');

  // Restore auth state on load
  authInit();
});

// ─── Auth ────────────────────────────────────────────────────────────────────

let _authMode = 'login'; // 'login' | 'signup'

function authInit() {
  const token = localStorage.getItem('cad_token');
  const username = localStorage.getItem('cad_username');
  if (token && username) updateUserBar(username);
}

function getAuthToken() { return localStorage.getItem('cad_token') || null; }
function getAuthHeaders() {
  const t = getAuthToken();
  return t ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` }
           : { 'Content-Type': 'application/json' };
}

function updateUserBar(username) {
  const nameEl = document.getElementById('user-bar-name');
  const btn = document.getElementById('user-bar-btn');
  const histBtn = document.getElementById('history-btn');
  if (username) {
    nameEl.textContent = `@${username}`;
    nameEl.style.display = 'inline';
    btn.textContent = 'Sign Out';
    histBtn.style.display = 'inline-block';
  } else {
    nameEl.style.display = 'none';
    btn.textContent = 'Sign In';
    histBtn.style.display = 'none';
  }
}

function userBarClick() {
  if (getAuthToken()) {
    localStorage.removeItem('cad_token');
    localStorage.removeItem('cad_username');
    updateUserBar(null);
  } else {
    openAuthModal('login');
  }
}

function openAuthModal(mode = 'login') {
  _authMode = mode;
  document.getElementById('auth-error').style.display = 'none';
  document.getElementById('auth-username').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-modal-title').textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
  document.getElementById('auth-modal-sub').textContent = mode === 'signup'
    ? 'Pick a username — no email needed.' : 'No email required.';
  document.getElementById('auth-submit-btn').textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
  document.getElementById('auth-switch-text').textContent = mode === 'signup'
    ? 'Already have an account? Sign in' : "Don't have an account? Sign up";
  const modal = document.getElementById('auth-modal');
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('auth-username').focus(), 50);
}

function closeAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
}

function toggleAuthMode() {
  openAuthModal(_authMode === 'login' ? 'signup' : 'login');
}

async function authSubmit() {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');
  errEl.style.display = 'none';

  if (!username || !password) { showAuthError('Enter username and password.'); return; }

  btn.disabled = true;
  btn.textContent = 'Please wait…';
  try {
    const r = await fetch(`/auth/${_authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json();
    if (!r.ok) { showAuthError(data.error || 'Something went wrong.'); return; }
    localStorage.setItem('cad_token', data.token);
    localStorage.setItem('cad_username', data.user.username);
    updateUserBar(data.user.username);
    closeAuthModal();
  } catch (e) {
    showAuthError('Network error — is the server running?');
  } finally {
    btn.disabled = false;
    btn.textContent = _authMode === 'signup' ? 'Create Account' : 'Sign In';
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// Handle Enter key in auth modal
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('auth-modal').style.display === 'flex') {
    authSubmit();
  }
  if (e.key === 'Escape') {
    closeAuthModal();
    closeHistory();
  }
});

// ─── History ─────────────────────────────────────────────────────────────────

async function openHistory() {
  const drawer = document.getElementById('history-drawer');
  drawer.style.display = 'block';
  const list = document.getElementById('history-list');
  list.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">Loading…</p>';

  try {
    const r = await fetch('/history', { headers: getAuthHeaders() });
    if (r.status === 401) {
      list.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">Sign in to see your history.</p>';
      return;
    }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    if (!data.history?.length) {
      list.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">No generations yet. Generate something first!</p>';
      return;
    }
    list.innerHTML = data.history.map(h => `
      <div style="background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:12px; cursor:pointer;"
           onclick="loadHistoryItem(${JSON.stringify(JSON.stringify(h)).replace(/\\/g, '\\\\')})">
        <div style="font-size:0.78rem; color:var(--muted); margin-bottom:4px;">
          ${new Date(h.created_at).toLocaleString()} · ${h.shape_type || 'CUSTOM'}
          ${h.user_rating ? ` · ${'★'.repeat(h.user_rating)}` : ''}
        </div>
        <div style="font-size:0.88rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${escHtml(h.prompt || '(no prompt)')}
        </div>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<p style="color:#ef4444; font-size:0.85rem;">Error: ${e.message}</p>`;
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function closeHistory() {
  document.getElementById('history-drawer').style.display = 'none';
}

function loadHistoryItem(jsonStr) {
  try {
    const h = JSON.parse(jsonStr);
    if (h.featurescript) {
      setOutput('gen-output', h.featurescript, 'copy-btn');
      document.getElementById('gen-status').textContent = `Loaded from history: ${h.prompt || ''}`;
      document.getElementById('gen-status').className = 'status show ok';
      switchTab('generate');
      closeHistory();
    }
  } catch { /* ignore */ }
}