import { el } from '../core/utils.js';
import { resetBookingItems } from './freightItems.js';
import { onAddressChange } from './addresses.js';

function resetTimeControl(wrapperId) {
  const wrapper = el(wrapperId);
  if (wrapper) wrapper.classList.add('hidden');

  const toggleBtn = document.querySelector(`.toggle-time-btn[data-target="${wrapperId}"]`);
  if (toggleBtn) toggleBtn.textContent = '+ time';
}

function resetSaveControls(prefix, defaultType) {
  const checkbox = el(`${prefix}SaveToBook`);
  if (checkbox) checkbox.checked = false;

  const segmentWrap = el(`${prefix}SaveTypeWrap`);
  if (segmentWrap) segmentWrap.classList.add('hidden');

  const defaultRadio = document.querySelector(`input[name="${prefix}SaveType"][value="${defaultType}"]`);
  if (defaultRadio) defaultRadio.checked = true;
}

export function resetCreateBookingForm({ includeCustomerSelect = false } = {}) {
  if (includeCustomerSelect && el('customerSelect')) {
    el('customerSelect').value = '';
  }

  [
    'customerRef',
    'pickupDate',
    'pickupTime',
    'deliveryDate',
    'deliveryTime',
    'pickupCompany',
    'pickup-contact',
    'pickup-phone',
    'pickupAddressLine',
    'pickupSuburb',
    'pickupState',
    'pickupPostcode',
    'senderNotes',
    'deliveryCompany',
    'delivery-contact',
    'delivery-phone',
    'deliveryAddressLine',
    'deliverySuburb',
    'deliveryState',
    'deliveryPostcode',
    'receiverNotes'
  ].forEach(id => {
    const node = el(id);
    if (node) node.value = '';
  });

  if (el('pickupAddressSelect')) el('pickupAddressSelect').value = '';
  if (el('deliveryAddressSelect')) el('deliveryAddressSelect').value = '';

  resetSaveControls('pickup', 'pickup');
  resetSaveControls('delivery', 'delivery');
  resetTimeControl('pickupTimeWrap');
  resetTimeControl('deliveryTimeWrap');

  onAddressChange('pickupAddressSelect', 'pickup');
  onAddressChange('deliveryAddressSelect', 'delivery');

  resetBookingItems();
}
