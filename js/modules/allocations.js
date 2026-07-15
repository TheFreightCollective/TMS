import { sb } from '../core/supabaseClient.js';
import { el, toast, escapeHtml } from '../core/utils.js';
import { loadJobs, getJobStatus } from './jobs.js';
import { loadDrivers } from './drivers.js';
import { state } from '../core/state.js';
import { openEditJob } from './editJob.js';
import { loadVehicles } from './vehicles.js';

let allocationEventsBound = false;
const splitDeliveryStateByJob = new Map();

function setButtonLoading(btn, isLoading, originalText) {
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = 'Refreshing...';
    return;
  }

  btn.disabled = false;
  btn.classList.remove('is-loading');
  if (originalText != null) btn.textContent = originalText;
}

function setSplitDeliveryState(jobId, isSplit) {
  const key = String(jobId || '');
  if (!key) return;
  splitDeliveryStateByJob.set(key, !!isSplit);

  const job = (state.visibleJobs || []).find(j => String(j.job_id) === key);
  if (job) job._split_delivery = !!isSplit;
}

function getSplitDeliveryState(job) {
  const key = String(job?.job_id || '');
  if (!key) return false;

  if (splitDeliveryStateByJob.has(key)) {
    const explicit = splitDeliveryStateByJob.get(key) === true;
    job._split_delivery = explicit;
    return explicit;
  }

  // Initialize state for jobs not yet interacted with.
  const inferred = !!(
    job.pickup_vehicle_id &&
    job.delivery_vehicle_id &&
    String(job.pickup_vehicle_id) !== String(job.delivery_vehicle_id)
  );
  splitDeliveryStateByJob.set(key, inferred);
  job._split_delivery = inferred;
  return inferred;
}

async function rpcAllocateJobLeg(jobId, legType, vehicleId, driverId = null) {
  const rpcResult = await sb.rpc('allocate_job_leg', {
    p_job_id: jobId,
    p_leg_type: legType,
    p_driver_id: driverId || null,
    p_vehicle_id: vehicleId || null,
    p_notes: null
  });

  // Backward-compat fallback for databases where the RPC still references a removed created_at column.
  if (!rpcResult.error) return rpcResult;

  const errMsg = String(rpcResult.error?.message || '').toLowerCase();
  const missingCreatedAt = errMsg.includes('created_at') && errMsg.includes('job_allocations');
  if (!missingCreatedAt) return rpcResult;

  const deactivateRes = await sb
    .from('job_allocations')
    .update({
      is_current: false
    })
    .eq('job_id', jobId)
    .eq('leg_type', legType)
    .eq('is_current', true);

  if (deactivateRes.error) {
    return { error: deactivateRes.error };
  }

  const insertRes = await sb
    .from('job_allocations')
    .insert([{
      job_id: jobId,
      leg_type: legType,
      driver_id: driverId || null,
      vehicle_id: vehicleId || null,
      allocation_status: 'allocated',
      is_current: true,
      allocated_at: new Date().toISOString()
    }]);

  if (insertRes.error) {
    return { error: insertRes.error };
  }

  return { data: { fallback: true }, error: null };
}

function vehicleOptionsMarkup(selectedVehicleId) {
  const selectedId = selectedVehicleId == null ? '' : String(selectedVehicleId);
  return ['<option value="">Select vehicle...</option>']
    .concat(
      (state.vehicleOptions || []).map(v => {
        const optionId = v?.id == null ? '' : String(v.id);
        return `<option value="${escapeHtml(v.id)}" ${selectedId === optionId ? 'selected' : ''}>${escapeHtml(v.vehicle_name || v.rego || 'Vehicle')}</option>`;
      })
    ).join('');
}

export async function allocateJobLeg(jobId, legType, vehicleId, driverId = null) {
  const res = await rpcAllocateJobLeg(jobId, legType, vehicleId, driverId);

  if (res.error) {
    toast('Allocation failed: ' + res.error.message, true);
    return;
  }

  toast(`${legType} vehicle assigned`);

  await loadJobs();
  renderAllocationBoard();
}

async function allocateBothLegs(jobId, vehicleId, driverId = null) {
  const pickupRes = await rpcAllocateJobLeg(jobId, 'pickup', vehicleId, driverId);
  if (pickupRes.error) {
    toast('Allocation failed: ' + pickupRes.error.message, true);
    return;
  }

  const deliveryRes = await rpcAllocateJobLeg(jobId, 'delivery', vehicleId, driverId);
  if (deliveryRes.error) {
    toast('Allocation failed: ' + deliveryRes.error.message, true);
    return;
  }

  toast('Pickup and delivery vehicles assigned');
  await loadJobs();
  renderAllocationBoard();
}




export async function updateJobLegStatus(jobId, legType, status) {
  const resolvedJobId = String(jobId || '').trim();
  const resolvedLegType = String(legType || '').trim().toLowerCase();
  const resolvedStatus = String(status || '').trim().toLowerCase();

  const res = await sb.rpc('update_job_leg_status', {
    p_job_id: resolvedJobId,
    p_leg_type: resolvedLegType,
    p_status: resolvedStatus
  });

  if (res.error) {
    const errMsg = String(res.error?.message || '').toLowerCase();
    const missingCreatedAt = errMsg.includes('created_at') && errMsg.includes('job_allocations');

    if (missingCreatedAt) {
      const fallbackRes = await sb
        .from('job_allocations')
        .update({ allocation_status: resolvedStatus })
        .eq('job_id', resolvedJobId)
        .eq('leg_type', resolvedLegType)
        .eq('is_current', true);

      if (fallbackRes.error) {
        toast('Status update failed: ' + fallbackRes.error.message, true);
        return;
      }
    } else {
      toast('Status update failed: ' + res.error.message, true);
      return;
    }
  }

  toast(`${resolvedLegType.charAt(0).toUpperCase() + resolvedLegType.slice(1)} status updated to ${resolvedStatus}`);
  await loadJobs();
  renderAllocationBoard();
}

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

  root.innerHTML = jobs.map(job => {
    const splitEnabled = getSplitDeliveryState(job);
    return `
    <div class="allocation-card">
      <div class="allocation-card-header">
        <button type="button" class="inline-link open-job-items-btn" data-job-id="${escapeHtml(job.job_id)}">
          #${escapeHtml(job.job_number || '')}
        </button>
        <div class="allocation-header-right">
          <div class="split-delivery-control">
            <input
              type="checkbox"
              id="split-${escapeHtml(job.job_id)}"
              class="split-delivery-toggle"
              data-job="${escapeHtml(job.job_id)}"
              ${splitEnabled ? 'checked' : ''}
            />
            <label for="split-${escapeHtml(job.job_id)}">Split delivery</label>
          </div>
        </div>
      </div>

      <span class="chip ${getJobStatus(job)}">
        ${getJobStatus(job).replace(/_/g, ' ')}
      </span>

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

        <div class="single-vehicle-wrap" style="${splitEnabled ? 'display:none;' : ''}">
          <label class="muted" style="font-size:11px;">Vehicle</label>
          <select data-job="${job.job_id}" class="vehicle-select-single">
            ${vehicleOptionsMarkup(job.pickup_vehicle_id || job.delivery_vehicle_id || null)}
          </select>
        </div>

        <div class="split-vehicle-wrap" style="${splitEnabled ? '' : 'display:none;'}">

        <div>
          <label class="muted" style="font-size:11px;">Pickup vehicle</label>
          <select data-job="${job.job_id}" data-type="pickup" class="vehicle-select">
            ${vehicleOptionsMarkup(job.pickup_vehicle_id || null)}
          </select>
        </div>

        <div>
          <label class="muted" style="font-size:11px;">Delivery vehicle</label>
          <select data-job="${job.job_id}" data-type="delivery" class="vehicle-select">
            ${vehicleOptionsMarkup(job.delivery_vehicle_id || null)}
          </select>
        </div>

        </div>

      </div>
    </div>
  `;
  }).join('');
}


export function bindAllocationEvents() {
  if (allocationEventsBound) return;
  allocationEventsBound = true;

  document.addEventListener('change', async (evt) => {
    const splitToggle = evt.target.closest('.split-delivery-toggle');
    if (splitToggle) {
      const jobId = splitToggle.getAttribute('data-job');
      const card = splitToggle.closest('.allocation-card');
      if (!jobId || !card) return;

      setSplitDeliveryState(jobId, splitToggle.checked);

      const singleWrap = card.querySelector('.single-vehicle-wrap');
      const splitWrap = card.querySelector('.split-vehicle-wrap');
      const pickupSelect = card.querySelector('.vehicle-select[data-type="pickup"]');
      const deliverySelect = card.querySelector('.vehicle-select[data-type="delivery"]');
      const singleSelect = card.querySelector('.vehicle-select-single');

      if (splitToggle.checked) {
        if (singleWrap) singleWrap.style.display = 'none';
        if (splitWrap) splitWrap.style.display = '';
        return;
      }

      if (singleWrap) singleWrap.style.display = '';
      if (splitWrap) splitWrap.style.display = 'none';

      const syncVehicleId = pickupSelect?.value || singleSelect?.value || deliverySelect?.value || '';
      if (singleSelect) singleSelect.value = syncVehicleId;
      if (pickupSelect) pickupSelect.value = syncVehicleId;
      if (deliverySelect) deliverySelect.value = syncVehicleId;

      if (syncVehicleId) {
        await allocateBothLegs(jobId, syncVehicleId, null);
      }
      return;
    }

    const singleVehicleSel = evt.target.closest('.vehicle-select-single');
    if (singleVehicleSel) {
      const jobId = singleVehicleSel.getAttribute('data-job');
      const vehicleId = singleVehicleSel.value || null;
      if (!jobId || !vehicleId) return;
      await allocateBothLegs(jobId, vehicleId, null);
      return;
    }

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

  document.getElementById('reloadDriversBtn')?.addEventListener('click', async (evt) => {
    const btn = evt.currentTarget;
    if (!btn) return;
    const originalText = btn.textContent;

    setButtonLoading(btn, true);

    try {
      await refreshAllocationBoard();
    } catch (err) {
      console.error('Refresh board failed:', err);
    } finally {
      setButtonLoading(btn, false, originalText || 'Refresh board');
    }
  });

}

export async function refreshAllocationBoard() {
  await loadDrivers();     // keep for now
  await loadVehicles();    // ✅ new
  await loadJobs();
  renderAllocationBoard();
}

state.visibleJobs?.length && renderAllocationBoard();
