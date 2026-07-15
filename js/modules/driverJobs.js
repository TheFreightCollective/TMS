import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml, formatDateTime } from '../core/utils.js';
import { openProofModal } from './driverProof.js';

function showLoadingOverlay(message = 'Saving, please wait...') {
  const overlay = el('driverLoadingOverlay');
  if (!overlay) return;
  const card = overlay.querySelector('.driver-loading-card');
  if (card) card.textContent = message;
  overlay.classList.remove('hidden');
}

function hideLoadingOverlay() {
  el('driverLoadingOverlay')?.classList.add('hidden');
}

function setButtonLoadingState(button, loadingText = 'Processing...') {
  if (!button) return () => {};
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add('action-loading');
  button.textContent = loadingText;
  return () => {
    button.disabled = false;
    button.classList.remove('action-loading');
    button.textContent = originalText;
  };
}

function getDriverLegMap(allocations, vehicleIds) {
  const vehicleSet = new Set((vehicleIds || []).map(v => String(v)));
  const byJob = new Map();
  for (const alloc of allocations || []) {
    if (!alloc?.job_id || !alloc?.leg_type) continue;
    const jobKey = String(alloc.job_id);
    if (!byJob.has(jobKey)) {
      byJob.set(jobKey, {
        pickup: false,
        delivery: false,
        pickupStatus: null,
        deliveryStatus: null
      });
    }
    const bits = byJob.get(jobKey);
    if (alloc.leg_type === 'pickup') {
      const isMine = vehicleSet.has(String(alloc.vehicle_id));
      bits.pickup = bits.pickup || isMine;
      if (isMine && alloc.allocation_status) {
        bits.pickupStatus = alloc.allocation_status;
      } else if (!bits.pickupStatus && alloc.allocation_status) {
        bits.pickupStatus = alloc.allocation_status;
      }
    }
    if (alloc.leg_type === 'delivery') {
      const isMine = vehicleSet.has(String(alloc.vehicle_id));
      bits.delivery = bits.delivery || isMine;
      if (isMine && alloc.allocation_status) {
        bits.deliveryStatus = alloc.allocation_status;
      } else if (!bits.deliveryStatus && alloc.allocation_status) {
        bits.deliveryStatus = alloc.allocation_status;
      }
    }
  }
  return byJob;
}

async function fetchDriverJobRows(jobIds) {
  const ids = (jobIds || []).map(id => String(id)).filter(Boolean);
  if (!ids.length) return [];

  const viewRes = await sb
    .from('v_job_current_allocations')
    .select('*')
    .in('job_id', ids)
    .order('job_number', { ascending: false });

  if (!viewRes.error && (viewRes.data || []).length) {
    return viewRes.data || [];
  }

  const jobsRes = await sb
    .from('jobs')
    .select('id, job_number, customer_reference, customer_id, pickup_company_name, pickup_suburb, delivery_company_name, delivery_suburb, status, picked_up_at, delivered_at, accepted_at')
    .in('id', ids)
    .order('job_number', { ascending: false });

  if (jobsRes.error) {
    const msg = viewRes.error?.message || jobsRes.error.message;
    toast('Load jobs failed: ' + msg, true);
    return [];
  }

  const jobs = jobsRes.data || [];
  const customerIds = [...new Set(jobs.map(j => j.customer_id).filter(Boolean))];
  let customerNameById = new Map();

  if (customerIds.length) {
    const customerRes = await sb
      .from('customers')
      .select('id, company_name')
      .in('id', customerIds);

    if (!customerRes.error && (customerRes.data || []).length) {
      customerNameById = new Map((customerRes.data || []).map(c => [String(c.id), c.company_name || null]));
    }
  }

  return jobs.map(j => ({
    ...j,
    job_id: j.id,
    customer_name: customerNameById.get(String(j.customer_id)) || null,
    pickup_driver_name: null,
    delivery_driver_name: null
  }));
}

async function enrichDriverJobsWithDetails(jobs) {
  const rows = jobs || [];
  const jobIds = [...new Set(rows.map(job => String(job.job_id || job.id || '')).filter(Boolean))];
  if (!jobIds.length) return rows;

  const { data, error } = await sb
    .from('jobs')
    .select('id, customer_reference, pickup_company_name, pickup_contact_name, pickup_phone, pickup_address_text, pickup_suburb, pickup_state, pickup_postcode, delivery_company_name, delivery_contact_name, delivery_phone, delivery_address_text, delivery_suburb, delivery_state, delivery_postcode, pickup_date, delivery_date, sender_notes, receiver_notes, special_instructions, freight_description, pieces, pallets, total_weight_kg, total_cubic_m3')
    .in('id', jobIds);

  if (error) {
    toast('Load driver job details failed: ' + error.message, true);
    return rows;
  }

  const byId = new Map((data || []).map(job => [String(job.id), job]));
  return rows.map(job => {
    const details = byId.get(String(job.job_id || job.id)) || {};
    return {
      ...job,
      ...details,
      job_id: job.job_id || job.id || details.id,
      customer_reference: job.customer_reference || details.customer_reference || null,
      pickup_company_name: job.pickup_company_name || details.pickup_company_name || null,
      pickup_suburb: job.pickup_suburb || details.pickup_suburb || null,
      delivery_company_name: job.delivery_company_name || details.delivery_company_name || null,
      delivery_suburb: job.delivery_suburb || details.delivery_suburb || null
    };
  });
}

function dedupeAllocationsByJobAndLeg(allocations) {
  const unique = new Map();
  for (const alloc of allocations || []) {
    if (!alloc?.job_id || !alloc?.leg_type) continue;
    const key = `${String(alloc.job_id)}:${String(alloc.leg_type)}`;
    if (!unique.has(key)) unique.set(key, alloc);
  }
  return [...unique.values()];
}

function dedupeJobsById(jobs) {
  const unique = new Map();
  for (const job of jobs || []) {
    const jobKey = job?.job_id || job?.id;
    if (!jobKey) continue;
    const key = String(jobKey);
    if (!unique.has(key)) unique.set(key, { ...job, job_id: job?.job_id || job?.id });
  }
  return [...unique.values()];
}

function shouldShowJobForDriver(job) {
  const pickupStatus = (job._pickup_allocation_status || '').toLowerCase();
  const deliveryStatus = (job._delivery_allocation_status || '').toLowerCase();

  const pickupExists = pickupStatus !== '';
  const deliveryExists = deliveryStatus !== '';

  const ownsPickup = !!job._my_pickup_leg;
  const ownsDelivery = !!job._my_delivery_leg;

  // Driver should never see jobs where neither leg belongs to their current vehicle(s).
  if (!ownsPickup && !ownsDelivery) return false;

  // CASE A: pickup-only job disappears once pickup is completed.
  if (pickupExists && !deliveryExists && pickupStatus === 'picked_up') return false;

  // If driver only owns pickup leg and it's completed, remove from list.
  if (ownsPickup && !ownsDelivery && pickupStatus === 'picked_up') return false;

  // CASE B: pickup+delivery job remains until delivery is completed.
  if (deliveryExists && ownsDelivery && deliveryStatus === 'delivered') return false;

  return true;
}

async function resolveDriverIdFromAuthUser() {
  const authUserId = state.currentUser?.id || null;
  const auth = { uid: () => authUserId };
  console.log('authUserId', auth.uid());

  if (!authUserId) return null;

  const driverRes = await sb
    .from('drivers')
    .select('id')
    .eq('user_id', authUserId)
    .limit(1)
    .maybeSingle();

  if (driverRes.error) {
    toast('Load driver profile failed: ' + driverRes.error.message, true);
    return null;
  }

  const driverId = driverRes.data?.id || null;
  console.log('resolvedDriverId', driverId);
  return driverId;
}

export async function updateDriverLegStatus(jobId, legType, status){
  const resolvedJobId = String(jobId || '').trim();
  const resolvedLegType = String(legType || '').trim().toLowerCase();
  const resolvedStatus = String(status || '').trim().toLowerCase();
  const res = await sb.rpc('update_job_leg_status', {
    p_job_id: resolvedJobId,
    p_leg_type: resolvedLegType,
    p_status: resolvedStatus
  });
  console.log('update response', res);
  if(res.error){
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
        return false;
      }
    } else {
      toast('Status update failed: ' + res.error.message, true);
      return false;
    }
  }
  toast(resolvedLegType.charAt(0).toUpperCase() + resolvedLegType.slice(1) + ' status updated to ' + resolvedStatus, false);
  return true;
}

export async function loadDriverJobs(){
  if(!state.currentUser || !state.currentProfile){ state.visibleJobs=[]; renderDriverJobs([]); return; }

  const driverId = await resolveDriverIdFromAuthUser();
  if(!driverId){
    state.visibleJobs = [];
    renderDriverJobs([]);
    const statsEl = el('driverStats');
    if(statsEl) statsEl.textContent = '0 active job(s)';
    return;
  }

  const vehicleRes = await sb
    .from('vehicle_driver_assignments')
    .select('vehicle_id, assigned_from')
    .eq('driver_id', driverId)
    .eq('is_current', true);

  if(vehicleRes.error){
    toast('Load vehicles failed: ' + vehicleRes.error.message, true);
    return;
  }

  const vehicleIds = [...new Set((vehicleRes.data || []).map(r => String(r.vehicle_id)).filter(Boolean))];
  console.log('vehicleIds', vehicleIds);
  if(!vehicleIds.length){
    state.visibleJobs = [];
    renderDriverJobs([]);
    const statsEl = el('driverStats');
    if(statsEl) statsEl.textContent = '0 active job(s)';
    return;
  }

  const allocationRes = await sb
    .from('job_allocations')
    .select('job_id, leg_type, vehicle_id, allocation_status')
    .eq('is_current', true)
    .in('vehicle_id', vehicleIds)
    .in('leg_type', ['pickup', 'delivery']);

  if(allocationRes.error){
    toast('Load allocations failed: ' + allocationRes.error.message, true);
    return;
  }

  const myAllocations = dedupeAllocationsByJobAndLeg((allocationRes.data || []).filter(a => vehicleIds.includes(String(a.vehicle_id))));
  console.log('jobAllocations', myAllocations);
  const jobIds = [...new Set(myAllocations.map(r => String(r.job_id)).filter(Boolean))];
  console.log('jobIds', jobIds);
  if(!jobIds.length){
    state.visibleJobs = [];
    renderDriverJobs([]);
    const statsEl = el('driverStats');
    if(statsEl) statsEl.textContent = '0 active job(s)';
    return;
  }

  const jobs = await fetchDriverJobRows(jobIds);
  console.log('jobIds', jobIds);
  console.log('jobs from DB', jobs);

  const returnedJobIds = [...new Set(jobs.map(j => String(j.job_id || j.id)).filter(Boolean))];
  const missingJobIds = jobIds.filter(id => !returnedJobIds.includes(String(id)));
  console.log('jobIds vs jobs returned', {
    requestedCount: jobIds.length,
    returnedCount: returnedJobIds.length,
    missingJobIds
  });

  const allLegAllocRes = await sb
    .from('job_allocations')
    .select('job_id, leg_type, vehicle_id, allocation_status')
    .eq('is_current', true)
    .in('job_id', jobIds)
    .in('leg_type', ['pickup', 'delivery']);

  if (allLegAllocRes.error) {
    toast('Load leg allocations failed: ' + allLegAllocRes.error.message, true);
    return;
  }

  const allLegAllocations = dedupeAllocationsByJobAndLeg(allLegAllocRes.data || []);

  const legMap = getDriverLegMap(allLegAllocations, vehicleIds);

  const jobsById = new Map(
    dedupeJobsById(jobs).map(j => [String(j.job_id || j.id), j])
  );
  const jobsFetched = jobIds
    .map(id => jobsById.get(String(id)))
    .filter(Boolean)
    .map(j => {
      const myLegs = legMap.get(String(j.job_id || j.id)) || {
        pickup: false,
        delivery: false,
        pickupStatus: null,
        deliveryStatus: null
      };
      return {
        ...j,
        _my_pickup_leg: myLegs.pickup,
        _my_delivery_leg: myLegs.delivery,
        _pickup_allocation_status: myLegs.pickupStatus,
        _delivery_allocation_status: myLegs.deliveryStatus
      };
    })
    .filter(shouldShowJobForDriver);
  const detailedJobs = await enrichDriverJobsWithDetails(jobsFetched);
  console.log('jobsFetched', detailedJobs);

  state.visibleJobs = detailedJobs;
  console.log('finalVisibleJobs', state.visibleJobs);
  renderDriverJobs(state.visibleJobs);
  const statsEl = el('driverStats');
  if(statsEl) statsEl.textContent = state.visibleJobs.length + ' active job(s)';
}

function renderDriverLegNotice(job){
  const bits = [];
  if(job._my_pickup_leg) bits.push('You are assigned to pickup');
  if(job._my_delivery_leg) bits.push('You are assigned to delivery');
  return bits.length ? `<div class="chip">${escapeHtml(bits.join(' • '))}</div>` : '';
}

function renderDriverLegActions(job){
  let html = '';
  const pickupAllocationStatus = (job._pickup_allocation_status || '').toLowerCase();
  const deliveryAllocationStatus = (job._delivery_allocation_status || '').toLowerCase();

  if(job._my_pickup_leg){
    if (pickupAllocationStatus === 'pending_allocation' || pickupAllocationStatus === 'allocated') {
      html += `<button class="driver-action-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="pickup" data-status="accepted">Accept pickup</button>`;
    } else if (pickupAllocationStatus === 'accepted') {
      html += `<button class="driver-action-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="pickup" data-status="en_route_pickup">Start pickup</button>`;
    } else if (pickupAllocationStatus === 'en_route_pickup') {
      html += `<button class="open-proof-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="pickup">Complete pickup</button>`;
    }
  }

  if(job._my_delivery_leg){
    const pickupReadyForDelivery = pickupAllocationStatus === 'picked_up';
    if (pickupReadyForDelivery) {
      if (deliveryAllocationStatus === 'pending_allocation' || deliveryAllocationStatus === 'allocated') {
        html += `<button class="driver-action-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="delivery" data-status="accepted">Accept delivery</button>`;
      } else if (deliveryAllocationStatus === 'accepted') {
        html += `<button class="driver-action-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="delivery" data-status="en_route_delivery">Start delivery</button>`;
      } else if (deliveryAllocationStatus === 'en_route_delivery') {
        html += `<button class="open-proof-btn" data-job-id="${escapeHtml(job.job_id)}" data-leg-type="delivery">Complete delivery</button>`;
      }
    }
  }
  return html ? `<div class="stack">${html}</div>` : '';
}

function renderDriverSummaryBox(title, company, suburb) {
  return `<div class="leg-box"><div class="leg-box-title">${escapeHtml(title)}</div><div class="leg-box-company">${escapeHtml(company || '—')}</div><div class="muted">${escapeHtml(suburb || '—')}</div></div>`;
}

function detailValue(value) {
  return escapeHtml(value || '—');
}

function renderDriverJobDetails(job) {
  return `
    <div class="driver-job-detail-meta">
      <div><span class="muted driver-detail-label">Customer</span><div class="driver-detail-value">${detailValue(job.customer_name)}</div></div>
      <div><span class="muted driver-detail-label">Reference</span><div class="driver-detail-value">${detailValue(job.customer_reference)}</div></div>
      <div><span class="muted driver-detail-label">Pickup date</span><div class="driver-detail-value">${detailValue(formatDateTime(job.pickup_date))}</div></div>
      <div><span class="muted driver-detail-label">Delivery date</span><div class="driver-detail-value">${detailValue(formatDateTime(job.delivery_date))}</div></div>
    </div>
    <div class="driver-job-detail-grid">
      <section class="driver-job-detail-card">
        <h3>Pickup</h3>
        <div class="driver-job-detail-fields">
          <div><span class="muted driver-detail-label">Business</span><div class="driver-detail-value">${detailValue(job.pickup_company_name)}</div></div>
          <div><span class="muted driver-detail-label">Contact</span><div class="driver-detail-value">${detailValue(job.pickup_contact_name)}</div></div>
          <div><span class="muted driver-detail-label">Phone</span><div class="driver-detail-value">${detailValue(job.pickup_phone)}</div></div>
          <div><span class="muted driver-detail-label">Address</span><div class="driver-detail-value">${detailValue(job.pickup_address_text)}</div></div>
          <div><span class="muted driver-detail-label">Suburb</span><div class="driver-detail-value">${detailValue(job.pickup_suburb)}</div></div>
          <div><span class="muted driver-detail-label">State</span><div class="driver-detail-value">${detailValue(job.pickup_state)}</div></div>
          <div><span class="muted driver-detail-label">Postcode</span><div class="driver-detail-value">${detailValue(job.pickup_postcode)}</div></div>
          <div><span class="muted driver-detail-label">Instructions</span><div class="driver-detail-value">${detailValue(job.sender_notes || job.special_instructions)}</div></div>
        </div>
      </section>
      <section class="driver-job-detail-card">
        <h3>Delivery</h3>
        <div class="driver-job-detail-fields">
          <div><span class="muted driver-detail-label">Business</span><div class="driver-detail-value">${detailValue(job.delivery_company_name)}</div></div>
          <div><span class="muted driver-detail-label">Contact</span><div class="driver-detail-value">${detailValue(job.delivery_contact_name)}</div></div>
          <div><span class="muted driver-detail-label">Phone</span><div class="driver-detail-value">${detailValue(job.delivery_phone)}</div></div>
          <div><span class="muted driver-detail-label">Address</span><div class="driver-detail-value">${detailValue(job.delivery_address_text)}</div></div>
          <div><span class="muted driver-detail-label">Suburb</span><div class="driver-detail-value">${detailValue(job.delivery_suburb)}</div></div>
          <div><span class="muted driver-detail-label">State</span><div class="driver-detail-value">${detailValue(job.delivery_state)}</div></div>
          <div><span class="muted driver-detail-label">Postcode</span><div class="driver-detail-value">${detailValue(job.delivery_postcode)}</div></div>
          <div><span class="muted driver-detail-label">Instructions</span><div class="driver-detail-value">${detailValue(job.receiver_notes || job.special_instructions)}</div></div>
        </div>
      </section>
    </div>
    <div class="driver-job-detail-meta driver-job-detail-footer">
      <div><span class="muted driver-detail-label">Freight</span><div class="driver-detail-value">${detailValue(job.freight_description)}</div></div>
      <div><span class="muted driver-detail-label">Pieces</span><div class="driver-detail-value">${detailValue(job.pieces)}</div></div>
      <div><span class="muted driver-detail-label">Pallets</span><div class="driver-detail-value">${detailValue(job.pallets)}</div></div>
      <div><span class="muted driver-detail-label">Weight</span><div class="driver-detail-value">${detailValue(job.total_weight_kg ? `${Number(job.total_weight_kg).toFixed(0)} kg` : '—')}</div></div>
    </div>
  `;
}

function openDriverJobModal(job) {
  const modal = el('driverJobModal');
  const title = el('driverJobModalTitle');
  const sub = el('driverJobModalSub');
  const content = el('driverJobModalContent');
  if (!modal || !title || !sub || !content || !job) return;
  title.textContent = `Job #${job.job_number || ''}`;
  sub.textContent = `${job.customer_name || 'Customer'}${job.customer_reference ? ` • Ref: ${job.customer_reference}` : ''}`;
  content.innerHTML = renderDriverJobDetails(job);
  modal.classList.remove('hidden');
}

function closeDriverJobModal() {
  el('driverJobModal')?.classList.add('hidden');
}

export function renderDriverJobs(jobs){
  const root = el('jobs');
  if(!root) return;
  if(!jobs || !jobs.length){ root.innerHTML = '<div class="muted">No jobs visible.</div>'; return; }
  root.innerHTML = jobs.map(job => `<div class="job-card" data-job-id="${escapeHtml(job.job_id)}" role="button" tabindex="0"><div><h3>Job #${escapeHtml(job.job_number || '')}</h3><div class="muted">Customer: ${escapeHtml(job.customer_name || '—')}<br>Ref: ${escapeHtml(job.customer_reference || '—')}</div></div>${renderDriverLegNotice(job)}<div class="driver-route-grid">${renderDriverSummaryBox('Pickup', job.pickup_company_name, job.pickup_suburb)}${renderDriverSummaryBox('Delivery', job.delivery_company_name, job.delivery_suburb)}</div><div class="driver-card-hint muted">Tap this card to view full pickup and delivery details.</div>${renderDriverLegActions(job)}</div>`).join('');
}

export function bindDriverJobEvents(){
  el('refreshJobsBtnDriver')?.addEventListener('click', loadDriverJobs);
  el('closeDriverJobModalBtn')?.addEventListener('click', closeDriverJobModal);
  document.addEventListener('click', async function(evt){
    const actionBtn = evt.target.closest('.driver-action-btn');
    if(actionBtn){
      if (actionBtn.disabled) return;
      const jobId = actionBtn.getAttribute('data-job-id');
      const legType = actionBtn.getAttribute('data-leg-type');
      const status = actionBtn.getAttribute('data-status');

      console.log('before update', { jobId, status });

      if (legType === 'pickup') {
        console.log('Updating pickup status', { jobId, status });
      }

      const restore = setButtonLoadingState(actionBtn, 'Processing...');
      showLoadingOverlay('Saving, please wait...');
      try {
        const ok = await updateDriverLegStatus(jobId, legType, status);
        if(ok) {
          await loadDriverJobs();
          console.log('after reload jobs', state.visibleJobs);
          return;
        }
      } finally {
        hideLoadingOverlay();
        restore();
      }
      return;
    }
    const card = evt.target.closest('.job-card');
    if(card && !evt.target.closest('.driver-action-btn, .open-proof-btn, button, a, input, select, textarea')){
      const jobId = card.getAttribute('data-job-id');
      const job = state.visibleJobs.find(j => String(j.job_id) === String(jobId));
      if (job) openDriverJobModal(job);
      return;
    }
    const proofBtn = evt.target.closest('.open-proof-btn');
    if(proofBtn){
      if (proofBtn.disabled) return;
      const restore = setButtonLoadingState(proofBtn, 'Processing...');
      showLoadingOverlay('Saving, please wait...');
      const jobId = proofBtn.getAttribute('data-job-id');
      const legType = proofBtn.getAttribute('data-leg-type');
      const job = state.visibleJobs.find(j => String(j.job_id) === String(jobId));
      try {
        if(job) openProofModal(job, legType);
      } finally {
        hideLoadingOverlay();
        restore();
      }
    }
  });
  document.addEventListener('keydown', function(evt){
    const card = evt.target.closest('.job-card');
    if(!card) return;
    if(evt.key !== 'Enter' && evt.key !== ' ') return;
    evt.preventDefault();
    const jobId = card.getAttribute('data-job-id');
    const job = state.visibleJobs.find(j => String(j.job_id) === String(jobId));
    if (job) openDriverJobModal(job);
  });
}
