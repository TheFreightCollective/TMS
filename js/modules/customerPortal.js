import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml, formatDateTime } from '../core/utils.js';

function getJobProgress(job) {
  if (job?.delivered_at) return 'delivered';
  if (job?.picked_up_at) return 'picked_up';
  if (job?.accepted_at) return 'accepted';
  return 'pending';
}

function getCustomerJobStatus(job) {
  const status = String(job?.status || '').toLowerCase();
  const progress = getJobProgress(job);

  if (status === 'delivered' || progress === 'delivered') return 'completed';
  if (['accepted', 'picked_up'].includes(progress) || ['accepted', 'en_route_pickup', 'en_route_delivery', 'in_progress'].includes(status)) return 'in_progress';
  return status || 'pending_allocation';
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = String(value);
}

function getCustomerJobsSummary(jobs) {
  const allJobs = jobs || [];
  return {
    current: allJobs.length,
    pending: allJobs.filter(job => ['pending_allocation', 'allocated'].includes(getCustomerJobStatus(job))).length,
    transit: allJobs.filter(job => getCustomerJobStatus(job) === 'in_progress').length,
    completed: allJobs.filter(job => getCustomerJobStatus(job) === 'completed').length,
  };
}

function renderRecentJobs(jobs) {
  const container = el('customerRecentJobs');
  if (!container) return;

  const recent = [...(jobs || [])].slice(0, 5);
  if (!recent.length) {
    container.innerHTML = '<p class="muted" style="margin:0;">No jobs yet.</p>';
    return;
  }

  container.innerHTML = `
    <table class="jobs-table" style="margin-top:4px;">
      <thead>
        <tr>
          <th>Job</th>
          <th>Reference</th>
          <th>Pickup</th>
          <th>Delivery</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${recent.map(job => {
          const status = getCustomerJobStatus(job);
          return `
            <tr>
              <td><strong>#${escapeHtml(job.job_number || '—')}</strong></td>
              <td>${escapeHtml(job.customer_reference || '—')}</td>
              <td>${escapeHtml(job.pickup_suburb || '—')}</td>
              <td>${escapeHtml(job.delivery_suburb || '—')}</td>
              <td><span class="chip ${escapeHtml(status)}">${escapeHtml(status.replace(/_/g, ' '))}</span></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

export function renderCustomerDashboard(jobs) {
  const summary = getCustomerJobsSummary(jobs);
  setText('customerStatCurrent', summary.current);
  setText('customerStatPending', summary.pending);
  setText('customerStatTransit', summary.transit);
  setText('customerStatCompleted', summary.completed);
  renderRecentJobs(jobs);
}

export function renderCustomerJobs(jobs) {
  const body = el('customerJobsBody');
  if (!body) return;

  if (!jobs?.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No jobs yet.</td></tr>';
    return;
  }

  body.innerHTML = jobs.map(job => {
    const status = getCustomerJobStatus(job);
    return `
      <tr>
        <td data-label="Job"><strong>#${escapeHtml(job.job_number || '—')}</strong></td>
        <td data-label="Reference">${escapeHtml(job.customer_reference || '—')}</td>
        <td data-label="Pickup">${escapeHtml(job.pickup_suburb || '—')}</td>
        <td data-label="Delivery">${escapeHtml(job.delivery_suburb || '—')}</td>
        <td data-label="Pickup Date">${escapeHtml(formatDateTime(job.pickup_date))}</td>
        <td data-label="Delivery Date">${escapeHtml(formatDateTime(job.delivery_date))}</td>
        <td data-label="Status"><span class="chip ${escapeHtml(status)}">${escapeHtml(status.replace(/_/g, ' '))}</span></td>
      </tr>
    `;
  }).join('');
}

export async function loadCustomerJobs() {
  if (!state.currentUser || state.currentProfile?.role !== 'customer' || !state.currentCustomerId) {
    state.visibleJobs = [];
    renderCustomerDashboard([]);
    renderCustomerJobs([]);
    return;
  }

  const { data, error } = await sb
    .from('jobs')
    .select('id, job_number, customer_reference, status, accepted_at, picked_up_at, delivered_at, pickup_suburb, delivery_suburb, pickup_date, delivery_date, created_at')
    .eq('customer_id', state.currentCustomerId)
    .order('created_at', { ascending: false });

  if (error) {
    toast('Load jobs failed: ' + error.message, true);
    return;
  }

  if (!data?.length) {
    state.visibleJobs = [];
    renderCustomerDashboard([]);
    renderCustomerJobs([]);
    return;
  }

  state.visibleJobs = data || [];
  renderCustomerDashboard(state.visibleJobs);
  renderCustomerJobs(state.visibleJobs);
}

export function bindCustomerPortalEvents() {
  el('reloadMyJobsBtn')?.addEventListener('click', loadCustomerJobs);
  el('createJobBtn')?.addEventListener('click', async evt => {
    evt.preventDefault();
    const { createJob } = await import('./jobs.js');
    await createJob();
    await loadCustomerJobs();
  });
}