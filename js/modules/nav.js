import { el } from '../core/utils.js';
import { state } from '../core/state.js';

const PAGE_TITLES = {
  dashboard:   { title: 'Dashboard',       subtitle: 'Overview of your operations' },
  jobs:        { title: 'Jobs',             subtitle: 'View, search and manage all jobs' },
  booking:     { title: 'Create Booking',   subtitle: 'Enter pickup and delivery details to create a new job' },
  'new-booking': { title: 'New Booking',    subtitle: 'Create a booking using your saved addresses' },
  'my-jobs':     { title: 'My Jobs',        subtitle: 'Track your active and completed jobs' },
  'saved-addresses': { title: 'Saved Addresses', subtitle: 'Manage reusable saved addresses' },
  account:     { title: 'Change Password',  subtitle: 'Update your login password' },
  allocation:  { title: 'Allocation Board', subtitle: 'Assign pickup and delivery drivers to jobs' },
  customers:   { title: 'Customers',        subtitle: 'Manage customer accounts and addresses' },
  contractors: { title: 'Contractors',      subtitle: 'Manage subcontractors and rates' },
  staff:       { title: 'Staff & Drivers',  subtitle: 'Add and manage ops staff and drivers' },
  invoices:    { title: 'Invoices',         subtitle: 'Create and manage invoices' },
  reports:     { title: 'Reports',          subtitle: 'Performance and operational reports' },
};

let currentSection = 'dashboard';

function getJobProgress(job) {
  if (job?.delivered_at) return 'delivered';
  if (job?.picked_up_at) return 'picked_up';
  if (job?.accepted_at) return 'accepted';
  return 'pending';
}

export function setMobileSidebarOpen(open) {
  const sidebar = el('sidebar');
  const backdrop = el('sidebarBackdrop');
  const toggle = el('mobileMenuToggle');
  if (sidebar) sidebar.classList.toggle('mobile-open', open);
  if (backdrop) backdrop.classList.toggle('hidden', !open);
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
}

export function closeMobileSidebar() {
  setMobileSidebarOpen(false);
}

export function navigateTo(section, jobFilter = null) {
  // Hide all sections
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const target = document.getElementById(`section-${section}`);
  if (!target) return;
  target.classList.remove('hidden');
  currentSection = section;

  // Highlight nav item
  const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (navItem) navItem.classList.add('active');

  closeMobileSidebar();

  // Update page header
  const meta = PAGE_TITLES[section] || { title: section, subtitle: '' };
  if (el('pageTitle')) el('pageTitle').textContent = meta.title;
  if (el('pageSubtitle')) el('pageSubtitle').textContent = meta.subtitle;

  // Apply job filter if navigating to jobs with a pre-set filter
  if (section === 'jobs' && jobFilter) {
    setTimeout(() => applyJobFilterButton(jobFilter), 0);
  }
}

export function applyJobFilterButton(filter) {
  // Update active filter button in jobs section
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('filter-btn-active', btn.getAttribute('data-job-filter') === filter);
  });
  // Trigger the jobs filter via state
  state.currentFilter = filter === 'all' ? 'all'
    : filter === 'pending_allocation' ? 'unallocated'
    : filter === 'allocated' ? 'allocated'
    : filter === 'in_progress' ? 'in_progress'
    : filter === 'completed' ? 'completed'
    : 'all';

  import('../modules/jobs.js').then(({ applyFilters }) => applyFilters());
}

export function updateDashboardStats(jobs) {
  const today = new Date().toISOString().slice(0, 10);
  const all = jobs || [];
  const newCount = all.filter(j => !j.pickup_driver_id || !j.delivery_driver_id).length;
  const allocatedCount = all.filter(j => j.pickup_driver_id && j.delivery_driver_id && getJobStatus(j) === 'allocated').length;
  const inProgressCount = all.filter(j => getJobStatus(j) === 'in_progress').length;
  const completedToday = all.filter(j => j.delivered_at && String(j.delivered_at).slice(0, 10) === today).length;

  if (el('statNew')) el('statNew').textContent = newCount;
  if (el('statAllocated')) el('statAllocated').textContent = allocatedCount;
  if (el('statInProgress')) el('statInProgress').textContent = inProgressCount;
  if (el('statCompleted')) el('statCompleted').textContent = completedToday;

  // Recent jobs list (last 5)
  const recent = [...all].slice(0, 5);
  const dashRecent = el('dashRecentJobs');
  if (dashRecent) {
    if (!recent.length) {
      dashRecent.innerHTML = '<p class="muted">No jobs yet.</p>';
    } else {
      dashRecent.innerHTML = `<table class="jobs-table" style="margin-top:4px;">
        <thead><tr><th>Job</th><th>Customer</th><th>Status</th><th>Pickup</th></tr></thead>
        <tbody>${recent.map(j => `
          <tr style="cursor:pointer;" onclick="window.__navTo('jobs')">
            <td><strong>#${j.job_number || '—'}</strong></td>
            <td>${j.customer_name || '—'}</td>
            <td><span class="chip ${getJobStatus(j)}">${getJobStatus(j).replace(/_/g, ' ')}</span></td>
            <td>${j.pickup_date ? new Date(j.pickup_date).toLocaleDateString('en-AU', { day:'numeric', month:'short' }) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    }
  }
}

function getJobStatus(job) {
  const progress = getJobProgress(job);
  const status = String(job?.status || '').toLowerCase();
  if (progress === 'delivered' || status === 'delivered') return 'completed';
  if (['accepted', 'picked_up'].includes(progress) || ['accepted', 'en_route_delivery', 'en_route_pickup', 'in_progress'].includes(status)) return 'in_progress';
  if (job?.pickup_driver_id && job?.delivery_driver_id) return 'allocated';
  return 'pending_allocation';
}

export function updateSidebarUser(profile) {
  if (!profile) return;
  const name = profile.full_name || profile.email || '—';
  const role = profile.role || '—';
  if (el('sidebarName')) el('sidebarName').textContent = name;
  if (el('sidebarRole')) el('sidebarRole').textContent = role.charAt(0).toUpperCase() + role.slice(1);
  if (el('sidebarAvatar')) el('sidebarAvatar').textContent = name.charAt(0).toUpperCase();

  // Show staff nav item for admin only
  document.querySelectorAll('.admin-only').forEach(item => {
    item.classList.toggle('hidden', role !== 'admin');
  });
}

export function showAppShell() {
  el('loginScreen')?.classList.add('hidden');
  el('appShell')?.classList.remove('hidden');
}

export function showLoginScreen() {
  el('appShell')?.classList.add('hidden');
  el('loginScreen')?.classList.remove('hidden');
  // Reset to dashboard for next login
  currentSection = 'dashboard';
}

export function bindNavEvents() {
  // Sidebar nav clicks
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.getAttribute('data-section');
      if (section) navigateTo(section);
    });
  });

  el('mobileMenuToggle')?.addEventListener('click', () => {
    const sidebar = el('sidebar');
    const open = sidebar?.classList.contains('mobile-open');
    setMobileSidebarOpen(!open);
  });

  el('sidebarBackdrop')?.addEventListener('click', closeMobileSidebar);

  // Job filter buttons
  document.addEventListener('click', evt => {
    const filterBtn = evt.target.closest('.filter-btn');
    if (filterBtn) {
      const filter = filterBtn.getAttribute('data-job-filter');
      if (filter) applyJobFilterButton(filter);
    }

    // Dashboard stat cards and quick action buttons
    const navBtn = evt.target.closest('[data-nav]');
    if (navBtn) {
      const section = navBtn.getAttribute('data-nav');
      const filter = navBtn.getAttribute('data-filter');
      if (section) navigateTo(section, filter || null);
    }
  });

  // "View jobs" button after creating a job
  el('viewCreatedJobBtn')?.addEventListener('click', () => {
    el('job-created-modal')?.classList.add('hidden');
    navigateTo('jobs');
  });

  // Global nav helper used by dashboard table rows
  window.__navTo = navigateTo;
}