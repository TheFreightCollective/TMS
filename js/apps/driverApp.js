import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast } from '../core/utils.js';
import { loadDriverContext } from '../modules/drivers.js';
import { loadDriverJobs, renderDriverJobs, bindDriverJobEvents } from '../modules/driverJobs.js';
import { bindDriverProofEvents } from '../modules/driverProof.js';

function roleFromEmail(email){ const e = (email || '').toLowerCase(); return e.indexOf('driver@') === 0 ? 'driver' : null; }
function updateDriverHeader(){ const info = el('sessionInfo'); const loginSection = el('loginSection'); if(!state.currentUser){ if(info) info.textContent = 'Not logged in'; el('logoutBtn')?.classList.add('hidden'); el('driverPanel')?.classList.add('hidden'); if(loginSection) loginSection.style.display = 'block'; return; } el('logoutBtn')?.classList.remove('hidden'); if(info) info.textContent = state.currentUser.email || state.currentUser.id; if(loginSection) loginSection.style.display = 'none'; }
async function bootstrapDriverUser(user){ state.currentUser = user; state.currentProfile = null; state.currentDriver = null; if(!user){ updateDriverHeader(); renderDriverJobs([]); return; } const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle(); if(error) console.error('Profile load error:', error); state.currentProfile = data || { role: roleFromEmail(user.email) || null }; updateDriverHeader(); if(state.currentProfile.role !== 'driver'){ toast('This page is for drivers only.', true); el('driverPanel')?.classList.add('hidden'); renderDriverJobs([]); return; } el('driverPanel')?.classList.remove('hidden'); await loadDriverContext(); await loadDriverJobs(); }
async function refreshFromAuth(){ const res = await sb.auth.getUser(); await bootstrapDriverUser(res.data ? res.data.user : null); }
async function login(){ const email = (el('email')?.value || '').trim().toLowerCase(); const password = el('password')?.value || ''; if(!email){ toast('Enter your email address', true); return; } if(!password){ toast('Enter your password', true); return; } const res = await sb.auth.signInWithPassword({ email, password }); if(res.error){ toast(res.error.message, true); return; } toast('Logged in', false); }
async function logout(){ const res = await sb.auth.signOut(); if(res.error){ toast(res.error.message, true); return; } await bootstrapDriverUser(null); toast('Logged out', false); }
function bindDriverAuthEvents(){ el('loginBtn')?.addEventListener('click', async evt => { evt.preventDefault(); await login(); }); el('logoutBtn')?.addEventListener('click', logout); el('checkSessionBtn')?.addEventListener('click', refreshFromAuth); sb.auth.onAuthStateChange(function(event, session){ if(event === 'INITIAL_SESSION') return; if(event === 'SIGNED_IN' && session?.user) setTimeout(() => bootstrapDriverUser(session.user), 0); if(event === 'SIGNED_OUT') setTimeout(() => bootstrapDriverUser(null), 0); }); }
function initDriverApp(){ bindDriverAuthEvents(); bindDriverJobEvents(); bindDriverProofEvents(); refreshFromAuth(); }
initDriverApp();
