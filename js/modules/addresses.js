import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast } from '../core/utils.js';

let editingAddressId = null;

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"]|'/g, char => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	}[char]));
}

function formatAddressType(addressType) {
	if (addressType === 'pickup') return 'Pickup Only';
	if (addressType === 'delivery') return 'Delivery Only';
	if (addressType === 'unsaved_pickup') return 'Unsaved Pickup';
	if (addressType === 'unsaved_delivery') return 'Unsaved Delivery';
	return 'Both';
}

function isBookAddress(address) {
	return ['pickup', 'delivery', 'both'].includes(address?.address_type);
}

function getBookAddresses() {
	return (state.allAddresses || []).filter(isBookAddress);
}

function syncBookingSaveVisibility(prefix) {
	const selectEl = el(`${prefix}AddressSelect`);
	const wrapEl = el(`${prefix}SaveWrap`);
	const checkboxEl = el(`${prefix}SaveToBook`);
	const segmentEl = el(`${prefix}SaveTypeWrap`);
	if (!selectEl || !wrapEl || !checkboxEl || !segmentEl) return;
	const hasSavedAddress = Boolean(selectEl.value);
	wrapEl.classList.toggle('hidden', hasSavedAddress);

	if (hasSavedAddress) {
		checkboxEl.checked = false;
		segmentEl.classList.add('hidden');
		return;
	}

	segmentEl.classList.toggle('hidden', !checkboxEl.checked);
	if (checkboxEl.checked) {
		const defaultValue = prefix === 'pickup' ? 'pickup' : 'delivery';
		const selected = document.querySelector(`input[name="${prefix}SaveType"]:checked`);
		if (!selected) {
			const defaultRadio = document.querySelector(`input[name="${prefix}SaveType"][value="${defaultValue}"]`);
			if (defaultRadio) defaultRadio.checked = true;
		}
	}
}

function setAddressModalMode(isEditing) {
	const saveBtn = el('saveAddressBtn');
	if (saveBtn) saveBtn.textContent = isEditing ? 'Update' : 'Save';
}

function resetAddressModalFields(defaultType = 'both') {
	['addr-company', 'addr-contact', 'addr-phone', 'addr-line', 'addr-suburb', 'addr-state', 'addr-postcode'].forEach(id => {
		if (el(id)) el(id).value = '';
	});
	if (el('addr-type')) el('addr-type').value = defaultType;
	state.suburbSelected = false;
	setAddressModalMode(false);
}

function fillAddressModal(address) {
	if (!address) return;
	if (el('addr-company')) el('addr-company').value = address.company_name || '';
	if (el('addr-contact')) el('addr-contact').value = address.contact_name || '';
	if (el('addr-phone')) el('addr-phone').value = address.contact_phone || '';
	if (el('addr-line')) el('addr-line').value = address.address_line || '';
	if (el('addr-suburb')) el('addr-suburb').value = address.suburb || '';
	if (el('addr-state')) el('addr-state').value = address.state || '';
	if (el('addr-postcode')) el('addr-postcode').value = address.postcode || '';
	if (el('addr-type')) el('addr-type').value = address.address_type || 'both';
	state.suburbSelected = true;
	setAddressModalMode(true);
}

function getVisibleAddresses() {
	return state.allAddresses || [];
}

export async function loadPostcodes() {
	if (state.auPostcodes?.length) return state.auPostcodes;

	let allRows = [];
	let from = 0;
	const pageSize = 1000;
	let keepGoing = true;

	while (keepGoing) {
		const { data, error } = await sb.from('au_postcodes').select('suburb,state,postcode').range(from, from + pageSize - 1);
		if (error) {
			console.error('Error loading postcodes:', error);
			return [];
		}

		const rows = data || [];
		allRows = allRows.concat(rows);
		if (rows.length < pageSize) keepGoing = false;
		else from += pageSize;
	}

	state.auPostcodes = allRows;
	console.log('Postcodes loaded once:', state.auPostcodes.length);
	return state.auPostcodes;
}

export function initInlineSuburbSearch(inputId, prefix) {
	const input = el(inputId);
	if (!input) return;

	let results = input.parentNode.querySelector('.suburb-dropdown');
	if (!results) {
		results = document.createElement('div');
		results.className = 'suburb-dropdown';
		input.parentNode.style.position = 'relative';
		input.parentNode.appendChild(results);
	}

	input.addEventListener('input', async () => {
		const val = input.value.toLowerCase().trim();
		results.innerHTML = '';
		results.style.display = 'none';
		if (!val) return;

		if (!state.auPostcodes?.length) await loadPostcodes();
		const matches = state.auPostcodes.filter(p => (p.suburb || '').toLowerCase().includes(val)).slice(0, 10);
		if (!matches.length) return;

		results.style.display = 'block';
		matches.forEach(p => {
			const div = document.createElement('div');
			div.textContent = `${p.suburb} ${p.state} ${p.postcode}`;
			div.onclick = () => {
				input.value = p.suburb;
				el(`${prefix}State`).value = p.state || '';
				el(`${prefix}Postcode`).value = p.postcode || '';
				results.style.display = 'none';
			};
			results.appendChild(div);
		});
	});

	document.addEventListener('click', e => {
		if (!results.contains(e.target) && e.target !== input) results.style.display = 'none';
	});
}

export async function loadAllAddresses() {
	let query = sb.from('addresses').select('*');
	const role = state.currentProfile?.role || null;
	const bookAddressTypes = ['pickup', 'delivery', 'both'];
	query = query.in('address_type', bookAddressTypes);

	if (role === 'customer') {
		const customerId = state.currentCustomerId;
		const profileId = state.currentProfile?.id;
		if (customerId && profileId) {
			query = query.eq('customer_id', customerId).eq('created_by_user_id', profileId);
		} else {
			state.allAddresses = [];
			renderSavedAddresses();
			return;
		}
	}

	const { data, error } = await query;
	if (error) {
		console.error('Error loading addresses:', error);
		return;
	}

	state.allAddresses = data || [];
	renderSavedAddresses();
}

export function renderSavedAddresses(containerId = 'savedAddressesList') {
	const container = el(containerId);
	if (!container) return;

	const addresses = getBookAddresses();
	if (!addresses.length) {
		container.innerHTML = '<p class="muted" style="margin:0;">No saved addresses yet.</p>';
		return;
	}

	container.innerHTML = `
		<table class="items-table saved-addresses-table">
			<thead>
				<tr>
					<th>Company</th>
					<th>Contact</th>
					<th>Phone</th>
					<th>Address</th>
					<th>Suburb</th>
					<th>State</th>
					<th>Postcode</th>
					<th>Type</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				${addresses.map(address => `
					<tr>
						<td data-label="Company">${escapeHtml(address.company_name)}</td>
						<td data-label="Contact">${escapeHtml(address.contact_name)}</td>
						<td data-label="Phone">${escapeHtml(address.contact_phone)}</td>
						<td data-label="Address">${escapeHtml(address.address_line)}</td>
						<td data-label="Suburb">${escapeHtml(address.suburb)}</td>
						<td data-label="State">${escapeHtml(address.state)}</td>
						<td data-label="Postcode">${escapeHtml(address.postcode)}</td>
						<td data-label="Type">${escapeHtml(formatAddressType(address.address_type))}</td>
						<td data-label="Actions">
							<button type="button" class="secondary small" data-address-action="edit" data-address-id="${escapeHtml(address.id)}">Edit</button>
						</td>
					</tr>
				`).join('')}
			</tbody>
		</table>
	`;
}

export function renderAddressDropdown(selectId, type) {
	const sel = el(selectId);
	if (!sel) return;

	const filtered = getBookAddresses().filter(a => a.address_type === type || a.address_type === 'both');
	sel.innerHTML = '<option value="">Select address</option>';
	filtered.forEach(a => {
		const opt = document.createElement('option');
		opt.value = a.id;
		opt.textContent = `${a.company_name || ''} - ${a.suburb || ''}`;
		sel.appendChild(opt);
	});
}

export function initAddressDropdowns() {
	renderAddressDropdown('pickupAddressSelect', 'pickup');
	renderAddressDropdown('deliveryAddressSelect', 'delivery');
}

export function onAddressChange(selectId, prefix) {
	const selectEl = el(selectId);
	if (!selectEl) return;

	const addr = (state.allAddresses || []).find(a => a.id == selectEl.value);
	const refs = {
		company: el(`${prefix}Company`),
		contact: el(`${prefix}-contact`),
		phone: el(`${prefix}-phone`),
		line: el(`${prefix}AddressLine`),
		suburb: el(`${prefix}Suburb`),
		state: el(`${prefix}State`),
		postcode: el(`${prefix}Postcode`)
	};

	if (!addr) {
		Object.values(refs).forEach(x => {
			if (x) x.value = '';
		});
		[refs.state, refs.postcode].forEach(f => {
			if (f) f.style.background = '';
		});
		syncBookingSaveVisibility(prefix);
		return;
	}

	refs.company.value = addr.company_name || '';
	refs.contact.value = addr.contact_name || '';
	refs.phone.value = addr.contact_phone || '';
	refs.line.value = addr.address_line || '';
	refs.suburb.value = addr.suburb || '';
	refs.state.value = addr.state || '';
	refs.postcode.value = addr.postcode || '';
	[refs.state, refs.postcode].forEach(f => {
		if (f) f.style.background = '#f1f5f9';
	});
	syncBookingSaveVisibility(prefix);
}

export function openAddressModal(defaultType = 'both', address = null) {
	editingAddressId = address?.id || null;
	resetAddressModalFields(defaultType);
	fillAddressModal(address);
	el('address-modal')?.classList.remove('hidden');
	initSuburbAutocomplete();
	setTimeout(() => el('addr-company')?.focus(), 50);
}

export function closeAddressModal() {
	editingAddressId = null;
	setAddressModalMode(false);
	el('address-modal')?.classList.add('hidden');
}

export function openSavedAddressEditor(addressId) {
	const address = getBookAddresses().find(a => String(a.id) === String(addressId));
	if (!address) {
		toast('Address not found', true);
		return;
	}
	openAddressModal(address.address_type || 'both', address);
}

export function initSuburbAutocomplete() {
	const input = el('addr-suburb');
	const results = el('suburb-results');
	if (!input || !results) return;

	input.oninput = () => {
		state.suburbSelected = false;
		const val = input.value.toLowerCase().trim();
		results.innerHTML = '';
		results.style.display = 'none';
		if (!val) return;

		const matches = (state.auPostcodes || []).filter(p => (p.suburb || '').toLowerCase().includes(val)).slice(0, 10);
		if (!matches.length) return;

		results.style.display = 'block';
		matches.forEach(p => {
			const div = document.createElement('div');
			div.textContent = `${p.suburb} ${p.state} ${p.postcode}`;
			div.onclick = () => {
				input.value = p.suburb;
				el('addr-state').value = p.state || '';
				el('addr-postcode').value = p.postcode || '';
				state.suburbSelected = true;
				results.style.display = 'none';
			};
			results.appendChild(div);
		});
	};

	document.addEventListener('click', e => {
		if (!results.contains(e.target) && e.target !== input) results.style.display = 'none';
	});
}

export async function saveAddress() {
	const company = el('addr-company').value.trim();
	const addressLine = el('addr-line').value.trim();
	const suburb = el('addr-suburb').value.trim();
	const stateVal = el('addr-state').value.trim();
	const postcode = el('addr-postcode').value.trim();
	const role = state.currentProfile?.role || null;
	const customerId = state.currentCustomerId;
	const profileId = state.currentProfile?.id;

	if (!company) return toast('Company is required', true);
	if (!addressLine) return toast('Street address is required', true);
	if (!suburb) return toast('Suburb is required', true);
	if (!state.suburbSelected) return toast('Please select a suburb from the list', true);
	if (!stateVal) return toast('State must be selected from suburb', true);
	if (!postcode) return toast('Postcode must be selected from suburb', true);

	const payload = {
		company_name: company,
		contact_name: el('addr-contact').value,
		contact_phone: el('addr-phone').value,
		address_line: addressLine,
		suburb,
		state: stateVal,
		postcode,
		address_type: ['pickup', 'delivery', 'both'].includes(el('addr-type').value) ? el('addr-type').value : 'both'
	};

	const isEditing = Boolean(editingAddressId);

	if (isEditing) {
		const { error } = await sb.from('addresses').update(payload).eq('id', editingAddressId);
		if (error) {
			toast('Error saving address', true);
			console.error(error);
			return;
		}
	} else {
		const newAddress = {
			...payload,
			customer_id: role === 'customer' ? customerId : null,
			created_by_user_id: profileId || null
		};

		if (role === 'customer' && (!customerId || !profileId)) {
			toast('Customer context is missing', true);
			return;
		}

		const { error } = await sb.from('addresses').insert([newAddress]);
		if (error) {
			toast('Error saving address', true);
			console.error(error);
			return;
		}
	}

	toast(isEditing ? 'Address updated' : 'Address saved');
	editingAddressId = null;
	await loadAllAddresses();
	initAddressDropdowns();
	closeAddressModal();
}

export function bindAddressEvents() {
	el('pickupAddressSelect')?.addEventListener('change', () => onAddressChange('pickupAddressSelect', 'pickup'));
	el('deliveryAddressSelect')?.addEventListener('change', () => onAddressChange('deliveryAddressSelect', 'delivery'));
	el('pickupSaveToBook')?.addEventListener('change', () => syncBookingSaveVisibility('pickup'));
	el('deliverySaveToBook')?.addEventListener('change', () => syncBookingSaveVisibility('delivery'));
	syncBookingSaveVisibility('pickup');
	syncBookingSaveVisibility('delivery');
	el('saveAddressBtn')?.addEventListener('click', saveAddress);
	el('cancelAddressBtn')?.addEventListener('click', closeAddressModal);
	el('addAddressBtn')?.addEventListener('click', () => openAddressModal('both'));

	document.addEventListener('click', evt => {
		const editBtn = evt.target.closest('[data-address-action="edit"]');
		if (editBtn) {
			openSavedAddressEditor(editBtn.getAttribute('data-address-id'));
		}
	});

	window.openAddressModal = openAddressModal;
	window.closeAddressModal = closeAddressModal;
	window.saveAddress = saveAddress;
	window.onAddressChange = onAddressChange;
	window.openSavedAddressEditor = openSavedAddressEditor;
}
