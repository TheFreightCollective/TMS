import { sb } from '../core/supabaseClient.js';
import { updateDashboardStats } from '../modules/nav.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml, formatDateTime, combineDateTime } from '../core/utils.js';
import { getBookingItemsForSave, validateBookingItems, calculateBookingTotals } from './freightItems.js';
import { showJobCreatedModal } from './ui.js';
import { loadAllAddresses, initAddressDropdowns } from './addresses.js';
import { resetCreateBookingForm } from './bookingFormReset.js';

let jobVehicleBindingInitialized = false;
let bookingSubmitBindingInitialized = false;

function getJobProgress(job) {
  if (job?.delivered_at) return 'delivered';
  if (job?.picked_up_at) return 'picked_up';
  if (job?.accepted_at) return 'accepted';
  return 'pending';
}

export function getJobStatus(job){
  const progress = getJobProgress(job);
  const status = String(job?.status || '').toLowerCase();
  if (progress === 'delivered' || status === 'delivered') return 'completed';
  if (['accepted', 'picked_up'].includes(progress) || ['accepted', 'en_route_delivery', 'en_route_pickup', 'in_progress'].includes(status)) return 'in_progress';
  if (!job?.pickup_driver_id || !job?.delivery_driver_id) return 'pending_allocation';
  if (status === 'allocated') return 'allocated';
  return 'allocated';
}

async function enrichJobsWithAddressDetails(jobs){
  const rows = jobs || [];
  const jobIds = [...new Set(rows.map(job => job.job_id || job.id).filter(Boolean))];
  if (!jobIds.length) return rows;

  const { data: jobRows, error: jobError } = await sb
    .from('jobs')
    .select('id, pickup_address_id, delivery_address_id, pickup_company_name, pickup_contact_name, pickup_phone, pickup_address_text, pickup_suburb, pickup_state, pickup_postcode, pickup_lat, pickup_lng, delivery_company_name, delivery_contact_name, delivery_phone, delivery_address_text, delivery_suburb, delivery_state, delivery_postcode, delivery_lat, delivery_lng, sender_notes, receiver_notes')
    .in('id', jobIds);

  if (jobError || !jobRows?.length) return rows;

  const jobMap = new Map(jobRows.map(job => [job.id, job]));

  return rows.map(job => {
    const baseJob = jobMap.get(job.job_id || job.id) || {};

    return {
      ...job,
      pickup_address_id: job.pickup_address_id || baseJob.pickup_address_id || null,
      delivery_address_id: job.delivery_address_id || baseJob.delivery_address_id || null,
      pickup_company_name: job.pickup_company_name || baseJob.pickup_company_name || null,
      pickup_contact_name: job.pickup_contact_name || baseJob.pickup_contact_name || null,
      pickup_phone: job.pickup_phone || baseJob.pickup_phone || null,
      pickup_address_text: job.pickup_address_text || baseJob.pickup_address_text || null,
      pickup_suburb: job.pickup_suburb || baseJob.pickup_suburb || null,
      pickup_state: job.pickup_state || baseJob.pickup_state || null,
      pickup_postcode: job.pickup_postcode || baseJob.pickup_postcode || null,
      pickup_lat: job.pickup_lat || baseJob.pickup_lat || null,
      pickup_lng: job.pickup_lng || baseJob.pickup_lng || null,
      delivery_company_name: job.delivery_company_name || baseJob.delivery_company_name || null,
      delivery_contact_name: job.delivery_contact_name || baseJob.delivery_contact_name || null,
      delivery_phone: job.delivery_phone || baseJob.delivery_phone || null,
      delivery_address_text: job.delivery_address_text || baseJob.delivery_address_text || null,
      delivery_suburb: job.delivery_suburb || baseJob.delivery_suburb || null,
      delivery_state: job.delivery_state || baseJob.delivery_state || null,
      delivery_postcode: job.delivery_postcode || baseJob.delivery_postcode || null,
      delivery_lat: job.delivery_lat || baseJob.delivery_lat || null,
      delivery_lng: job.delivery_lng || baseJob.delivery_lng || null,
      sender_notes: job.sender_notes || baseJob.sender_notes || null,
      receiver_notes: job.receiver_notes || baseJob.receiver_notes || null
    };
  });
}

async function enrichJobsWithVehicleAllocations(jobs) {
  const rows = jobs || [];
  const jobIds = [...new Set(rows.map(job => job.job_id || job.id).filter(Boolean))];
  if (!jobIds.length) return rows;

  const { data: allocations, error } = await sb
    .from('job_allocations')
    .select('job_id, leg_type, vehicle_id, driver_id, is_current')
    .in('job_id', jobIds)
    .eq('is_current', true)
    .in('leg_type', ['pickup', 'delivery']);

  if (error || !allocations?.length) {
    return rows.map(job => ({
      ...job,
      pickup_vehicle_id: job.pickup_vehicle_id ?? null,
      delivery_vehicle_id: job.delivery_vehicle_id ?? null
    }));
  }

  const byJob = new Map();
  for (const alloc of allocations) {
    const jobId = alloc.job_id;
    if (!byJob.has(jobId)) byJob.set(jobId, {});
    const current = byJob.get(jobId);
    if (alloc.leg_type === 'pickup' && current.pickup_vehicle_id == null) {
      current.pickup_vehicle_id = alloc.vehicle_id ?? null;
    }
    if (alloc.leg_type === 'delivery' && current.delivery_vehicle_id == null) {
      current.delivery_vehicle_id = alloc.vehicle_id ?? null;
    }
  }

  return rows.map(job => {
    const jobId = job.job_id || job.id;
    const vehicleAlloc = byJob.get(jobId) || {};
    return {
      ...job,
      pickup_vehicle_id: job.pickup_vehicle_id ?? vehicleAlloc.pickup_vehicle_id ?? null,
      delivery_vehicle_id: job.delivery_vehicle_id ?? vehicleAlloc.delivery_vehicle_id ?? null
    };
  });
}

export async function loadJobs(){ let data=null,error=null; if(!state.currentUser||!state.currentProfile){state.visibleJobs=[]; renderJobs([]); return;} if(state.currentProfile.role==='customer'){ if(!state.currentCustomerId){toast('Customer not linked correctly',true); state.visibleJobs=[]; renderJobs([]); return;} const jobsRes=await sb.from('jobs').select('id').eq('customer_id',state.currentCustomerId); if(jobsRes.error){toast('Load jobs failed: '+jobsRes.error.message,true);return;} const ids=(jobsRes.data||[]).map(r=>r.id); if(!ids.length){state.visibleJobs=[];renderJobs([]);return;} const res=await sb.from('v_job_current_allocations').select('*').in('job_id',ids).order('job_number',{ascending:false}); data=res.data; error=res.error; } else { const res=await sb.from('v_job_current_allocations').select('*').order('job_number',{ascending:false}); data=res.data; error=res.error; } if(state.currentProfile.role==='driver'&&state.currentDriver?.id){ data=(data||[]).filter(j=>{ const progress=getJobProgress(j); return (j.pickup_driver_id===state.currentDriver.id&&['pending','accepted'].includes(progress))||(j.delivery_driver_id===state.currentDriver.id&&progress==='picked_up'); }); } if(error){toast('Load jobs failed: '+error.message,true);return;} const withVehicleAllocations=await enrichJobsWithVehicleAllocations(data||[]); const enriched=await enrichJobsWithAddressDetails(withVehicleAllocations); state.visibleJobs=enriched; updateDashboardStats(state.visibleJobs); applyFilters(); }
export function applyFilters(){ let filtered=state.visibleJobs||[]; if(state.currentFilter==='unallocated')filtered=filtered.filter(job=>!job.pickup_driver_id||!job.delivery_driver_id); if(state.currentFilter==='allocated')filtered=filtered.filter(job=>{ const progress=getJobProgress(job); const status=String(job?.status||'').toLowerCase(); return job.pickup_driver_id&&job.delivery_driver_id&&progress==='pending'&&!['in_progress','delivered','completed'].includes(status); }); if(state.currentFilter==='in_progress')filtered=filtered.filter(job=>{ const progress=getJobProgress(job); const status=String(job?.status||'').toLowerCase(); return ['accepted','picked_up'].includes(progress)||['accepted','en_route_delivery','en_route_pickup','in_progress'].includes(status); }); if(state.currentFilter==='completed')filtered=filtered.filter(job=>{ const progress=getJobProgress(job); const status=String(job?.status||'').toLowerCase(); return progress==='delivered'||['delivered','completed','complete'].includes(status); }); renderJobs(filtered); }
export function renderJobs(jobs){
  const root=el('jobs'); if(!root)return;
  const role=state.currentProfile?.role||null;
  const isOpsAdmin=['admin','ops'].includes(role);
  if(!jobs?.length){root.innerHTML=`<tr><td colspan="15" class="muted">No jobs visible.</td></tr>`;return;}
  root.innerHTML=jobs.map(job=>{
    const status=getJobStatus(job);
    const progress=getJobProgress(job);
    const hasProof=status==='completed'||progress==='picked_up'||progress==='delivered';
    const podBtn=isOpsAdmin&&hasProof?`<button type="button" class="secondary small open-pod-btn" data-job-id="${escapeHtml(job.job_id)}" style="margin-left:4px;">POD</button>`:'';
    return `<tr><td><button type="button" class="inline-link open-job-items-btn" data-job-id="${escapeHtml(job.job_id)}">#${escapeHtml(job.job_number||'')}</button></td><td>${escapeHtml(job.customer_name||'—')}</td><td>${escapeHtml(job.customer_reference || '—')}</td><td>${escapeHtml(job.pickup_company_name || job.pickup_company || '—')}</td><td>${escapeHtml(job.pickup_suburb || '—')}</td><td>${escapeHtml(job.delivery_company_name || job.delivery_company || '—')}</td><td>${escapeHtml(job.delivery_suburb || '—')}</td><td>${formatDateTime(job.pickup_date)}</td><td>${formatDateTime(job.delivery_date)}</td><td>${Number(job.total_weight_kg||0).toFixed(0)} kg</td><td>${Number(job.total_cubic_m3||0).toFixed(3)} m³</td><td><span class="chip ${status}">${status.replace(/_/g,' ')}</span></td><td><select data-job="${job.job_id}" data-type="pickup" class="job-vehicle-select">${vehicleOptionsMarkup(job.pickup_vehicle_id)}</select></td><td><select data-job="${job.job_id}" data-type="delivery" class="job-vehicle-select">${vehicleOptionsMarkup(job.delivery_vehicle_id)}</select></td><td style="text-align:right;white-space:nowrap;">${podBtn}</td></tr>`;
  }).join('');
}

function vehicleOptionsMarkup(selectedVehicleId){
  const selectedId = selectedVehicleId == null ? '' : String(selectedVehicleId);
  return ['<option value="">Select vehicle...</option>']
    .concat(
      (state.vehicleOptions || []).map(v => {
        const optionId = v?.id == null ? '' : String(v.id);
        return `<option value="${escapeHtml(v.id)}" ${selectedId === optionId ? 'selected' : ''}>${escapeHtml(v.vehicle_name || v.rego || 'Vehicle')}</option>`;
      })
    ).join('');
}

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

async function createAddressFromBooking(prefix, customerId, addressType) {
  const company = el(`${prefix}Company`)?.value?.trim();
  const addressLine = el(`${prefix}AddressLine`)?.value?.trim();
  const suburb = el(`${prefix}Suburb`)?.value?.trim();
  const stateVal = el(`${prefix}State`)?.value?.trim();
  const postcode = el(`${prefix}Postcode`)?.value?.trim();

  if (!company && !addressLine && !suburb && !stateVal && !postcode) return null;

  const payload = {
    company_name: company || null,
    contact_name: el(`${prefix}-contact`)?.value?.trim() || null,
    contact_phone: el(`${prefix}-phone`)?.value?.trim() || null,
    address_line: addressLine || null,
    suburb: suburb || null,
    state: stateVal || null,
    postcode: postcode || null,
    address_type: addressType || 'both',
    customer_id: customerId,
    created_by_user_id: state.currentUser.id
  };

  const res = await sb
    .from('addresses')
    .insert([payload])
    .select('id, company_name, contact_name, contact_phone, address_line, suburb, state, postcode')
    .single();
  if (res.error) {
    toast('Could not save address: ' + res.error.message, true);
    return null;
  }

  return res.data || null;
}

async function resolveLegAddressAndSnapshot(prefix, selectedId, customerId, addressType, defaultAddressType) {
  let addr = (state.allAddresses || []).find(a => String(a.id) === String(selectedId));
  if (!addr && selectedId) {
    const lookup = await sb
      .from('addresses')
      .select('id, company_name, contact_name, contact_phone, address_line, suburb, state, postcode')
      .eq('id', selectedId)
      .maybeSingle();
    if (lookup.error) {
      toast('Could not load selected address: ' + lookup.error.message, true);
    }
    addr = lookup.data || null;
  }

  if (!addr) {
    const inserted = await createAddressFromBooking(prefix, customerId, addressType || defaultAddressType);
    if (inserted) {
      addr = inserted;
      if (!state.allAddresses.some(a => String(a.id) === String(inserted.id))) {
        state.allAddresses.push(inserted);
      }
    }
  }

  const formCompany = el(`${prefix}Company`)?.value?.trim();
  const formContact = el(`${prefix}-contact`)?.value?.trim();
  const formPhone = el(`${prefix}-phone`)?.value?.trim();
  const formLine = el(`${prefix}AddressLine`)?.value?.trim();
  const formSuburb = el(`${prefix}Suburb`)?.value?.trim();
  const formState = el(`${prefix}State`)?.value?.trim();
  const formPostcode = el(`${prefix}Postcode`)?.value?.trim();

  return {
    addressId: addr?.id || null,
    snapshot: {
      company_name: addr?.company_name || formCompany || null,
      contact_name: addr?.contact_name || formContact || null,
      phone: addr?.contact_phone || formPhone || null,
      address_text: addr?.address_line || formLine || null,
      suburb: addr?.suburb || formSuburb || null,
      state: addr?.state || formState || null,
      postcode: addr?.postcode || formPostcode || null,
      lat: null,
      lng: null
    }
  };
}

export async function createJob() {
  if (!state.currentUser) { toast('You must be logged in to create a job', true); return; }
  if (!state.currentProfile) { toast('Login first.', true); return; }
  if (!['customer', 'admin', 'ops'].includes(state.currentProfile.role)) { toast('Invalid role', true); return; }

  let customerId = state.currentProfile.role === 'customer' ? state.currentCustomerId : el('customerSelect')?.value;
  if (!customerId) { toast(state.currentProfile.role === 'customer' ? 'Customer not linked correctly' : 'Please select a customer', true); return; }

  const itemsToSave = getBookingItemsForSave();
  if (!validateBookingItems(itemsToSave)) return;

  const totals = calculateBookingTotals();
  const pickupAddressId = el('pickupAddressSelect')?.value || null;
  const deliveryAddressId = el('deliveryAddressSelect')?.value || null;
  const pickupSavedType = document.querySelector('input[name="pickupSaveType"]:checked')?.value || 'pickup';
  const deliverySavedType = document.querySelector('input[name="deliverySaveType"]:checked')?.value || 'delivery';
  const pickupAddressType = el('pickupSaveToBook')?.checked ? pickupSavedType : 'unsaved_pickup';
  const deliveryAddressType = el('deliverySaveToBook')?.checked ? deliverySavedType : 'unsaved_delivery';
  const pickupLeg = await resolveLegAddressAndSnapshot('pickup', pickupAddressId, customerId, pickupAddressType, 'pickup');
  const deliveryLeg = await resolveLegAddressAndSnapshot('delivery', deliveryAddressId, customerId, deliveryAddressType, 'delivery');

  const payload = {customer_id:customerId,source:'ops_portal',created_by:state.currentUser.id,customer_reference:el('customerRef').value.trim()||null,pickup_address_id:pickupLeg.addressId,pickup_company_name:pickupLeg.snapshot.company_name,pickup_contact_name:pickupLeg.snapshot.contact_name,pickup_phone:pickupLeg.snapshot.phone,pickup_address_text:pickupLeg.snapshot.address_text,pickup_suburb:pickupLeg.snapshot.suburb,pickup_state:pickupLeg.snapshot.state,pickup_postcode:pickupLeg.snapshot.postcode,pickup_lat:pickupLeg.snapshot.lat,pickup_lng:pickupLeg.snapshot.lng,delivery_address_id:deliveryLeg.addressId,delivery_company_name:deliveryLeg.snapshot.company_name,delivery_contact_name:deliveryLeg.snapshot.contact_name,delivery_phone:deliveryLeg.snapshot.phone,delivery_address_text:deliveryLeg.snapshot.address_text,delivery_suburb:deliveryLeg.snapshot.suburb,delivery_state:deliveryLeg.snapshot.state,delivery_postcode:deliveryLeg.snapshot.postcode,delivery_lat:deliveryLeg.snapshot.lat,delivery_lng:deliveryLeg.snapshot.lng,status:'pending_allocation',pickup_date:combineDateTime(el('pickupDate')?.value,el('pickupTime')?.value),delivery_date:combineDateTime(el('deliveryDate')?.value,el('deliveryTime')?.value),sender_notes:el('senderNotes')?.value.trim()||null,receiver_notes:el('receiverNotes')?.value.trim()||null,total_weight_kg:totals.totalWeight,total_cubic_m3:totals.totalCubic}; console.log('FINAL OPS CREATE JOB PAYLOAD', payload); const {data:job,error:jobError}=await sb.from('jobs').insert(payload).select().single(); if(jobError){toast('Create job failed: '+jobError.message,true);return;} const {data:consignment,error:conError}=await sb.from('consignments').insert([{job_id:job.id,consignment_number:`C-${job.id.substring(0,6)}`}]).select().single(); if(conError){toast('Consignment creation failed: '+conError.message,true);return;} const itemsPayload=itemsToSave.map(item=>({consignment_id:consignment.id,description:item.description,item_type:item.item_type,qty:item.qty,length_m:item.length_m,width_m:item.width_m,height_m:item.height_m,weight_kg:item.weight_kg,cubic_m3:item.cubic_m3})); const {error:itemsError}=await sb.from('consignment_items').insert(itemsPayload); if(itemsError){toast('Item save failed: '+itemsError.message,true);return;} showJobCreatedModal(job); resetCreateBookingForm({ includeCustomerSelect: true }); await loadAllAddresses(); initAddressDropdowns(); await loadJobs(); }

async function submitCreateJobFromKeyboard(evt) {
  if (evt.key !== 'Enter' || evt.shiftKey || evt.ctrlKey || evt.altKey || evt.metaKey) return;
  const target = evt.target;
  if (!target?.closest?.('#section-booking')) return;
  if (target.closest('textarea,button,[type="button"]')) return;
  evt.preventDefault();
  await createJob();
}
export function setActiveFilter(activeId){ ['filterAll','filterUnallocated','filterAllocated'].forEach(id=>el(id)?.classList.remove('filter-btn-active')); el(activeId)?.classList.add('filter-btn-active'); }
export function bindJobEvents(){
  el('createJobBtn')?.addEventListener('click',createJob);
  if(!bookingSubmitBindingInitialized){ document.addEventListener('keydown', submitCreateJobFromKeyboard); bookingSubmitBindingInitialized=true; }
  el('refreshJobs')?.addEventListener('click',async(evt)=>{
    const btn = evt.currentTarget;
    const originalText = btn?.textContent;
    setButtonLoading(btn, true);
    try {
      await loadJobs();
      const { refreshAllocationBoard } = await import('./allocations.js');
      await refreshAllocationBoard();
    } catch (err) {
      console.error('Refresh jobs failed:', err);
    } finally {
      setButtonLoading(btn, false, originalText || '↻ Refresh');
    }
  });
  el('refreshJobsBtnOps')?.addEventListener('click',async(evt)=>{
    const btn = evt.currentTarget;
    const originalText = btn?.textContent;
    setButtonLoading(btn, true);
    try {
      await loadJobs();
      const { refreshAllocationBoard } = await import('./allocations.js');
      await refreshAllocationBoard();
    } catch (err) {
      console.error('Refresh jobs (ops) failed:', err);
    } finally {
      setButtonLoading(btn, false, originalText || 'Refresh jobs');
    }
  });
  el('refreshJobsBtnDriver')?.addEventListener('click',loadJobs);

  if (!jobVehicleBindingInitialized) {
    document.addEventListener('change', async (evt) => {
      const select = evt.target.closest('.job-vehicle-select');
      if (!select) return;

      const jobId = select.getAttribute('data-job');
      const legType = select.getAttribute('data-type');
      const vehicleId = select.value || null;

      if (!jobId || !legType) return;

      const { allocateJobLeg } = await import('./allocations.js');
      await allocateJobLeg(jobId, legType, vehicleId, null);
    });

    jobVehicleBindingInitialized = true;
  }

  el('jobSearch')?.addEventListener('input',evt=>{const val=evt.target.value.toLowerCase(); renderJobs((state.visibleJobs||[]).filter(job=>String(job.job_number||'').toLowerCase().includes(val)||String(job.customer_name||'').toLowerCase().includes(val)||String(job.customer_reference||'').toLowerCase().includes(val)||String(job.pickup_company_name||job.pickup_company||'').toLowerCase().includes(val)||String(job.pickup_suburb||'').toLowerCase().includes(val)||String(job.delivery_company_name||job.delivery_company||'').toLowerCase().includes(val)||String(job.delivery_suburb||'').toLowerCase().includes(val)));});
  el('filterAll')?.addEventListener('click',()=>{state.currentFilter='all';setActiveFilter('filterAll');applyFilters();});
  el('filterUnallocated')?.addEventListener('click',()=>{state.currentFilter='unallocated';setActiveFilter('filterUnallocated');applyFilters();});
  el('filterAllocated')?.addEventListener('click',()=>{state.currentFilter='allocated';setActiveFilter('filterAllocated');applyFilters();});
}