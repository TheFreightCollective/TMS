import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml, formatDateTime } from '../core/utils.js';
import { renderCustomerDashboard } from './customerPortal.js';
import { loadPodDocumentData, renderPodDocument, bindPodDocumentInteractions } from './podDocument.js';

function getJobProgress(job) {
  if (job?.delivered_at) return 'delivered';
  if (job?.picked_up_at) return 'picked_up';
  if (job?.accepted_at) return 'accepted';
  return 'pending';
}

function getJobStatus(job) {
  const status = String(job?.status || '').toLowerCase();
  const progress = getJobProgress(job);

  if (status === 'delivered' || progress === 'delivered') return 'completed';
  if (['accepted', 'picked_up'].includes(progress) || ['accepted', 'en_route_pickup', 'en_route_delivery', 'in_progress'].includes(status)) return 'in_progress';
  return status || 'pending_allocation';
}

function statusLabel(value) {
  return String(value || '—').replace(/_/g, ' ');
}

function renderJobRows(jobs) {
  const body = el('customerJobsBody');
  if (!body) return;

  if (!jobs?.length) {
    body.innerHTML = '<tr><td colspan="8" class="muted">No jobs yet.</td></tr>';
    return;
  }

  body.innerHTML = jobs.map(job => {
    const status = getJobStatus(job);
    return `
      <tr>
        <td data-label="Job"><strong>#${escapeHtml(job.job_number || '—')}</strong></td>
        <td data-label="Pickup">${escapeHtml([job.pickup_suburb, job.pickup_state].filter(Boolean).join(', ') || '—')}</td>
        <td data-label="Delivery">${escapeHtml([job.delivery_suburb, job.delivery_state].filter(Boolean).join(', ') || '—')}</td>
        <td data-label="Current Status"><span class="chip ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span></td>
        <td data-label="Pickup Status">${escapeHtml(statusLabel(job.status || '—'))}</td>
        <td data-label="Delivery Status">${escapeHtml(statusLabel(getJobProgress(job)))}</td>
        <td data-label="Created">${escapeHtml(formatDateTime(job.created_at))}</td>
        <td data-label="Actions"><button type="button" class="secondary small view-customer-job-btn" data-job-id="${escapeHtml(job.id)}">View POD</button></td>
      </tr>
    `;
  }).join('');
}

export async function loadCustomerJobs() {
  if (!state.currentUser || state.currentProfile?.role !== 'customer' || !state.currentCustomerId) {
    state.visibleJobs = [];
    renderCustomerDashboard([]);
    renderJobRows([]);
    return;
  }

  const { data: jobs, error: jobsError } = await sb
    .from('jobs')
    .select('id, job_number, customer_reference, status, accepted_at, picked_up_at, delivered_at, pickup_suburb, pickup_state, delivery_suburb, delivery_state, pickup_date, delivery_date, created_at')
    .eq('customer_id', state.currentCustomerId)
    .order('created_at', { ascending: false });

  if (jobsError) {
    toast('Load jobs failed: ' + jobsError.message, true);
    return;
  }

  state.visibleJobs = jobs || [];

  renderCustomerDashboard(state.visibleJobs);
  renderJobRows(state.visibleJobs);
}

async function openCustomerJobDetails(jobId) {
  if (!jobId || !state.currentCustomerId) return;

  const modal = el('customerJobModal');
  const content = el('customerJobModalContent');
  if (!modal || !content) return;

  content.innerHTML = '<div class="muted" style="padding:24px 0;">Loading POD...</div>';
  modal.classList.remove('hidden');

  const result = await loadPodDocumentData({ jobId, customerId: state.currentCustomerId });
  if (result.error) {
    content.innerHTML = `<p class="muted">Could not load POD: ${escapeHtml(result.error)}</p>`;
    return;
  }

  const logoSrc = el('sidebarLogo')?.getAttribute('src') || '';
  content.innerHTML = renderPodDocument(result, { interactive: true, logoSrc });
}

function closeCustomerJobDetails() {
  el('customerJobModal')?.classList.add('hidden');
}

export function bindCustomerJobsEvents() {
  bindPodDocumentInteractions(el('customerJobModalContent'));

  el('reloadMyJobsBtn')?.addEventListener('click', loadCustomerJobs);
  el('customerPrintPodBtn')?.addEventListener('click', () => window.print());
  el('closeCustomerJobModalBtn')?.addEventListener('click', closeCustomerJobDetails);
  el('customerJobModal')?.addEventListener('click', evt => {
    if (evt.target === el('customerJobModal')) closeCustomerJobDetails();
  });

  document.addEventListener('click', evt => {
    const btn = evt.target.closest('.view-customer-job-btn');
    if (!btn) return;
    openCustomerJobDetails(btn.getAttribute('data-job-id'));
  });

  window.openCustomerJobDetails = openCustomerJobDetails;
}