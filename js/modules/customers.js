import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast } from '../core/utils.js';
export async function loadCustomerContext(){ const res=await sb.from('customer_users').select('customer_id, portal_role').eq('user_id',state.currentUser.id).limit(1).maybeSingle(); if(res.error){toast('Customer link failed: '+res.error.message,true);return;} state.currentCustomerId=res.data?res.data.customer_id:null; if(!state.currentCustomerId)toast('No customer linked for this user in public.customer_users.',true); }
export async function loadCustomers(){ const {data,error}=await sb.from('customers').select('id, company_name').order('company_name'); if(error){console.error(error);return;} const select=el('customerSelect'); if(!select)return; select.innerHTML='<option value="">Select customer...</option>'; (data||[]).forEach(c=>{const opt=document.createElement('option'); opt.value=c.id; opt.textContent=c.company_name; select.appendChild(opt);}); }
