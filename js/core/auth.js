import { sb } from './supabaseClient.js';
import { state } from './state.js';
import { el, toast } from './utils.js';
import { renderRolePanels, updateHeader, toggleLoginUI } from '../modules/ui.js';
import { loadCustomerContext, loadCustomers } from '../modules/customers.js';
import { loadDriverContext, loadDrivers } from '../modules/drivers.js';
import { initInlineSuburbSearch, loadPostcodes, loadAllAddresses, initAddressDropdowns } from '../modules/addresses.js';
import { loadJobs, renderJobs } from '../modules/jobs.js';
import { renderStaffPanelForRole, loadStaff, loadDriversForManagement } from '../modules/staffManagement.js';
import { showAppShell, showLoginScreen, updateSidebarUser, navigateTo } from '../modules/nav.js';

export async function bootstrapUser(user) {
  state.currentUser = user;
  state.currentProfile = null;
  state.currentDriver = null;
  state.currentCustomerId = null;

  if (!user) {
    showLoginScreen();
    state.visibleJobs = [];
    renderJobs([]);
    return;
  }

  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  state.currentProfile = data || { role: null };
  const role = state.currentProfile?.role || null;

  showAppShell();
  updateSidebarUser(state.currentProfile);
  renderRolePanels();
  renderStaffPanelForRole(role);
  navigateTo('dashboard');

  try {
    if (role === 'customer') await loadCustomerContext();
    if (role === 'driver') await loadDriverContext();
    if (role === 'admin' || role === 'ops') {
      await loadCustomers();
      await loadDrivers();
      await loadDriversForManagement();
      if (role === 'admin') await loadStaff();
    }
    initInlineSuburbSearch('pickupSuburb', 'pickup');
    initInlineSuburbSearch('deliverySuburb', 'delivery');
    await loadPostcodes();
    await loadAllAddresses();
    initAddressDropdowns();
    await loadJobs();
  } catch (err) {
    console.error('Bootstrap error:', err);
  }
}

export async function refreshFromAuth() {
  const res = await sb.auth.getUser();
  await bootstrapUser(res.data ? res.data.user : null);
}

export async function login() {
  const emailEl = el('email'), passwordEl = el('password');
  const email = (emailEl?.value || '').trim().toLowerCase();
  const password = passwordEl?.value || '';
  if (!email) { toast('Enter your email address', true); emailEl?.focus(); return; }
  if (!password) { toast('Enter your password', true); passwordEl?.focus(); return; }
  try {
    const res = await sb.auth.signInWithPassword({ email, password });
    if (res.error) { toast(res.error.message, true); return; }
    const user = res.data ? (res.data.user || (res.data.session ? res.data.session.user : null)) : null;
    if (!user) { toast('No user returned after sign-in.', true); return; }
    toast('Logged in');
  } catch (err) {
    toast('Login failed: ' + (err?.message || err), true);
  }
}

export async function logout() {
  const res = await sb.auth.signOut();
  if (res.error) { toast(res.error.message, true); return; }
  await bootstrapUser(null);
  toast('Logged out');
}

export function bindAuthEvents() {
  el('loginBtn')?.addEventListener('click', async evt => { evt.preventDefault(); await login(); });
  el('logoutBtn')?.addEventListener('click', logout);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_IN' && session?.user) setTimeout(() => bootstrapUser(session.user), 0);
    if (event === 'SIGNED_OUT') setTimeout(() => bootstrapUser(null), 0);
  });
}