import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast } from '../core/utils.js';
import { loadCustomerContext } from '../modules/customers.js';
import { bindNavEvents, showAppShell, showLoginScreen, updateSidebarUser, navigateTo } from '../modules/nav.js';
import { bindCommonUiEvents } from '../modules/ui.js';
import { bindFreightEvents, resetBookingItems } from '../modules/freightItems.js';
import { bindAddressEvents, loadPostcodes, initInlineSuburbSearch, loadAllAddresses, initAddressDropdowns } from '../modules/addresses.js';
import { bindChangePasswordEvents } from '../modules/userSettings.js';
import { bindCustomerBookingEvents } from '../modules/customerBooking.js';
import { bindCustomerJobsEvents, loadCustomerJobs } from '../modules/customerJobs.js';

let hasBootstrappedOnce = false;

async function denyAccess(message) {
  toast(message, true);
  showLoginScreen();
  try {
    await sb.auth.signOut();
  } catch (err) {
    console.error('Sign out failed:', err);
  }
}

function bindCustomerAuthEvents() {
  el('loginBtn')?.addEventListener('click', async evt => {
    evt.preventDefault();
    const email = (el('email')?.value || '').trim().toLowerCase();
    const password = el('password')?.value || '';
    if (!email) { toast('Enter your email address', true); return; }
    if (!password) { toast('Enter your password', true); return; }

    const res = await sb.auth.signInWithPassword({ email, password });
    if (res.error) {
      toast(res.error.message, true);
      return;
    }
    toast('Logged in');
  });

  el('logoutBtn')?.addEventListener('click', async () => {
    const res = await sb.auth.signOut();
    if (res.error) {
      toast(res.error.message, true);
      return;
    }
    showLoginScreen();
    toast('Logged out');
  });

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_IN' && session?.user) {
      if (hasBootstrappedOnce && session.user.id === state.currentUser?.id) return;
      setTimeout(() => bootstrapCustomerUser(session.user), 0);
    }
    if (event === 'SIGNED_OUT') {
      hasBootstrappedOnce = false;
      setTimeout(() => bootstrapCustomerUser(null), 0);
    }
  });
}

async function bootstrapCustomerUser(user) {
  state.currentUser = user;
  state.currentProfile = null;
  state.currentDriver = null;
  state.currentCustomerId = null;

  if (!user) {
    hasBootstrappedOnce = false;
    showLoginScreen();
    return;
  }

  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) {
    console.error('Profile load error:', error);
  }
  state.currentProfile = data || { role: null };

  if (state.currentProfile.role !== 'customer') {
    await denyAccess('Customer portal access only.');
    return;
  }

  await loadCustomerContext();
  if (!state.currentCustomerId) {
    await denyAccess('Customer account is not linked correctly.');
    return;
  }

  showAppShell();
  updateSidebarUser(state.currentProfile);
  if (!hasBootstrappedOnce) {
    navigateTo('dashboard');
    hasBootstrappedOnce = true;
  }

  initInlineSuburbSearch('pickupSuburb', 'pickup');
  initInlineSuburbSearch('deliverySuburb', 'delivery');
  await loadPostcodes();
  await loadAllAddresses();
  initAddressDropdowns();
  await loadCustomerJobs();
}

async function refreshFromAuth() {
  const res = await sb.auth.getUser();
  await bootstrapCustomerUser(res.data ? res.data.user : null);
}

function initCustomerApp() {
  bindNavEvents();
  bindCommonUiEvents();
  bindCustomerAuthEvents();
  bindFreightEvents();
  bindAddressEvents();
  bindChangePasswordEvents();
  bindCustomerBookingEvents();
  bindCustomerJobsEvents();
  resetBookingItems();
  refreshFromAuth();
}

initCustomerApp();