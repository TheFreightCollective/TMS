import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, combineDateTime } from '../core/utils.js';
import { getBookingItemsForSave, validateBookingItems, calculateBookingTotals } from './freightItems.js';
import { loadAllAddresses, initAddressDropdowns } from './addresses.js';
import { loadCustomerJobs } from './customerJobs.js';
import { resetCreateBookingForm } from './bookingFormReset.js';

let customerBookingSubmitBindingInitialized = false;

function getActiveBookingContainer() {
  return document.querySelector('#section-new-booking:not(.hidden) .booking-container')
    || document.querySelector('#section-new-booking .booking-container')
    || null;
}

function getBookingFieldElement(id) {
  const container = getActiveBookingContainer();
  const scoped = container?.querySelector(`[id="${id}"]`);
  return scoped || document.getElementById(id);
}

function getBookingFieldValue(id) {
  const field = getBookingFieldElement(id);
  return field?.value ?? '';
}

async function createAddressFromForm(prefix, addressType) {
  const customerId = state.currentCustomerId;
  const profileId = state.currentProfile?.id;
  if (!customerId || !profileId) {
    toast('Customer context is missing', true);
    return null;
  }

  const company = el(`${prefix}Company`)?.value?.trim();
  const addressLine = el(`${prefix}AddressLine`)?.value?.trim();
  const suburb = el(`${prefix}Suburb`)?.value?.trim();
  const stateVal = el(`${prefix}State`)?.value?.trim();
  const postcode = el(`${prefix}Postcode`)?.value?.trim();
  const contactName = el(`${prefix}-contact`)?.value?.trim() || null;
  const contactPhone = el(`${prefix}-phone`)?.value?.trim() || null;

  if (!company && !addressLine && !suburb && !stateVal && !postcode) return null;

  const payload = {
    company_name: company || null,
    contact_name: contactName,
    contact_phone: contactPhone,
    address_line: addressLine || null,
    suburb: suburb || null,
    state: stateVal || null,
    postcode: postcode || null,
    address_type: addressType,
    customer_id: customerId,
    created_by_user_id: profileId
  };

  const { data, error } = await sb
    .from('addresses')
    .insert([payload])
    .select('id, company_name, contact_name, contact_phone, address_line, suburb, state, postcode')
    .single();
  if (error) {
    toast('Could not save address: ' + error.message, true);
    throw error;
  }

  return data || null;
}

async function resolveLegAddressAndSnapshot(prefix, selectedAddressId, addressType, defaultType) {
  let selectedAddress = (state.allAddresses || []).find(address => String(address.id) === String(selectedAddressId));

  if (!selectedAddress && selectedAddressId) {
    const { data, error } = await sb
      .from('addresses')
      .select('id, company_name, contact_name, contact_phone, address_line, suburb, state, postcode')
      .eq('id', selectedAddressId)
      .maybeSingle();
    if (error) {
      toast('Could not load selected address: ' + error.message, true);
    }
    selectedAddress = data || null;
  }

  if (!selectedAddress) {
    const inserted = await createAddressFromForm(prefix, addressType || defaultType);
    if (inserted) {
      selectedAddress = inserted;
      if (!state.allAddresses.some(address => String(address.id) === String(inserted.id))) {
        state.allAddresses.push(inserted);
      }
    }
  }

  const company = (getBookingFieldValue(`${prefix}Company`) || '').trim();
  const contact = (getBookingFieldValue(`${prefix}-contact`) || '').trim();
  const phone = (getBookingFieldValue(`${prefix}-phone`) || '').trim();
  const line = (getBookingFieldValue(`${prefix}AddressLine`) || '').trim();
  const suburb = (getBookingFieldValue(`${prefix}Suburb`) || '').trim();
  const stateVal = (getBookingFieldValue(`${prefix}State`) || '').trim();
  const postcode = (getBookingFieldValue(`${prefix}Postcode`) || '').trim();

  return {
    addressId: selectedAddress?.id || null,
    snapshot: {
      company_name: selectedAddress?.company_name || company || null,
      contact_name: selectedAddress?.contact_name || contact || null,
      phone: selectedAddress?.contact_phone || phone || null,
      address_text: selectedAddress?.address_line || line || null,
      suburb: selectedAddress?.suburb || suburb || null,
      state: selectedAddress?.state || stateVal || null,
      postcode: selectedAddress?.postcode || postcode || null,
      lat: null,
      lng: null
    }
  };
}

export async function createCustomerBooking() {
  if (!state.currentUser) {
    toast('You must be logged in to create a booking', true);
    return;
  }

  if (state.currentProfile?.role !== 'customer') {
    toast('Customer bookings are only available to customer users', true);
    return;
  }

  const customerId = state.currentCustomerId;
  const profileId = state.currentProfile?.id;

  if (!customerId || !profileId) {
    toast('Customer account is not linked correctly', true);
    return;
  }

  const itemsToSave = getBookingItemsForSave();
  if (!validateBookingItems(itemsToSave)) return;

  const totals = calculateBookingTotals();
  const pickupAddressId = (getBookingFieldValue('pickupAddressSelect') || '').trim() || null;
  const deliveryAddressId = (getBookingFieldValue('deliveryAddressSelect') || '').trim() || null;
  const pickupSavedType = document.querySelector('input[name="pickupSaveType"]:checked')?.value || 'pickup';
  const deliverySavedType = document.querySelector('input[name="deliverySaveType"]:checked')?.value || 'delivery';
  const pickupAddressType = el('pickupSaveToBook')?.checked ? pickupSavedType : 'unsaved_pickup';
  const deliveryAddressType = el('deliverySaveToBook')?.checked ? deliverySavedType : 'unsaved_delivery';

  const pickupLeg = await resolveLegAddressAndSnapshot('pickup', pickupAddressId, pickupAddressType, 'pickup');
  const deliveryLeg = await resolveLegAddressAndSnapshot('delivery', deliveryAddressId, deliveryAddressType, 'delivery');

  const payload = {
    customer_id: customerId,
    source: 'customer_portal',
    created_by: state.currentUser.id,
    customer_reference: (getBookingFieldValue('customerRef') || '').trim() || null,
    pickup_address_id: pickupLeg.addressId,
    pickup_company_name: pickupLeg.snapshot.company_name,
    pickup_contact_name: pickupLeg.snapshot.contact_name,
    pickup_phone: pickupLeg.snapshot.phone,
    pickup_address_text: pickupLeg.snapshot.address_text,
    pickup_suburb: pickupLeg.snapshot.suburb,
    pickup_state: pickupLeg.snapshot.state,
    pickup_postcode: pickupLeg.snapshot.postcode,
    pickup_lat: pickupLeg.snapshot.lat,
    pickup_lng: pickupLeg.snapshot.lng,
    delivery_address_id: deliveryLeg.addressId,
    delivery_company_name: deliveryLeg.snapshot.company_name,
    delivery_contact_name: deliveryLeg.snapshot.contact_name,
    delivery_phone: deliveryLeg.snapshot.phone,
    delivery_address_text: deliveryLeg.snapshot.address_text,
    delivery_suburb: deliveryLeg.snapshot.suburb,
    delivery_state: deliveryLeg.snapshot.state,
    delivery_postcode: deliveryLeg.snapshot.postcode,
    delivery_lat: deliveryLeg.snapshot.lat,
    delivery_lng: deliveryLeg.snapshot.lng,
    status: 'pending_allocation',
    pickup_date: combineDateTime(getBookingFieldValue('pickupDate'), getBookingFieldValue('pickupTime')),
    delivery_date: combineDateTime(getBookingFieldValue('deliveryDate'), getBookingFieldValue('deliveryTime')),
    sender_notes: (getBookingFieldValue('senderNotes') || '').trim() || null,
    receiver_notes: (getBookingFieldValue('receiverNotes') || '').trim() || null,
    total_weight_kg: totals.totalWeight,
    total_cubic_m3: totals.totalCubic
  };

  const { data: job, error: jobError } = await sb.from('jobs').insert(payload).select().single();
  if (jobError) {
    toast('Create booking failed: ' + jobError.message, true);
    return;
  }

  const { data: consignment, error: consignmentError } = await sb
    .from('consignments')
    .insert([{ job_id: job.id, consignment_number: `C-${String(job.id).substring(0, 6)}` }])
    .select()
    .single();

  if (consignmentError) {
    toast('Booking created but consignment creation failed: ' + consignmentError.message, true);
    return;
  }

  const itemsPayload = itemsToSave.map(item => ({
    consignment_id: consignment.id,
    description: item.description,
    item_type: item.item_type,
    qty: item.qty,
    length_m: item.length_m,
    width_m: item.width_m,
    height_m: item.height_m,
    weight_kg: item.weight_kg,
    cubic_m3: item.cubic_m3
  }));

  const { error: itemsError } = await sb.from('consignment_items').insert(itemsPayload);
  if (itemsError) {
    toast('Booking created but freight items failed to save: ' + itemsError.message, true);
    return;
  }

  toast('Booking request created');
  resetCreateBookingForm({ includeCustomerSelect: false });
  await loadAllAddresses();
  initAddressDropdowns();
  await loadCustomerJobs();
}

async function submitCustomerBookingFromKeyboard(evt) {
  if (evt.key !== 'Enter' || evt.shiftKey || evt.ctrlKey || evt.altKey || evt.metaKey) return;
  const target = evt.target;
  if (!target?.closest?.('#section-new-booking')) return;
  if (target.closest('textarea,button,[type="button"]')) return;
  evt.preventDefault();
  await createCustomerBooking();
}

export function bindCustomerBookingEvents() {
  el('createJobBtn')?.addEventListener('click', createCustomerBooking);
  if (!customerBookingSubmitBindingInitialized) {
    document.addEventListener('keydown', submitCustomerBookingFromKeyboard);
    customerBookingSubmitBindingInitialized = true;
  }
  window.createCustomerBooking = createCustomerBooking;
}