import { el, toast, escapeHtml } from '../core/utils.js';
import { state } from '../core/state.js';
import { loadPodDocumentData, renderPodDocument, bindPodDocumentInteractions } from './podDocument.js';

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

  content.innerHTML = '<div class="muted" style="padding:24px 0;">Loading POD...</div>';
  modal.classList.remove('hidden');

  const jobId = job?.job_id || job?.id;
  const result = await loadPodDocumentData({ jobId });
  if (result.error) {
    content.innerHTML = `<p class="muted">Could not load POD: ${escapeHtml(result.error)}</p>`;
    return;
  }

  const logoSrc = el('sidebarLogo')?.getAttribute('src') || '';
  content.innerHTML = renderPodDocument(result, { interactive: true, logoSrc });
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
  bindPodDocumentInteractions(el('podViewerContent'));
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
