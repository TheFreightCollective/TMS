import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml } from '../core/utils.js';

let customerList = [];
let customerUserLinks = [];

export async function loadCustomerContext() {
  const res = await sb.from('customer_users').select('customer_id, portal_role').eq('user_id', state.currentUser.id).limit(1).maybeSingle();
  if (res.error) { toast('Customer link failed: ' + res.error.message, true); return; }
  state.currentCustomerId = res.data ? res.data.customer_id : null;
  if (!state.currentCustomerId) toast('No customer linked for this user in public.customer_users.', true);
}

export async function loadCustomers() {
  let customerData = [];
  let customerError = null;

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

  const { data: linksData, error: linksError } = await sb.from('customer_users').select('customer_id, portal_role');
  if (linksError) { console.error(linksError); customerUserLinks = []; }
  else { customerUserLinks = linksData || []; }

  populateCustomerSelects();
  renderCustomersTable();
}

function populateCustomerSelects() {
  const bookingSelect = el('customerSelect');
  if (bookingSelect) {
    bookingSelect.innerHTML = '<option value="">Select customer...</option>';
    customerList.forEach(customer => {
      const option = document.createElement('option');
      option.value = customer.id;
      option.textContent = customer.company_name;
      bookingSelect.appendChild(option);
    });
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
  }
}

function renderCustomersTable() {
  const tbody = el('customerTableBody');
  if (!tbody) return;

  if (!customerList.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">No customers yet.</td></tr>';
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
      </tr>
    `;
  }).join('');
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
  const portalRole = el('customerPortalRoleSelect')?.value || 'warehouse';

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
  el('customerPortalRoleSelect').value = 'warehouse';
  await loadCustomers();
}

export function bindCustomerManagementEvents() {
  el('createCustomerBtn')?.addEventListener('click', createCustomer);
  el('createCustomerPortalUserBtn')?.addEventListener('click', createCustomerPortalUser);
  el('reloadCustomersBtn')?.addEventListener('click', loadCustomers);
}
