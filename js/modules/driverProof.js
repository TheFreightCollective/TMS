import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast } from '../core/utils.js';
import { loadDriverJobs, updateDriverLegStatus } from './driverJobs.js';

let activeProofJobId = null;
let activeProofLegType = null;
let signaturePadBound = false;

// Accumulated photos across multiple captures — fixes the single-photo override bug
let accumulatedPhotos = [];

export function openProofModal(job, legType) {
  activeProofJobId = job.job_id;
  activeProofLegType = legType;
  accumulatedPhotos = [];
  signaturePadBound = false;

  el('proofModalTitle').textContent = legType === 'pickup' ? 'Complete pickup' : 'Complete delivery';
  el('proofModalSub').textContent = `Job #${job.job_number || ''} • ${job.customer_name || ''}`;
  el('modalProofName').value = '';
  el('modalProofNotes').value = '';
  el('modalProofPhoto').value = '';
  el('modalProofPreview').innerHTML = '<span class="muted">No photos yet — tap the button below to add</span>';
  clearSignature('modalProofSignature');
  initSignaturePad('modalProofSignature');
  el('proofModal').classList.remove('hidden');
}

function closeProofModal() {
  activeProofJobId = null;
  activeProofLegType = null;
  accumulatedPhotos = [];
  signaturePadBound = false;
  el('proofModal')?.classList.add('hidden');
}

function renderPhotoPreview() {
  const preview = el('modalProofPreview');
  if (!preview) return;
  if (!accumulatedPhotos.length) {
    preview.innerHTML = '<span class="muted">No photos yet</span>';
    return;
  }
  preview.innerHTML = `
    <div class="muted" style="margin-bottom:6px;">${accumulatedPhotos.length} photo(s) added</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      ${accumulatedPhotos.map((file, i) => `
        <div class="proof-thumb" style="position:relative;">
          <img src="${URL.createObjectURL(file)}" />
          <button type="button" data-remove-photo="${i}" style="position:absolute;top:2px;right:2px;width:18px;height:18px;padding:0;font-size:10px;border-radius:50%;background:#dc2626;color:#fff;display:flex;align-items:center;justify-content:center;min-width:0;">×</button>
        </div>`).join('')}
    </div>`;
}

async function saveModalLegProof(jobId, legType) {
  const recipientName = (el('modalProofName')?.value || '').trim();
  const notes = (el('modalProofNotes')?.value || '').trim();
  const sigCanvas = el('modalProofSignature');

  if (!recipientName) { toast('Enter recipient name', true); return false; }
  if (!accumulatedPhotos.length) { toast('Add at least one proof photo', true); return false; }
  if (!sigCanvas) { toast('Signature pad not found', true); return false; }

  const sigDataUrl = sigCanvas.toDataURL('image/png');
  // A blank canvas produces a ~70 char data URL — anything meaningful is much larger
  if (!sigDataUrl || sigDataUrl.length < 500) { toast('Please add a signature', true); return false; }

  // 1. Create the proof_event row first
  const proofType = legType === 'pickup' ? 'pickup' : 'delivery';
  const { data: proofEvent, error: proofEventError } = await sb
    .from('proof_events')
    .insert([{
      job_id: jobId,
      proof_type: proofType,
      signed_name: recipientName,
      notes: notes || null,
      event_at: new Date().toISOString(),
      created_by: state.currentUser.id
    }])
    .select()
    .single();

  if (proofEventError) { toast('Could not save proof record: ' + proofEventError.message, true); return false; }

  // 2. Upload all photos and insert proof_files rows
  for (const file of accumulatedPhotos) {
    const photoPath = `${state.currentUser.id}/job-${jobId}/${legType}/photo-${Date.now()}-${file.name}`;
    const { error: uploadError } = await sb.storage.from('pod-files').upload(photoPath, file, { upsert: true });
    if (uploadError) { toast('Photo upload failed: ' + uploadError.message, true); return false; }
    const { error: fileRowError } = await sb.from('proof_files').insert([{
      proof_event_id: proofEvent.id,
      bucket_name: 'pod-files',
      object_path: photoPath,
      mime_type: file.type || 'image/jpeg',
      file_size: file.size || 0
    }]);
    if (fileRowError) console.warn('proof_files insert failed:', fileRowError.message);
  }

  // 3. Upload signature
  const sigBlob = await (await fetch(sigDataUrl)).blob();
  const sigPath = `${state.currentUser.id}/job-${jobId}/${legType}/signature-${Date.now()}.png`;
  const { error: sigUploadError } = await sb.storage.from('pod-files').upload(sigPath, sigBlob, { upsert: true, contentType: 'image/png' });
  if (sigUploadError) { toast('Signature upload failed: ' + sigUploadError.message, true); return false; }
  await sb.from('proof_files').insert([{
    proof_event_id: proofEvent.id,
    bucket_name: 'pod-files',
    object_path: sigPath,
    mime_type: 'image/png',
    file_size: sigBlob.size || 0
  }]);

  return true;
}

function initSignaturePad(canvasId) {
  const canvas = el(canvasId);
  if (!canvas || signaturePadBound) return;
  signaturePadBound = true;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  let drawing = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const touch = e.touches ? e.touches[0] : e;
    return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
  }
  function start(e) { drawing = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); e.preventDefault(); }
  function move(e) { if (!drawing) return; const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); e.preventDefault(); }
  function end() { drawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}

function clearSignature(canvasId) {
  const canvas = el(canvasId);
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

export function bindDriverProofEvents() {
  // Photo input — ACCUMULATES files rather than replacing them
  el('modalProofPhoto')?.addEventListener('change', function () {
    const newFiles = Array.from(this.files || []);
    if (!newFiles.length) return;
    accumulatedPhotos = accumulatedPhotos.concat(newFiles);
    this.value = ''; // reset so the same file can be added again if needed
    renderPhotoPreview();
  });

  // Remove individual photo thumbnail
  el('modalProofPreview')?.addEventListener('click', function (evt) {
    const btn = evt.target.closest('[data-remove-photo]');
    if (!btn) return;
    const idx = parseInt(btn.getAttribute('data-remove-photo'), 10);
    accumulatedPhotos.splice(idx, 1);
    renderPhotoPreview();
  });

  el('closeProofModalBtn')?.addEventListener('click', closeProofModal);
  el('clearModalSignatureBtn')?.addEventListener('click', () => clearSignature('modalProofSignature'));

  el('submitProofBtn')?.addEventListener('click', async function () {
    if (!activeProofJobId || !activeProofLegType) return;
    const ok = await saveModalLegProof(activeProofJobId, activeProofLegType);
    if (!ok) return;
    if (activeProofLegType === 'pickup') await updateDriverLegStatus(activeProofJobId, 'pickup', 'picked_up');
    if (activeProofLegType === 'delivery') await updateDriverLegStatus(activeProofJobId, 'delivery', 'delivered');
    closeProofModal();
    await loadDriverJobs();
  });
}