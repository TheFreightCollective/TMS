import { sb } from '../core/supabaseClient.js';
import { el, toast, escapeHtml } from '../core/utils.js';
import { loadJobs, getJobStatus } from './jobs.js';
import { loadDrivers } from './drivers.js';
import { state } from '../core/state.js';
import { openEditJob } from './editJob.js';
import { loadVehicles } from './vehicles.js';

export async function allocateJobLeg(jobId, legType, vehicleId, driverId = null) {

  const res = await sb.rpc('allocate_job_leg', {
    p_job_id: jobId,
    p_leg_type: legType,
    p_driver_id: driverId || null,  // TEMP: still supported
    p_vehicle_id: vehicleId || null,
    p_notes: null
  });

  if (res.error) {
    toast('Allocation failed: ' + res.error.message, true);
    return;
  }

  toast(`${legType} vehicle assigned`);

  await loadJobs();
  renderAllocationBoard();
}




export async function updateJobLegStatus(jobId, legType, status) { const res = await sb.rpc('update_job_leg_status', { p_job_id: jobId, p_leg_type: legType, p_status: status }); if (res.error) { toast('Status update failed: ' + res.error.message, true); return; } toast(`${legType.charAt(0).toUpperCase() + legType.slice(1)} status updated to ${status}`); await loadJobs(); renderAllocationBoard(); }

function renderAllocationBoard() {
  const root = el('allocationBoard');
  if (!root) return;

  const jobs = (state.visibleJobs || []).filter(job =>
    !job.pickup_vehicle_id || !job.delivery_vehicle_id
  );

  if (!jobs.length) {
    root.innerHTML = '<div class="muted">No jobs need allocation right now.</div>';
    return;
  }

  root.innerHTML = jobs.map(job => `
    <div class="allocation-card">
      <div class="allocation-card-header">
        <button type="button" class="inline-link open-job-items-btn" data-job-id="${escapeHtml(job.job_id)}">
          #${escapeHtml(job.job_number || '')}
        </button>
        <span class="chip ${getJobStatus(job)}">
          ${getJobStatus(job).replace(/_/g, ' ')}
        </span>
      </div>

      <div class="muted" style="font-size:12px;">
        ${escapeHtml(job.customer_name || '—')}
      </div>

      <div class="muted" style="font-size:12px;">
        Pickup: ${escapeHtml(job.pickup_company_name || job.pickup_company || '—')} • 
        ${escapeHtml(job.pickup_suburb || '—')}
      </div>

      <div class="muted" style="font-size:12px;">
        Delivery: ${escapeHtml(job.delivery_company_name || job.delivery_company || '—')} • 
        ${escapeHtml(job.delivery_suburb || '—')}
      </div>

      <div class="allocation-selects">

        <div>
          <label class="muted" style="font-size:11px;">Pickup vehicle</label>
          <select data-job="${job.job_id}" data-type="pickup" class="vehicle-select">
            ${
              ['<option value="">Select vehicle...</option>']
                .concat(
                  (state.vehicleOptions || []).map(v => `
                    <option value="${escapeHtml(v.id)}" ${job.pickup_vehicle_id === v.id ? 'selected' : ''}>
                      ${escapeHtml(v.vehicle_name || v.rego || 'Vehicle')}
                    </option>
                  `)
                ).join('')
            }
          </select>
        </div>

        <div>
          <label class="muted" style="font-size:11px;">Delivery vehicle</label>
          <select data-job="${job.job_id}" data-type="delivery" class="vehicle-select">
            ${
              ['<option value="">Select vehicle...</option>']
                .concat(
                  (state.vehicleOptions || []).map(v => `
                    <option value="${escapeHtml(v.id)}" ${job.delivery_vehicle_id === v.id ? 'selected' : ''}>
                      ${escapeHtml(v.vehicle_name || v.rego || 'Vehicle')}
                    </option>
                  `)
                ).join('')
            }
          </select>
        </div>

      </div>
    </div>
  `).join('');
}


export function bindAllocationEvents() {

  document.addEventListener('change', async (evt) => {
    const vehicleSel = evt.target.closest('.vehicle-select');
    if (!vehicleSel) return;

    const jobId = vehicleSel.getAttribute('data-job');
    const legType = vehicleSel.getAttribute('data-type');
    const vehicleId = vehicleSel.value;

    if (!jobId || !legType) return;

    await allocateJobLeg(jobId, legType, vehicleId || null, null);
  });

  document.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.driver-action-btn');
    if (btn) {
      updateJobLegStatus(
        btn.getAttribute('data-job-id'),
        btn.getAttribute('data-leg-type'),
        btn.getAttribute('data-status')
      );
    }

    const editBtn = evt.target.closest('.open-job-items-btn');
    if (editBtn) {
      evt.preventDefault();
      openEditJob(editBtn.getAttribute('data-job-id'));
    }
  });

  document.getElementById('reloadDriversBtn')?.addEventListener('click', async () => {
    await refreshAllocationBoard();
  });

}


document.addEventListener('change', async (evt) => {

  const vehicleSel = evt.target.closest('.vehicle-select');
  if (!vehicleSel) return;

  const jobId = vehicleSel.getAttribute('data-job');
  const legType = vehicleSel.getAttribute('data-type');
  const vehicleId = vehicleSel.value;

  // prevent empty selection issues
  if (!jobId || !legType) return;

  await allocateJobLeg(
    jobId,
    legType,
    vehicleId || null,
    null // driver not used now
  );

});

document.addEventListener('click', (evt) => {

  // ✅ KEEP this for status buttons
  const btn = evt.target.closest('.driver-action-btn');
  if (btn) {
    updateJobLegStatus(
      btn.getAttribute('data-job-id'),
      btn.getAttribute('data-leg-type'),
      btn.getAttribute('data-status')
    );
  }

  // ✅ KEEP edit job working
  const editBtn = evt.target.closest('.open-job-items-btn');
  if (editBtn) {
    evt.preventDefault();
    openEditJob(editBtn.getAttribute('data-job-id'));
  }

});

// ✅ keep this for refresh
document.getElementById('reloadDriversBtn')?.addEventListener('click', async () => {
  await refreshAllocationBoard();
});

export async function refreshAllocationBoard() {
  await loadDrivers();     // keep for now
  await loadVehicles();    // ✅ new
  await loadJobs();
  renderAllocationBoard();
}

state.visibleJobs?.length && renderAllocationBoard();
