import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast } from '../core/utils.js';

export async function loadVehicles() {
  const { data, error } = await sb
    .from('vehicles')
    .select('id, vehicle_name, rego')
    .eq('active', true)
    .order('vehicle_name');

  if (error) {
    toast('Failed loading vehicles: ' + error.message, true);
    return;
  }

  state.vehicleOptions = data || [];

  renderVehicles();
}

function renderVehicles() {
  const tbody = document.getElementById('vehicleTableBody');
  if (!tbody) return;

  if (!state.vehicleOptions.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="muted">No vehicles</td></tr>';
    return;
  }

  tbody.innerHTML = state.vehicleOptions.map(v => `
    <tr>
      <td>${v.vehicle_name || '—'}</td>
      <td>${v.rego || '—'}</td>
    </tr>
  `).join('');
}

export function bindVehicleEvents() {

  document.getElementById('createVehicleBtn')?.addEventListener('click', async () => {

    const name = el('vehicleName').value;
    const rego = el('vehicleRego').value;

    if (!name) {
      toast('Vehicle name required', true);
      return;
    }

    const { error } = await sb.from('vehicles').insert({
      vehicle_name: name,
      rego: rego,
      active: true
    });

    if (error) {
      toast('Failed to create vehicle: ' + error.message, true);
      return;
    }

    toast('Vehicle added');

    el('vehicleName').value = '';
    el('vehicleRego').value = '';

    await loadVehicles();
  });
}