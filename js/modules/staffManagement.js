import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml } from '../core/utils.js';

// ─── State ────────────────────────────────────────────────────────────────────
let staffList = [];
let driverList = [];

// ─── Load ─────────────────────────────────────────────────────────────────────
export async function loadStaff() {
  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name, email, role, active, mobile')
    .in('role', ['ops', 'admin'])
    .order('full_name');
  if (error) { toast('Could not load staff: ' + error.message, true); return; }
  staffList = data || [];
  renderStaffTable();
}

export async function loadDriversForManagement() {
  const { data, error } = await sb
    .from('drivers')
    .select('id, full_name, mobile, licence_no, active, user_id')
    .order('full_name');
  if (error) { toast('Could not load drivers: ' + error.message, true); return; }
  driverList = data || [];
  renderDriversTable();
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderStaffTable() {
  const tbody = el('staffTableBody');
  if (!tbody) return;
  if (!staffList.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No ops/admin staff yet.</td></tr>';
    return;
  }
  tbody.innerHTML = staffList.map(s => `
    <tr>
      <td>${escapeHtml(s.full_name || '—')}</td>
      <td>${escapeHtml(s.email || '—')}</td>
      <td>${escapeHtml(s.role || '—')}</td>
      <td>${escapeHtml(s.mobile || '—')}</td>
      <td>
        <span class="chip ${s.active ? 'allocated' : 'pending_allocation'}">${s.active ? 'Active' : 'Inactive'}</span>
        <button type="button" class="secondary small toggle-staff-active-btn" data-staff-id="${escapeHtml(s.id)}" data-active="${s.active}"
          style="margin-left:8px;">${s.active ? 'Deactivate' : 'Activate'}</button>
      </td>
    </tr>`).join('');
}

function renderDriversTable() {
  const tbody = el('driverMgmtTableBody');
  if (!tbody) return;
  if (!driverList.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No drivers yet.</td></tr>';
    return;
  }
  tbody.innerHTML = driverList.map(d => `
    <tr>
      <td>${escapeHtml(d.full_name || '—')}</td>
      <td>${escapeHtml(d.mobile || '—')}</td>
      <td>${escapeHtml(d.licence_no || '—')}</td>
      <td>
        <span class="chip ${d.active ? 'allocated' : 'pending_allocation'}">${d.active ? 'Active' : 'Inactive'}</span>
        <button type="button" class="secondary small toggle-driver-active-btn" data-driver-id="${escapeHtml(d.id)}" data-active="${d.active}"
          style="margin-left:8px;">${d.active ? 'Deactivate' : 'Activate'}</button>
      </td>
      <td>${d.user_id ? '<span class="chip allocated">Linked</span>' : '<span class="chip pending_allocation">No login</span>'}</td>
    </tr>`).join('');
}

// ─── Add Staff ────────────────────────────────────────────────────────────────
function openAddStaffModal() {
  el('addStaffForm')?.reset();
  el('addStaffModal')?.classList.remove('hidden');
  el('staffFullName')?.focus();
}
function closeAddStaffModal() { el('addStaffModal')?.classList.add('hidden'); }

async function submitAddStaff() {
  const fullName = el('staffFullName')?.value.trim();
  const email = el('staffEmail')?.value.trim().toLowerCase();
  const mobile = el('staffMobile')?.value.trim();
  const role = el('staffRole')?.value;
  const password = el('staffPassword')?.value;

  if (!fullName) { toast('Full name is required', true); return; }
  if (!email) { toast('Email is required', true); return; }
  if (!password || password.length < 8) { toast('Password must be at least 8 characters', true); return; }
  if (!role) { toast('Select a role', true); return; }

  // Create auth user via Supabase Admin (requires service role — handled via RPC or admin function)
  // For now we use signUp, which sends a confirmation email. For internal staff you may want
  // to use an admin RPC that bypasses email confirmation. Adjust as needed.
  const { data: authData, error: authError } = await sb.auth.signUp({
  email,
  password,
  options: {
    data: { full_name: fullName, role: role }  // role now passed here
  }
});
  if (authError) { toast('Could not create login: ' + authError.message, true); return; }

  const userId = authData?.user?.id;
  if (!userId) { toast('User created but no ID returned. Check Supabase.', true); return; }

  // Upsert profile row
  const { error: profileError } = await sb.from('profiles').upsert([{
    id: userId,
    full_name: fullName,
    email,
    mobile: mobile || null,
    role,
    active: true
  }]);
  if (profileError) { toast('Login created but profile save failed: ' + profileError.message, true); return; }

  toast(`${role === 'admin' ? 'Admin' : 'Ops staff'} ${fullName} added. They will receive a confirmation email.`);
  closeAddStaffModal();
  await loadStaff();
}

// ─── Add Driver ───────────────────────────────────────────────────────────────
function openAddDriverModal() {
  el('addDriverForm')?.reset();
  el('addDriverModal')?.classList.remove('hidden');
  el('driverFullName')?.focus();
}
function closeAddDriverModal() { el('addDriverModal')?.classList.add('hidden'); }

async function submitAddDriver() {
  const fullName = el('driverFullName')?.value.trim();
  const mobile = el('driverMobile')?.value.trim();
  const licenceNo = el('driverLicenceNo')?.value.trim();
  const email = el('driverEmail')?.value.trim().toLowerCase();
  const password = el('driverPassword')?.value;
  const createLogin = el('driverCreateLogin')?.checked;

  if (!fullName) { toast('Full name is required', true); return; }

  let userId = null;

  if (createLogin) {
    if (!email) { toast('Email is required to create a login', true); return; }
    if (!password || password.length < 8) { toast('Password must be at least 8 characters', true); return; }

    const { data: authData, error: authError } = await sb.auth.signUp({
  email,
  password,
  options: {
    data: { full_name: fullName, role: 'driver' }  // role now passed here
  }
});
    if (authError) { toast('Could not create login: ' + authError.message, true); return; }
    userId = authData?.user?.id || null;

    if (userId) {
      const { error: profileError } = await sb.from('profiles').upsert([{
        id: userId,
        full_name: fullName,
        email,
        mobile: mobile || null,
        role: 'driver',
        active: true
      }]);
      if (profileError) console.warn('Profile save failed:', profileError.message);
    }
  }

  // Insert driver record
  const { error: driverError } = await sb.from('drivers').insert([{
    full_name: fullName,
    mobile: mobile || null,
    licence_no: licenceNo || null,
    active: true,
    user_id: userId
  }]);
  if (driverError) { toast('Driver save failed: ' + driverError.message, true); return; }

  toast(`Driver ${fullName} added${createLogin ? '. They will receive a confirmation email.' : '.'}`);
  closeAddDriverModal();
  await loadDriversForManagement();
}

// ─── Toggle Active ────────────────────────────────────────────────────────────
async function toggleStaffActive(staffId, currentlyActive) {
  const { error } = await sb.from('profiles').update({ active: !currentlyActive }).eq('id', staffId);
  if (error) { toast('Could not update staff: ' + error.message, true); return; }
  toast(`Staff ${currentlyActive ? 'deactivated' : 'activated'}`);
  await loadStaff();
}

async function toggleDriverActive(driverId, currentlyActive) {
  const { error } = await sb.from('drivers').update({ active: !currentlyActive }).eq('id', driverId);
  if (error) { toast('Could not update driver: ' + error.message, true); return; }
  toast(`Driver ${currentlyActive ? 'deactivated' : 'activated'}`);
  await loadDriversForManagement();
}

// ─── Bind ─────────────────────────────────────────────────────────────────────
export function bindStaffManagementEvents() {
  // Open modals
  el('openAddStaffModalBtn')?.addEventListener('click', openAddStaffModal);
  el('openAddDriverModalBtn')?.addEventListener('click', openAddDriverModal);

  // Close modals
  el('cancelAddStaffBtn')?.addEventListener('click', closeAddStaffModal);
  el('cancelAddDriverBtn')?.addEventListener('click', closeAddDriverModal);

  // Submit
  el('submitAddStaffBtn')?.addEventListener('click', submitAddStaff);
  el('submitAddDriverBtn')?.addEventListener('click', submitAddDriver);

  // Toggle create-login checkbox on driver form
  el('driverCreateLogin')?.addEventListener('change', function () {
    el('driverLoginFields')?.classList.toggle('hidden', !this.checked);
  });

  // Reload buttons
  el('reloadStaffBtn')?.addEventListener('click', loadStaff);
  el('reloadDriverMgmtBtn')?.addEventListener('click', loadDriversForManagement);

  // Delegate: toggle active buttons
  document.addEventListener('click', async function (evt) {
    const staffBtn = evt.target.closest('.toggle-staff-active-btn');
    if (staffBtn) {
      await toggleStaffActive(staffBtn.getAttribute('data-staff-id'), staffBtn.getAttribute('data-active') === 'true');
    }
    const driverBtn = evt.target.closest('.toggle-driver-active-btn');
    if (driverBtn) {
      await toggleDriverActive(driverBtn.getAttribute('data-driver-id'), driverBtn.getAttribute('data-active') === 'true');
    }
  });
}

// Expose for bootstrapUser — ops can see driver tab only, admin sees both
export function renderStaffPanelForRole(role) {
  const staffPanel = el('staffMgmtPanel');
  if (!staffPanel) return;
  if (!['admin', 'ops'].includes(role)) { staffPanel.classList.add('hidden'); return; }
  staffPanel.classList.remove('hidden');

  // Ops can add/see drivers but not other ops/admin staff
  const staffSection = el('staffSection');
  if (staffSection) staffSection.classList.toggle('hidden', role !== 'admin');
}
