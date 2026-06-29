import { sb } from '../core/supabaseClient.js';
import { el, toast, escapeHtml, formatDateTime } from '../core/utils.js';
import { state } from '../core/state.js';

let currentPodJob = null;

// ─── Open ─────────────────────────────────────────────────────────────────────
export async function openPodViewer(job) {
  const role = state.currentProfile?.role;
  if (!['admin', 'ops'].includes(role)) {
    toast('Access denied', true);
    return;
  }

  currentPodJob = job;
  const modal = el('podViewerModal');
  const content = el('podViewerContent');
  if (!modal || !content) return;

  content.innerHTML = '<div class="muted" style="padding:24px 0;">Loading proof records...</div>';
  modal.classList.remove('hidden');

  // Fetch proof events for this job (both pickup/POP and delivery/POD)
  const { data: proofEvents, error: eventsError } = await sb
    .from('proof_events')
    .select('*')
    .eq('job_id', job.job_id)
    .order('event_at', { ascending: true });

  if (eventsError) {
    content.innerHTML = `<p class="muted">Could not load proof records: ${escapeHtml(eventsError.message)}</p>`;
    return;
  }

  if (!proofEvents || !proofEvents.length) {
    content.innerHTML = `
      <div style="text-align:center;padding:32px 0;">
        <div style="font-size:32px;margin-bottom:12px;">📋</div>
        <p class="muted">No proof records found for this job.</p>
        <p class="muted" style="font-size:12px;margin-top:6px;">Proof is captured when a driver completes pickup or delivery on the driver app.</p>
      </div>`;
    return;
  }

  // Fetch proof_files for all events
  const eventIds = proofEvents.map(e => e.id);
  const { data: proofFiles, error: filesError } = await sb
    .from('proof_files')
    .select('*')
    .in('proof_event_id', eventIds);

  if (filesError) console.warn('Could not load proof files:', filesError.message);

  const filesByEvent = {};
  (proofFiles || []).forEach(f => {
    if (!filesByEvent[f.proof_event_id]) filesByEvent[f.proof_event_id] = [];
    filesByEvent[f.proof_event_id].push(f);
  });

  // Build public URLs from storage paths
  function getPublicUrl(path) {
    return sb.storage.from('pod-files').getPublicUrl(path).data?.publicUrl || null;
  }

  function renderProofBlock(event, files) {
    const isPickup = event.proof_type === 'pickup';
    const label = isPickup ? 'Proof of Pickup' : 'Proof of Delivery';
    const icon = isPickup ? '📦' : '✅';

    const photos = (files || []).filter(f => f.mime_type && f.mime_type.startsWith('image/') && !f.object_path.includes('signature'));
    const sigFile = (files || []).find(f => f.object_path.includes('signature'));

    const photoHtml = photos.length
      ? `<div class="pod-photos">${photos.map(f => {
          const url = getPublicUrl(f.object_path);
          return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" class="pod-photo" loading="lazy" /></a>` : '';
        }).join('')}</div>`
      : '<p class="muted" style="font-size:13px;">No photos recorded.</p>';

    const sigHtml = sigFile
      ? `<div class="pod-sig-wrap"><img src="${escapeHtml(getPublicUrl(sigFile.object_path))}" class="pod-sig" /></div>`
      : '<p class="muted" style="font-size:13px;">No signature recorded.</p>';

    return `
      <div class="pod-block">
        <div class="pod-block-header">
          <span style="font-size:20px;">${icon}</span>
          <div>
            <strong>${label}</strong>
            <div class="muted" style="font-size:12px;">${formatDateTime(event.event_at)}</div>
          </div>
        </div>
        <div class="pod-meta-grid">
          <div><span class="muted pod-label">Received by</span><div class="pod-value">${escapeHtml(event.signed_name || '—')}</div></div>
          <div><span class="muted pod-label">Notes</span><div class="pod-value">${escapeHtml(event.notes || '—')}</div></div>
        </div>
        <div style="margin-top:14px;"><div class="pod-label muted">Photos</div>${photoHtml}</div>
        <div style="margin-top:14px;"><div class="pod-label muted">Signature</div>${sigHtml}</div>
      </div>`;
  }

  const customerRef = escapeHtml(job.customer_reference || '—');
  const jobNumber = escapeHtml(job.job_number || '');
  const customerName = escapeHtml(job.customer_name || '—');

  content.innerHTML = `
    <div class="pod-header-meta">
      <div class="pod-job-title">Job #${jobNumber}</div>
      <div class="pod-meta-grid" style="margin-top:10px;">
        <div><span class="muted pod-label">Customer</span><div class="pod-value">${customerName}</div></div>
        <div><span class="muted pod-label">Reference</span><div class="pod-value">${customerRef}</div></div>
        <div><span class="muted pod-label">Pickup date</span><div class="pod-value">${formatDateTime(job.pickup_date)}</div></div>
        <div><span class="muted pod-label">Delivery date</span><div class="pod-value">${formatDateTime(job.delivery_date)}</div></div>
      </div>
    </div>
    <div class="pod-events">
      ${proofEvents.map(evt => renderProofBlock(evt, filesByEvent[evt.id] || [])).join('')}
    </div>`;
}

function closePodViewer() {
  el('podViewerModal')?.classList.add('hidden');
  currentPodJob = null;
}

function printPod() {
  window.print();
}

// ─── Bind ─────────────────────────────────────────────────────────────────────
export function bindPodViewerEvents() {
  el('closePodViewerBtn')?.addEventListener('click', closePodViewer);
  el('printPodBtn')?.addEventListener('click', printPod);

  // Delegate from jobs table — "POD" button
  document.addEventListener('click', async function (evt) {
    const btn = evt.target.closest('.open-pod-btn');
    if (!btn) return;
    const jobId = btn.getAttribute('data-job-id');
    const job = (state.visibleJobs || []).find(j => String(j.job_id) === String(jobId));
    if (job) await openPodViewer(job);
  });
}
