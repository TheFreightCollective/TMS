import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml } from '../core/utils.js';

let customerList = [];
let customerUserLinks = [];
let customerPortalUsers = [];
let editingCustomerId = null;
let customerPortalUserSearchResults = [];
let selectedCustomerUsers = [];

function getCurrentCustomerPortalSearchTerm() {
  return String(el('customerPortalUserSearch')?.value || '').trim();
}

async function loadCustomerUsers(selectedCustomerId) {
  if (!selectedCustomerId) {
    selectedCustomerUsers = [];
    return;
  }

  const { data, error } = await sb
    .from('customer_users')
    .select('customer_id, user_id, portal_role')
    .eq('customer_id', selectedCustomerId);

  if (error) {
    console.error(error);
    selectedCustomerUsers = [];
    return;
  }

  selectedCustomerUsers = data || [];
}

export async function loadCustomerContext() {
  const res = await sb.from('customer_users').select('customer_id, portal_role').eq('user_id', state.currentUser.id).limit(1).maybeSingle();
  if (res.error) { toast('Customer link failed: ' + res.error.message, true); return; }
  state.currentCustomerId = res.data ? res.data.customer_id : null;
  if (!state.currentCustomerId) toast('No customer linked for this user in public.customer_users.', true);
}

export async function loadCustomers() {
  let customerData = [];
  let customerError = null;
  const selectedPortalCustomerId = el('customerPortalCustomerSelect')?.value || '';
  const selectedBookingCustomerId = el('customerSelect')?.value || '';

  const { data, error } = await sb.from('customers').select('*').order('company_name');
  if (!error) {
    customerData = data || [];
  } else {
    customerError = error;
    const fallback = await sb.from('profiles').select('id, full_name, email, role').eq('role', 'customer').order('full_name');
    if (!fallback.error && fallback.data?.length) {
      customerData = (fallback.data || []).map(profile => ({
        id: profile.id,
        company_name: profile.full_name || profile.email || 'Customer',
        contact_name: profile.full_name || null,
        contact_email: profile.email || null
      }));
    }
  }

  if (customerError && !customerData.length) {
    console.error(customerError);
    toast('Could not load customers', true);
    customerList = [];
  } else {
    customerList = customerData;
  }

  const { data: linksData, error: linksError } = await sb.from('customer_users').select('customer_id, user_id, portal_role');
  if (linksError) { console.error(linksError); customerUserLinks = []; }
  else { customerUserLinks = linksData || []; }

  const { data: portalUsersData, error: portalUsersError } = await sb
    .from('customer_users')
    .select('user_id, customer_id, portal_role, profiles!inner(full_name, email), customers!inner(company_name)')
    .order('customers(company_name)', { ascending: true });

  if (portalUsersError) {
    console.error(portalUsersError);
    customerPortalUsers = [];
  } else {
    customerPortalUsers = (portalUsersData || []).map(row => ({
      user_id: row.user_id || null,
      customer_id: row.customer_id || null,
      company_name: row.customers?.company_name || null,
      full_name: row.profiles?.full_name || null,
      email: row.profiles?.email || null,
      portal_role: row.portal_role || null
    }));
  }

  populateCustomerSelects(selectedBookingCustomerId, selectedPortalCustomerId);
  const currentPortalCustomerId = el('customerPortalCustomerSelect')?.value || selectedPortalCustomerId;
  await loadCustomerUsers(currentPortalCustomerId);
  renderCustomersTable();
  renderCustomerPortalUsersTable();

  const activeSearchTerm = getCurrentCustomerPortalSearchTerm();
  if (activeSearchTerm) {
    await runUserSearch(activeSearchTerm);
  } else {
    renderCustomerPortalUserSearchResults();
  }
}

function populateCustomerSelects(selectedBookingCustomerId = '', selectedPortalCustomerId = '') {
  const bookingSelect = el('customerSelect');
  if (bookingSelect) {
    bookingSelect.innerHTML = '<option value="">Select customer...</option>';
    customerList.forEach(customer => {
      const option = document.createElement('option');
      option.value = customer.id;
      option.textContent = customer.company_name;
      bookingSelect.appendChild(option);
    });
    if (selectedBookingCustomerId) bookingSelect.value = selectedBookingCustomerId;
  }

  const portalSelect = el('customerPortalCustomerSelect');
  if (portalSelect) {
    portalSelect.innerHTML = '<option value="">Select customer...</option>';
    customerList.forEach(customer => {
      const option = document.createElement('option');
      option.value = customer.id;
      option.textContent = customer.company_name;
      portalSelect.appendChild(option);
    });
    if (selectedPortalCustomerId) portalSelect.value = selectedPortalCustomerId;
  }
}

function renderCustomersTable() {
  const tbody = el('customerTableBody');
  if (!tbody) return;

  if (!customerList.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">No customers yet.</td></tr>';
    return;
  }

  tbody.innerHTML = customerList.map(customer => {
    const linkedUsers = customerUserLinks.filter(link => link.customer_id === customer.id);

    const userList = linkedUsers.length
      ? linkedUsers.map(link => escapeHtml(link.portal_role || 'portal')).join(', ')
      : 'None';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(customer.company_name || '—')}</strong>
          <div class="muted" style="font-size:12px;"></div>
        </td>
        <td>${escapeHtml(customer.billing_email || '—')}</td>
        <td>${userList}</td>
        <td data-label="Actions" style="text-align:right;">
          <button type="button" class="secondary small edit-customer-btn" data-customer-id="${escapeHtml(customer.id)}">Edit</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderCustomerPortalUsersTable() {
  const tbody = el('customerPortalUsersTableBody');
  if (!tbody) return;

  if (!customerPortalUsers.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No customer portal users yet.</td></tr>';
    return;
  }

  tbody.innerHTML = customerPortalUsers.map(user => `
    <tr>
      <td>${escapeHtml(user.company_name || '—')}</td>
      <td>${escapeHtml(user.full_name || '—')}</td>
      <td>${escapeHtml(user.email || '—')}</td>
      <td>${escapeHtml(user.portal_role || '—')}</td>
      <td data-label="Actions" style="text-align:right;">
        <button type="button" class="danger-btn small unlink-customer-user-btn" data-customer-id="${escapeHtml(user.customer_id)}" data-user-id="${escapeHtml(user.user_id)}">Unlink</button>
      </td>
    </tr>
  `).join('');
}

function clearCustomerPortalUserSearch() {
  customerPortalUserSearchResults = [];
  if (el('customerPortalUserSearch')) el('customerPortalUserSearch').value = '';
  renderCustomerPortalUserSearchResults();
}

function renderCustomerPortalUserSearchResults() {
  const resultsRoot = el('customerPortalUserSearchResults');
  if (!resultsRoot) return;

  const selectedCustomerId = el('customerPortalCustomerSelect')?.value || '';
  const canLink = Boolean(selectedCustomerId);

  if (!customerPortalUserSearchResults.length) {
    resultsRoot.innerHTML = '';
    resultsRoot.classList.add('hidden');
    return;
  }

  resultsRoot.innerHTML = customerPortalUserSearchResults.map(user => `
    <div class="customer-user-search-item">
      <div class="customer-user-search-meta">
        <div class="customer-user-search-name">${escapeHtml(user.full_name || '—')}</div>
        <div class="customer-user-search-email">${escapeHtml(user.email || '—')}</div>
      </div>
      <button type="button" class="secondary small link-existing-customer-user-btn" data-user-id="${escapeHtml(user.id)}">${canLink ? 'Link' : 'Select customer first'}</button>
    </div>
  `).join('');
  resultsRoot.classList.remove('hidden');
}

async function searchCustomerPortalUsers(searchTerm) {
  const term = String(searchTerm || '').trim();
  const selectedCustomerId = el('customerPortalCustomerSelect')?.value || '';

  const query = sb
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('role', 'customer');

  if (term) {
    query
      .or(`email.ilike.%${term}%,full_name.ilike.%${term}%`)
      .limit(20);
  } else {
    query
      .order('created_at', { ascending: false })
      .limit(20);
  }

  const { data, error } = await query;

  if (error) {
    toast('Could not search users: ' + error.message, true);
    customerPortalUserSearchResults = [];
    renderCustomerPortalUserSearchResults();
    return;
  }

  const users = data || [];
  const customerUsers = selectedCustomerId ? (selectedCustomerUsers || []) : [];
  const filteredUsers = users.filter(user => {
    const isLinkedToThisCustomer = customerUsers.some(cu =>
      String(cu.customer_id) === String(selectedCustomerId) &&
      String(cu.user_id) === String(user.id)
    );
    return !isLinkedToThisCustomer;
  });

  console.log('Search users:', users);
  console.log('Filtered users:', filteredUsers);
  console.log('Customer links:', customerUsers);

  customerPortalUserSearchResults = filteredUsers;

  const resultsRoot = el('customerPortalUserSearchResults');
  if (!customerPortalUserSearchResults.length && resultsRoot) {
    resultsRoot.innerHTML = '<div class="customer-user-search-empty">No matching unlinked users found.</div>';
    resultsRoot.classList.remove('hidden');
    return;
  }

  renderCustomerPortalUserSearchResults();
}

async function runUserSearch(searchTerm) {
  await searchCustomerPortalUsers(searchTerm);
}

async function linkExistingCustomerUser(userId) {
  const customerId = el('customerPortalCustomerSelect')?.value;

  if (!customerId) {
    toast('Select a customer first', true);
    return;
  }

  if (!userId) {
    toast('User could not be found', true);
    return;
  }

  const { error } = await sb
    .from('customer_users')
    .insert({
      customer_id: customerId,
      user_id: userId,
      portal_role: 'user'
    });

  if (error) {
    toast('Could not link existing user: ' + error.message, true);
    return;
  }

  toast('Existing user linked');
  await loadCustomerUsers(customerId);
  clearCustomerPortalUserSearch();
  await loadCustomers();
}

function openEditCustomerModal(customerId) {
  const customer = customerList.find(row => String(row.id) === String(customerId));
  if (!customer) {
    toast('Customer could not be found', true);
    return;
  }

  editingCustomerId = customer.id;
  if (el('editCustomerCompanyName')) el('editCustomerCompanyName').value = customer.company_name || '';
  if (el('editCustomerBillingEmail')) el('editCustomerBillingEmail').value = customer.billing_email || '';
  if (el('editCustomerPhone')) el('editCustomerPhone').value = customer.phone || '';
  el('editCustomerModal')?.classList.remove('hidden');
}

function closeEditCustomerModal() {
  editingCustomerId = null;
  el('editCustomerModal')?.classList.add('hidden');
}

async function saveEditedCustomer() {
  if (!editingCustomerId) {
    toast('No customer selected', true);
    return;
  }

  const company_name = el('editCustomerCompanyName')?.value.trim() || null;
  const billing_email = el('editCustomerBillingEmail')?.value.trim().toLowerCase() || null;
  const phone = el('editCustomerPhone')?.value.trim() || null;

  if (!company_name) {
    toast('Customer company name is required', true);
    return;
  }

  const { error } = await sb
    .from('customers')
    .update({
      company_name,
      billing_email,
      phone
    })
    .eq('id', editingCustomerId);

  if (error) {
    toast('Could not update customer: ' + error.message, true);
    return;
  }

  toast('Customer updated');
  closeEditCustomerModal();
  await loadCustomers();
}

async function unlinkCustomerPortalUser(customerId, userId) {
  if (!customerId || !userId) {
    toast('Missing customer user link details', true);
    return;
  }

  const confirmed = window.confirm('Unlink this customer portal user?');
  if (!confirmed) return;

  const { error } = await sb
    .from('customer_users')
    .delete()
    .eq('customer_id', customerId)
    .eq('user_id', userId);

  if (error) {
    toast('Could not unlink customer portal user: ' + error.message, true);
    return;
  }

  toast('Customer portal user unlinked');
  await loadCustomers();
  await loadCustomerUsers(customerId);

  const activeSearchTerm = getCurrentCustomerPortalSearchTerm();
  if (String(el('customerPortalCustomerSelect')?.value || '') === String(customerId)) {
    await runUserSearch(activeSearchTerm);
  }
}


async function createCustomer() {
  const companyName = el('customerCompanyName')?.value.trim();
  const contactEmail = el('customerContactEmail')?.value.trim().toLowerCase();

  if (!companyName) {
    toast('Customer company name is required', true);
    return;
  }

  const { error } = await sb.from('customers').insert([{
    company_name: companyName,
    billing_email: contactEmail || null,
    phone: null,
    active: true
  }]);

  if (error) {
    toast('Could not create customer: ' + error.message, true);
    return;
  }

  toast('Customer created');

  el('customerCompanyName').value = '';
  el('customerContactEmail').value = '';

  await loadCustomers();
}


async function createCustomerPortalUser() {
  if (state.currentProfile?.role !== 'admin') {
    toast('Only admin staff can create customer portal users', true);
    return;
  }

  const customerId = el('customerPortalCustomerSelect')?.value;
  const fullName = el('customerPortalName')?.value.trim();
  const email = el('customerPortalEmail')?.value.trim().toLowerCase();
  const password = el('customerPortalPassword')?.value;
  const portalRole = 'user';

  if (!customerId) { toast('Select a customer first', true); return; }
  if (!fullName) { toast('Full name is required', true); return; }
  if (!email) { toast('Email is required', true); return; }
  if (!password || password.length < 8) { toast('Password must be at least 8 characters', true); return; }

  const { data: authData, error: authError } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: 'customer',
        customer_id: customerId
      }
    }
  });

  if (authError) { toast('Could not create portal login: ' + authError.message, true); return; }

  const userId = authData?.user?.id;
  if (!userId) { toast('Portal user created but no user id was returned', true); return; }

  const { error: profileError } = await sb.from('profiles').upsert([{
    id: userId,
    full_name: fullName,
    email,
    role: 'customer',
    active: true
  }]);

  if (profileError) { toast('Portal login created but profile save failed: ' + profileError.message, true); return; }

  const { error: linkError } = await sb.from('customer_users').insert([{
    user_id: userId,
    customer_id: customerId,
    portal_role: portalRole
  }]);

  if (linkError) { toast('Portal login created but customer link failed: ' + linkError.message, true); return; }

  toast('Customer portal login created');
  el('customerPortalName').value = '';
  el('customerPortalEmail').value = '';
  el('customerPortalPassword').value = '';
  await loadCustomers();
}

export function bindCustomerManagementEvents() {
  el('createCustomerBtn')?.addEventListener('click', createCustomer);
  el('createCustomerPortalUserBtn')?.addEventListener('click', createCustomerPortalUser);
  el('reloadCustomersBtn')?.addEventListener('click', loadCustomers);
  el('customerPortalCustomerSelect')?.addEventListener('change', async () => {
    const selectedCustomerId = el('customerPortalCustomerSelect')?.value || '';
    await loadCustomerUsers(selectedCustomerId);
    const activeSearchTerm = getCurrentCustomerPortalSearchTerm();
    if (activeSearchTerm || customerPortalUserSearchResults.length) {
      await runUserSearch(activeSearchTerm);
      return;
    }
    renderCustomerPortalUserSearchResults();
  });
  el('customerPortalUserSearch')?.addEventListener('input', evt => {
    runUserSearch(evt.target.value);
  });
  el('closeEditCustomerBtn')?.addEventListener('click', closeEditCustomerModal);
  el('cancelEditCustomerBtn')?.addEventListener('click', closeEditCustomerModal);
  el('saveEditCustomerBtn')?.addEventListener('click', saveEditedCustomer);
  el('editCustomerModal')?.addEventListener('click', evt => {
    if (evt.target === el('editCustomerModal')) closeEditCustomerModal();
  });

  document.addEventListener('click', evt => {
    const editBtn = evt.target.closest('.edit-customer-btn');
    if (editBtn) {
      openEditCustomerModal(editBtn.getAttribute('data-customer-id'));
      return;
    }

    const unlinkBtn = evt.target.closest('.unlink-customer-user-btn');
    if (unlinkBtn) {
      unlinkCustomerPortalUser(
        unlinkBtn.getAttribute('data-customer-id'),
        unlinkBtn.getAttribute('data-user-id')
      );
      return;
    }

    const linkBtn = evt.target.closest('.link-existing-customer-user-btn');
    if (linkBtn) {
      linkExistingCustomerUser(linkBtn.getAttribute('data-user-id'));
      return;
    }

    if (!evt.target.closest('.customer-user-search-wrap')) {
      customerPortalUserSearchResults = [];
      renderCustomerPortalUserSearchResults();
    }
  });
}
