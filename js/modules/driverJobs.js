import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml } from '../core/utils.js';
import { openProofModal } from './driverProof.js';

export async function updateDriverLegStatus(jobId, legType, status){
  const res = await sb.rpc('update_job_leg_status', { p_job_id: jobId, p_leg_type: legType, p_status: status });
  if(res.error){ toast('Status update failed: ' + res.error.message, true); return false; }
  toast(legType.charAt(0).toUpperCase() + legType.slice(1) + ' status updated to ' + status, false);
  return true;
}

export async function loadDriverJobs(){
  if(!state.currentUser || !state.currentProfile || !state.currentDriver){ state.visibleJobs=[]; renderDriverJobs([]); return; }
  const res = await sb.from('v_job_current_allocations').select('*').order('job_number', { ascending:false });
  if(res.error){ toast('Load jobs failed: ' + res.error.message, true); return; }
  let data = res.data || [];
  data = data.filter(j => (j.pickup_driver_id === state.currentDriver.id && j.pickup_status !== 'picked_up') || (j.delivery_driver_id === state.currentDriver.id && j.pickup_status === 'picked_up' && j.delivery_status !== 'delivered'));
  state.visibleJobs = data;
  renderDriverJobs(state.visibleJobs);
  const statsEl = el('driverStats');
  if(statsEl) statsEl.textContent = state.visibleJobs.length + ' active job(s)';
}

function renderDriverLegNotice(job){
  const bits = [];
  if(job.pickup_driver_id === state.currentDriver?.id) bits.push('You are assigned to pickup');
  if(job.delivery_driver_id === state.currentDriver?.id) bits.push('You are assigned to delivery');
  return bits.length ? `<div class="chip">${escapeHtml(bits.join(' • '))}</div>` : '';
}

function renderDriverLegActions(job){
  let html = '';
  if(job.pickup_driver_id === state.currentDriver?.id){
    const pickupStatus = job.pickup_status || 'allocated';
    if(pickupStatus === 'allocated') html += `<button class="driver-action-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="pickup" data-status="accepted">Accept pickup</button>`;
    if(pickupStatus === 'accepted') html += `<button class="driver-action-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="pickup" data-status="en_route_pickup">Start pickup</button>`;
    if(pickupStatus === 'en_route_pickup') html += `<button class="open-proof-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="pickup">Complete pickup</button>`;
  }
  if(job.delivery_driver_id === state.currentDriver?.id){
    const deliveryStatus = job.delivery_status || 'allocated';
    if(job.pickup_status === 'picked_up'){
      if(deliveryStatus === 'allocated') html += `<button class="driver-action-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="delivery" data-status="accepted">Accept delivery</button>`;
      if(deliveryStatus === 'accepted') html += `<button class="driver-action-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="delivery" data-status="en_route_delivery">Start delivery</button>`;
      if(deliveryStatus === 'en_route_delivery') html += `<button class="open-proof-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="delivery">Complete delivery</button>`;
    }
  }
  return html ? `<div class="stack">${html}</div>` : '';
}

export function renderDriverJobs(jobs){
  const root = el('jobs');
  if(!root) return;
  if(!jobs || !jobs.length){ root.innerHTML = '<div class="muted">No jobs visible.</div>'; return; }
  root.innerHTML = jobs.map(job => `<div class="job-card"><div><h3>Job #${escapeHtml(job.job_number || '')}</h3><div class="muted">Customer: ${escapeHtml(job.customer_name || '—')}<br>Ref: ${escapeHtml(job.customer_reference || '—')}</div></div>${renderDriverLegNotice(job)}<div class="leg-box"><div class="muted">Pickup driver</div><div>${escapeHtml(job.pickup_driver_name || 'Unallocated')}</div><div class="muted">Pickup status: ${escapeHtml(job.pickup_status || '—')}</div></div><div class="leg-box"><div class="muted">Delivery driver</div><div>${escapeHtml(job.delivery_driver_name || 'Unallocated')}</div><div class="muted">Delivery status: ${escapeHtml(job.delivery_status || '—')}</div></div>${renderDriverLegActions(job)}</div>`).join('');
}

export function bindDriverJobEvents(){
  el('refreshJobsBtnDriver')?.addEventListener('click', loadDriverJobs);
  document.addEventListener('click', async function(evt){
    const actionBtn = evt.target.closest('.driver-action-btn');
    if(actionBtn){
      const ok = await updateDriverLegStatus(actionBtn.getAttribute('data-job-id'), actionBtn.getAttribute('data-leg-type'), actionBtn.getAttribute('data-status'));
      if(ok) await loadDriverJobs();
      return;
    }
    const proofBtn = evt.target.closest('.open-proof-btn');
    if(proofBtn){
      const jobId = proofBtn.getAttribute('data-job-id');
      const legType = proofBtn.getAttribute('data-leg-type');
      const job = state.visibleJobs.find(j => String(j.job_id) === String(jobId));
      if(job) openProofModal(job, legType);
    }
  });
}
