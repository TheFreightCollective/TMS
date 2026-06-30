import { el, toast } from '../core/utils.js';
import { state } from '../core/state.js';

const LOGO_STORAGE_KEY = 'tms.brandLogoDataUrl';

export function showJobCreatedModal(job){ const modal=el('job-created-modal'); const msg=el('jobCreatedMessage'); if(!modal||!msg){toast('Job created successfully');return;} const jobNumber=job?.job_number||''; msg.textContent=jobNumber?`Job #${jobNumber} has been created successfully.`:'Your job has been created successfully.'; modal.classList.remove('hidden'); }
export function closeJobCreatedModal(){ el('job-created-modal')?.classList.add('hidden'); }
export function scrollToJobs(){ const target=document.querySelector('.jobs-header')||el('jobsTableWrap'); if(target) target.scrollIntoView({behavior:'smooth',block:'start'}); }
export function toggleLoginUI(){ const loginPanel=el('loginPanel'); if(!loginPanel)return; loginPanel.style.display=state.currentUser?'none':'block'; }
export function resetPanels(){ ['customerPanel','opsPanel','driverPanel'].forEach(id=>el(id)?.classList.add('hidden')); el('logoutBtn')?.classList.toggle('hidden',!state.currentUser); const driverInfo=el('driverInfo'); if(driverInfo)driverInfo.textContent='Waiting for driver profile...'; const ops=el('opsDriversState'); if(ops)ops.textContent=state.driverOptions.length?`${state.driverOptions.length} drivers loaded.`:'Drivers not loaded yet.'; }
export function renderRolePanels(){ resetPanels(); const loginPanel=el('loginPanel'); if(!state.currentUser){loginPanel?.classList.remove('hidden'); el('jobsPanel')?.classList.add('hidden'); return;} loginPanel?.classList.add('hidden'); const role=state.currentProfile?.role; if(['customer','admin','ops'].includes(role)) el('customerPanel')?.classList.remove('hidden'); if(['admin','ops'].includes(role)) el('opsPanel')?.classList.remove('hidden'); if(role==='driver') el('driverPanel')?.classList.remove('hidden'); el('jobsPanel')?.classList.remove('hidden'); }
export function updateHeader(){ const info=el('sessionInfo'); if(!info)return; if(!state.currentUser){info.textContent='Not logged in'; el('logoutBtn')?.classList.add('hidden'); return;} el('logoutBtn')?.classList.remove('hidden'); info.textContent=`${state.currentProfile?.role||'loading'} • ${state.currentUser.email||state.currentUser.id}`; }

function openBrandModal(){ if (state.currentProfile?.role !== 'admin') { toast('Only admin staff can change the site logo', true); return; } el('brandModal')?.classList.remove('hidden'); }
function closeBrandModal(){ el('brandModal')?.classList.add('hidden'); }

function applyStoredBranding() {
  const storedLogo = localStorage.getItem(LOGO_STORAGE_KEY);
  if (!storedLogo) return;
  const siteLogo = el('siteLogo');
  if (siteLogo) siteLogo.src = storedLogo;
  const sidebarLogo = el('sidebarLogo');
  if (sidebarLogo) sidebarLogo.src = storedLogo;
  const loginLogo = el('loginBrandLogo');
  if (loginLogo) loginLogo.src = storedLogo;
}

async function uploadBrandLogo() {
  const fileInput = el('brandLogoInput');
  const file = fileInput?.files?.[0];
  if (!file) { toast('Select an image file first', true); return; }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    localStorage.setItem(LOGO_STORAGE_KEY, dataUrl);
    const siteLogo = el('siteLogo');
    if (siteLogo) siteLogo.src = dataUrl;
    const sidebarLogo = el('sidebarLogo');
    if (sidebarLogo) sidebarLogo.src = dataUrl;
    const loginLogo = el('loginBrandLogo');
    if (loginLogo) loginLogo.src = dataUrl;
    toast('Logo updated');
    closeBrandModal();
  };
  reader.readAsDataURL(file);
}

export function bindBrandingEvents(){
  applyStoredBranding();
  const brandingTarget = el('sidebarLogo') || el('siteLogo');
  brandingTarget?.addEventListener('click', openBrandModal);
  el('cancelBrandModalBtn')?.addEventListener('click', closeBrandModal);
  el('uploadBrandLogoBtn')?.addEventListener('click', uploadBrandLogo);
}

function applyResponsiveTableLabels() {
  document.querySelectorAll('table.jobs-table, table.items-table').forEach(table => {
    if (!table.dataset.labelsApplied) {
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(row => {
        row.querySelectorAll('td').forEach((cell, cellIndex) => {
          const label = headers[cellIndex] || `Column ${cellIndex + 1}`;
          cell.setAttribute('data-label', label);
        });
      });
      table.dataset.labelsApplied = 'true';
      table.classList.add('responsive-table');
    }
  });
}

export function bindCommonUiEvents(){
  applyResponsiveTableLabels();
  const observer = new MutationObserver(() => applyResponsiveTableLabels());
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click',evt=>{ const viewBtn=evt.target.closest('#viewCreatedJobBtn'); const closeBtn=evt.target.closest('#closeJobCreatedBtn'); if(viewBtn){evt.preventDefault(); closeJobCreatedModal(); scrollToJobs();} if(closeBtn){evt.preventDefault(); closeJobCreatedModal();} const timeBtn=evt.target.closest('.toggle-time-btn'); if(timeBtn){const wrap=el(timeBtn.getAttribute('data-target')); if(wrap){wrap.classList.toggle('hidden'); timeBtn.textContent=wrap.classList.contains('hidden')?'+ time':'remove';}} });
}
