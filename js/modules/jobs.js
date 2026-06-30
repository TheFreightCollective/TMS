import { sb } from '../core/supabaseClient.js';
import { updateDashboardStats } from '../modules/nav.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml, formatDateTime, combineDateTime } from '../core/utils.js';
import { driverOptionsMarkup } from './drivers.js';
import { getBookingItemsForSave, validateBookingItems, calculateBookingTotals, resetBookingItems } from './freightItems.js';
import { showJobCreatedModal } from './ui.js';
import { loadAllAddresses, initAddressDropdowns } from './addresses.js';

export function getJobStatus(job){
  const pickupStatus = job?.pickup_status || '';
  const deliveryStatus = job?.delivery_status || '';
  if (deliveryStatus === 'delivered') return 'completed';
  if (pickupStatus === 'picked_up' || ['accepted','en_route_pickup'].includes(pickupStatus) || ['accepted','en_route_delivery'].includes(deliveryStatus)) return 'in_progress';
  if (!job?.pickup_driver_id || !job?.delivery_driver_id) return 'pending_allocation';
  if (pickupStatus === 'allocated' || deliveryStatus === 'allocated') return 'allocated';
  return 'allocated';
}

async function enrichJobsWithAddressDetails(jobs){
  const rows = jobs || [];
  const jobIds = [...new Set(rows.map(job => job.job_id || job.id).filter(Boolean))];
  if (!jobIds.length) return rows;

  const { data: jobRows, error: jobError } = await sb
    .from('jobs')
    .select('id, pickup_address_id, delivery_address_id, pickup_company_name, pickup_suburb, delivery_company_name, delivery_suburb')
    .in('id', jobIds);

  if (jobError || !jobRows?.length) return rows;

  const jobMap = new Map(jobRows.map(job => [job.id, job]));
  const addressIds = [...new Set(jobRows.flatMap(job => [job.pickup_address_id, job.delivery_address_id].filter(Boolean)))];
  let addressMap = new Map();

  if (addressIds.length) {
    const { data: addresses, error } = await sb.from('addresses').select('id, company_name, suburb').in('id', addressIds);
    if (!error && addresses?.length) {
      addressMap = new Map(addresses.map(addr => [addr.id, addr]));
    }
  }

  return rows.map(job => {
    const baseJob = jobMap.get(job.job_id || job.id) || {};
    const pickupAddress = addressMap.get(baseJob.pickup_address_id || job.pickup_address_id);
    const deliveryAddress = addressMap.get(baseJob.delivery_address_id || job.delivery_address_id);

    return {
      ...job,
      pickup_address_id: job.pickup_address_id || baseJob.pickup_address_id || null,
      delivery_address_id: job.delivery_address_id || baseJob.delivery_address_id || null,
      pickup_company_name: job.pickup_company_name || job.pickup_company || baseJob.pickup_company_name || pickupAddress?.company_name || null,
      pickup_suburb: job.pickup_suburb || baseJob.pickup_suburb || pickupAddress?.suburb || null,
      delivery_company_name: job.delivery_company_name || job.delivery_company || baseJob.delivery_company_name || deliveryAddress?.company_name || null,
      delivery_suburb: job.delivery_suburb || baseJob.delivery_suburb || deliveryAddress?.suburb || null
    };
  });
}

export async function loadJobs(){ let data=null,error=null; if(!state.currentUser||!state.currentProfile){state.visibleJobs=[]; renderJobs([]); return;} if(state.currentProfile.role==='customer'){ if(!state.currentCustomerId){toast('Customer not linked correctly',true); state.visibleJobs=[]; renderJobs([]); return;} const jobsRes=await sb.from('jobs').select('id').eq('customer_id',state.currentCustomerId); if(jobsRes.error){toast('Load jobs failed: '+jobsRes.error.message,true);return;} const ids=(jobsRes.data||[]).map(r=>r.id); if(!ids.length){state.visibleJobs=[];renderJobs([]);return;} const res=await sb.from('v_job_current_allocations').select('*').in('job_id',ids).order('job_number',{ascending:false}); data=res.data; error=res.error; } else { const res=await sb.from('v_job_current_allocations').select('*').order('job_number',{ascending:false}); data=res.data; error=res.error; } if(state.currentProfile.role==='driver'&&state.currentDriver?.id){ data=(data||[]).filter(j=>(j.pickup_driver_id===state.currentDriver.id&&j.pickup_status!=='picked_up')||(j.delivery_driver_id===state.currentDriver.id&&j.pickup_status==='picked_up'&&j.delivery_status!=='delivered')); } if(error){toast('Load jobs failed: '+error.message,true);return;} const enriched=await enrichJobsWithAddressDetails(data||[]); state.visibleJobs=enriched; updateDashboardStats(state.visibleJobs); applyFilters(); }
export function applyFilters(){ let filtered=state.visibleJobs||[]; if(state.currentFilter==='unallocated')filtered=filtered.filter(job=>!job.pickup_driver_id||!job.delivery_driver_id); if(state.currentFilter==='allocated')filtered=filtered.filter(job=>job.pickup_driver_id&&job.delivery_driver_id&&!(['delivered','picked_up'].includes(job.delivery_status||''))&&!(job.pickup_status==='picked_up'&&job.delivery_status!=='delivered')); if(state.currentFilter==='in_progress')filtered=filtered.filter(job=>['accepted','en_route_pickup','picked_up'].includes(job.pickup_status||'')||['accepted','en_route_delivery'].includes(job.delivery_status||'')); if(state.currentFilter==='completed')filtered=filtered.filter(job=>job.delivery_status==='delivered'); renderJobs(filtered); }
export function renderJobs(jobs){
  const root=el('jobs'); if(!root)return;
  const role=state.currentProfile?.role||null;
  const isOpsAdmin=['admin','ops'].includes(role);
  if(!jobs?.length){root.innerHTML=`<tr><td colspan="15" class="muted">No jobs visible.</td></tr>`;return;}
  root.innerHTML=jobs.map(job=>{
    const status=getJobStatus(job);
    const hasProof=status==='completed'||job.delivery_status==='delivered'||job.pickup_status==='picked_up';
    const podBtn=isOpsAdmin&&hasProof?`<button type="button" class="secondary small open-pod-btn" data-job-id="${escapeHtml(job.job_id)}" style="margin-left:4px;">POD</button>`:'';
    return `<tr><td><button type="button" class="inline-link open-job-items-btn" data-job-id="${escapeHtml(job.job_id)}">#${escapeHtml(job.job_number||'')}</button></td><td>${escapeHtml(job.customer_name||'—')}</td><td>${escapeHtml(job.customer_reference || '—')}</td><td>${escapeHtml(job.pickup_company_name || job.pickup_company || '—')}</td><td>${escapeHtml(job.pickup_suburb || '—')}</td><td>${escapeHtml(job.delivery_company_name || job.delivery_company || '—')}</td><td>${escapeHtml(job.delivery_suburb || '—')}</td><td>${formatDateTime(job.pickup_date)}</td><td>${formatDateTime(job.delivery_date)}</td><td>${Number(job.total_weight_kg||0).toFixed(0)} kg</td><td>${Number(job.total_cubic_m3||0).toFixed(3)} m³</td><td><span class="chip ${status}">${status.replace(/_/g,' ')}</span></td><td><select data-job="${job.job_id}" data-type="pickup" class="driver-select">${driverOptionsMarkup(job.pickup_driver_id)}</select></td><td><select data-job="${job.job_id}" data-type="delivery" class="driver-select">${driverOptionsMarkup(job.delivery_driver_id)}</select></td><td style="text-align:right;white-space:nowrap;">${podBtn}</td></tr>`;
  }).join('');
}
function selectedRadioValue(name){ return document.querySelector(`input[name="${name}"]:checked`)?.value || null; }
export async function createJob(){ if(!state.currentUser){toast('You must be logged in to create a job',true);return;} if(!state.currentProfile){toast('Login first.',true);return;} if(!['customer','admin','ops'].includes(state.currentProfile.role)){toast('Invalid role',true);return;} let customerId=state.currentProfile.role==='customer'?state.currentCustomerId:el('customerSelect')?.value; if(!customerId){toast(state.currentProfile.role==='customer'?'Customer not linked correctly':'Please select a customer',true);return;} const itemsToSave=getBookingItemsForSave(); if(!validateBookingItems(itemsToSave))return; const totals=calculateBookingTotals(); const payload={customer_id:customerId,source:'customer_portal',created_by:state.currentUser.id,customer_reference:el('customerRef').value.trim()||null,pickup_address_id:el('pickupAddressSelect').value||null,pickup_suburb:el('pickupSuburb').value.trim()||null,pickup_state:el('pickupState').value.trim()||null,pickup_postcode:el('pickupPostcode').value.trim()||null,delivery_address_id:el('deliveryAddressSelect').value||null,delivery_suburb:el('deliverySuburb').value.trim()||null,delivery_state:el('deliveryState').value.trim()||null,delivery_postcode:el('deliveryPostcode').value.trim()||null,status:'pending_allocation',pickup_date:combineDateTime(el('pickupDate')?.value,el('pickupTime')?.value),delivery_date:combineDateTime(el('deliveryDate')?.value,el('deliveryTime')?.value),sender_notes:el('senderNotes')?.value.trim()||null,receiver_notes:el('receiverNotes')?.value.trim()||null,total_weight_kg:totals.totalWeight,total_cubic_m3:totals.totalCubic}; const {data:job,error:jobError}=await sb.from('jobs').insert(payload).select().single(); if(jobError){toast('Create job failed: '+jobError.message,true);return;} const {data:consignment,error:conError}=await sb.from('consignments').insert([{job_id:job.id,consignment_number:`C-${job.id.substring(0,6)}`}]).select().single(); if(conError){toast('Consignment creation failed: '+conError.message,true);return;} const itemsPayload=itemsToSave.map(item=>({consignment_id:consignment.id,description:item.description,item_type:item.item_type,qty:item.qty,length_m:item.length_m,width_m:item.width_m,height_m:item.height_m,weight_kg:item.weight_kg,cubic_m3:item.cubic_m3})); const {error:itemsError}=await sb.from('consignment_items').insert(itemsPayload); if(itemsError){toast('Item save failed: '+itemsError.message,true);return;} showJobCreatedModal(job); await maybeSaveAddress('pickup', customerId, selectedRadioValue('pickupSaveOption')); await maybeSaveAddress('delivery', customerId, selectedRadioValue('deliverySaveOption')); resetBookingItems(); await loadAllAddresses(); initAddressDropdowns(); await loadJobs(); }
async function maybeSaveAddress(prefix, customerId, addressType){ if(!addressType)return; const company=el(`${prefix}Company`)?.value?.trim(); const addressLine=el(`${prefix}AddressLine`)?.value?.trim(); const suburb=el(`${prefix}Suburb`)?.value?.trim(); if(!company&&!addressLine&&!suburb)return; await sb.from('addresses').insert([{company_name:company||null,contact_name:el(`${prefix}-contact`)?.value||null,contact_phone:el(`${prefix}-phone`)?.value||null,address_line:addressLine||null,suburb:suburb||null,state:el(`${prefix}State`)?.value||null,postcode:el(`${prefix}Postcode`)?.value||null,address_type:addressType,customer_id:customerId,created_by_user_id:state.currentUser.id}]); }
export function setActiveFilter(activeId){ ['filterAll','filterUnallocated','filterAllocated'].forEach(id=>el(id)?.classList.remove('filter-btn-active')); el(activeId)?.classList.add('filter-btn-active'); }
export function bindJobEvents(){ el('createJobBtn')?.addEventListener('click',createJob); el('refreshJobs')?.addEventListener('click',async()=>{await loadJobs(); import('./allocations.js').then(({refreshAllocationBoard})=>refreshAllocationBoard());}); el('refreshJobsBtnOps')?.addEventListener('click',async()=>{await loadJobs(); import('./allocations.js').then(({refreshAllocationBoard})=>refreshAllocationBoard());}); el('refreshJobsBtnDriver')?.addEventListener('click',loadJobs); el('jobSearch')?.addEventListener('input',evt=>{const val=evt.target.value.toLowerCase(); renderJobs((state.visibleJobs||[]).filter(job=>String(job.job_number||'').toLowerCase().includes(val)||String(job.customer_name||'').toLowerCase().includes(val)||String(job.customer_reference||'').toLowerCase().includes(val)||String(job.pickup_company_name||job.pickup_company||'').toLowerCase().includes(val)||String(job.pickup_suburb||'').toLowerCase().includes(val)||String(job.delivery_company_name||job.delivery_company||'').toLowerCase().includes(val)||String(job.delivery_suburb||'').toLowerCase().includes(val)));}); el('filterAll')?.addEventListener('click',()=>{state.currentFilter='all';setActiveFilter('filterAll');applyFilters();}); el('filterUnallocated')?.addEventListener('click',()=>{state.currentFilter='unallocated';setActiveFilter('filterUnallocated');applyFilters();}); el('filterAllocated')?.addEventListener('click',()=>{state.currentFilter='allocated';setActiveFilter('filterAllocated');applyFilters();}); }