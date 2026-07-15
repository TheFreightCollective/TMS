import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast } from '../core/utils.js';

function getPasswordValue(id) {
  return el(id)?.value || '';
}

function clearPasswordFields() {
  if (el('newPassword')) el('newPassword').value = '';
  if (el('confirmPassword')) el('confirmPassword').value = '';
}

async function getCurrentUser() {
  if (state.currentUser?.id) return state.currentUser;
  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  return data?.user || null;
}

export async function updatePassword() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      toast('You must be logged in to change your password', true);
      return;
    }

    const newPassword = getPasswordValue('newPassword');
    const confirmPassword = getPasswordValue('confirmPassword');

    if (!newPassword || !confirmPassword) {
      toast('Enter and confirm your new password', true);
      return;
    }

    if (newPassword.length < 8) {
      toast('Password must be at least 8 characters', true);
      return;
    }

    if (newPassword !== confirmPassword) {
      toast('Passwords do not match', true);
      return;
    }

    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) {
      toast(error.message || 'Unable to update password', true);
      return;
    }

    clearPasswordFields();
    toast('Password updated');
  } catch (err) {
    toast(err?.message || 'Unable to update password', true);
  }
}

export function bindChangePasswordEvents() {
  el('updatePasswordBtn')?.addEventListener('click', updatePassword);
  window.updatePassword = updatePassword;
}