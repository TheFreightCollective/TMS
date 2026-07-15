import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml, formatDateTime } from '../core/utils.js';

function getJobProgress(job) {
  if (job?.delivered_at) return 'delivered';
  if (job?.picked_up_at) return 'picked_up';
  if (job?.accepted_at) return 'accepted';
  return 'pending';
}

function isCompletedJob(job) {
  const progress = getJobProgress(job);
  const status = String(job?.status || '').toLowerCase();
  const completedValues = ['delivered', 'complete', 'completed', 'completed_job', 'done', 'closed', 'invoiced', 'pod_received', 'pod_uploaded'];
  const hasCompletedFlag = progress === 'delivered' || [status].some(value => completedValues.includes(value));
  const hasProofFlag = [job?.pod_received, job?.pod_uploaded, job?.proof_received, job?.proof_uploaded].some(Boolean);
  const deliveryDate = job?.delivery_date || job?.pickup_date;
  const deliveryIsPast = deliveryDate && new Date(deliveryDate) < new Date();
  return hasCompletedFlag || hasProofFlag || (deliveryIsPast && (['accepted', 'picked_up', 'delivered'].includes(progress) || status));
}

function getCustomerName(job, customerMap) {
  return job.customer_name || customerMap.get(job.customer_id)?.company_name || customerMap.get(job.customer_id)?.contact_name || 'Unassigned customer';
}

async function loadCustomerMap(customerIds) {
  if (!customerIds.length) return new Map();
 const { data, error } = await sb.from('customers').select('id, company_name').in('id', customerIds);
  if (error || !data?.length) return new Map();
  return new Map(data.map(customer => [customer.id, customer]));
}

function updateInvoiceSummary() {
  const summary = el('invoiceSelectionSummary');
  const selectedCount = document.querySelectorAll('.invoice-select-checkbox:checked').length;
  const totalCount = state.invoiceCandidates?.length || 0;
  if (summary) {
    summary.textContent = `${selectedCount} selected of ${totalCount} completed jobs`;
  }

  const button = el('generateInvoicesBtn');
  if (button) {
    button.textContent = selectedCount ? `Generate invoices (${selectedCount})` : 'Generate invoices';
  }
}

export function renderInvoiceCandidates(jobs) {
  const body = el('invoiceJobsBody');
  if (!body) return;

  if (!jobs?.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">No completed jobs available yet.</td></tr>';
    updateInvoiceSummary();
    return;
  }

  body.innerHTML = jobs.map(job => `
    <tr>
      <td><input type="checkbox" class="invoice-select-checkbox" data-job-id="${job.id}" /></td>
      <td><strong>#${escapeHtml(job.job_number || job.id || '—')}</strong></td>
      <td>${escapeHtml(job.customerName || '—')}</td>
      <td>${escapeHtml(job.customer_reference || '—')}</td>
      <td>${formatDateTime(job.delivery_date || job.pickup_date)}</td>
      <td>${Number(job.total_weight_kg || 0).toFixed(0)} kg</td>
      <td>${Number(job.total_cubic_m3 || 0).toFixed(3)} m³</td>
    </tr>
  `).join('');

  updateInvoiceSummary();
}

function renderInvoiceDrafts() {
  const container = el('invoiceDrafts');
  if (!container) return;

  if (!state.invoiceDrafts?.length) {
    container.innerHTML = '<div class="muted">Select completed jobs to prepare invoice drafts.</div>';
    return;
  }

  container.innerHTML = state.invoiceDrafts.map(draft => `
    <div class="invoice-draft-card">
      <div class="invoice-draft-header">
        <strong>${escapeHtml(draft.customerName)}</strong>
        <span>${draft.jobCount} job${draft.jobCount > 1 ? 's' : ''}</span>
      </div>
      <ul class="invoice-draft-list">
        ${draft.jobs.map(job => `<li>#${escapeHtml(job.job_number || job.id || '—')} — ${escapeHtml(job.customer_reference || 'No reference')}</li>`).join('')}
      </ul>
      <div class="muted" style="font-size:12px;">Draft ready for export to your accounting system.</div>
    </div>
  `).join('');
}

export async function loadInvoiceCandidates() {
  const body = el('invoiceJobsBody');
  if (!body) return;

  body.innerHTML = '<tr><td colspan="7" class="muted">Loading completed jobs...</td></tr>';

  let data = [];
  let error = null;

  const viewRes = await sb
    .from('v_job_current_allocations')
    .select('job_id, job_number, customer_id, customer_name, customer_reference, pickup_date, delivery_date, total_weight_kg, total_cubic_m3, accepted_at, picked_up_at, delivered_at, status')
    .order('delivery_date', { ascending: false });

  if (!viewRes.error && viewRes.data?.length) {
    data = viewRes.data.map(job => ({
      id: job.job_id,
      ...job,
      customer_id: job.customer_id || null,
      customer_name: job.customer_name || null
    }));
  } else {
    error = viewRes.error;
    const jobsRes = await sb
      .from('jobs')
      .select('id, job_number, customer_id, customer_reference, pickup_date, delivery_date, total_weight_kg, total_cubic_m3, accepted_at, picked_up_at, delivered_at, status')
      .order('delivery_date', { ascending: false });
    if (!jobsRes.error) data = jobsRes.data || [];
    else error = jobsRes.error;
  }

  if (error) {
    toast('Could not load completed jobs for invoices', true);
    body.innerHTML = '<tr><td colspan="7" class="muted">Unable to load completed jobs right now.</td></tr>';
    return;
  }

  const completedJobs = (data || []).filter(isCompletedJob);
  const candidateJobs = completedJobs.length ? completedJobs : (data || []).slice(0, 20);
  const customerIds = [...new Set(candidateJobs.map(job => job.customer_id).filter(Boolean))];
  const customerMap = await loadCustomerMap(customerIds);

  state.invoiceCandidates = candidateJobs.map(job => ({
    ...job,
    customerName: getCustomerName(job, customerMap)
  }));
  state.invoiceDrafts = [];
  renderInvoiceCandidates(state.invoiceCandidates);
  renderInvoiceDrafts();
}

export function bindInvoiceEvents() {
  const selectAll = el('invoiceSelectAll');
  const generateBtn = el('generateInvoicesBtn');

  selectAll?.addEventListener('change', evt => {
    const checked = evt.target.checked;
    document.querySelectorAll('.invoice-select-checkbox').forEach(box => {
      box.checked = checked;
    });
    updateInvoiceSummary();
  });

  generateBtn?.addEventListener('click', () => {
    const selectedJobs = state.invoiceCandidates.filter(job => {
      const checkbox = document.querySelector(`.invoice-select-checkbox[data-job-id="${job.id}"]`);
      return checkbox?.checked;
    });

    if (!selectedJobs.length) {
      toast('Select at least one completed job to generate an invoice draft.', true);
      return;
    }

    const grouped = new Map();
    selectedJobs.forEach(job => {
      const key = job.customer_id || job.customerName;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(job);
    });

    state.invoiceDrafts = Array.from(grouped.entries()).map(([key, jobs]) => ({
      customerId: key,
      customerName: jobs[0].customerName,
      jobCount: jobs.length,
      jobs
    }));

    renderInvoiceDrafts();
    toast(`Prepared ${state.invoiceDrafts.length} invoice draft${state.invoiceDrafts.length > 1 ? 's' : ''}.`);
  });

  document.addEventListener('change', evt => {
    if (evt.target.classList.contains('invoice-select-checkbox')) {
      updateInvoiceSummary();
    }
  });

  loadInvoiceCandidates();
}
