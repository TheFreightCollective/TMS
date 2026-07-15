import { sb } from '../core/supabaseClient.js';
import { state } from '../core/state.js';
import { el, toast, escapeHtml } from '../core/utils.js';

let currentAssignments = [];

export async function loadVehicles() {
  const [vehiclesRes, assignmentsRes] = await Promise.all([
    sb
      .from('vehicles')
      .select('id, vehicle_name, rego')
      .eq('active', true)
      .order('vehicle_name'),
    sb
      .from('vehicle_driver_assignments')
      .select('id, vehicle_id, driver_id, is_current, assigned_from')
      .eq('is_current', true)
      .order('assigned_from', { ascending: false })
  ]);

  const { data, error } = vehiclesRes;

  if (error) {
    toast('Failed loading vehicles: ' + error.message, true);
    return;
  }

  if (assignmentsRes.error) {
    toast('Failed loading vehicle assignments: ' + assignmentsRes.error.message, true);
    return;
  }

  state.vehicleOptions = data || [];
  currentAssignments = assignmentsRes.data || [];

  if (!state.driverOptions?.length) {
    const driversRes = await sb
      .from('drivers')
      .select('id, full_name, active')
      .eq('active', true)
      .order('full_name', { ascending: true });
    if (!driversRes.error) {
      state.driverOptions = driversRes.data || [];
    }
  }

  renderVehicles();
}

function renderVehicles() {
  const tbody = document.getElementById('vehicleTableBody');
  if (!tbody) return;

  if (!state.vehicleOptions.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No vehicles</td></tr>';
    return;
  }

  const assignmentByVehicle = new Map();
  for (const assignment of currentAssignments) {
    if (!assignmentByVehicle.has(assignment.vehicle_id)) {
      assignmentByVehicle.set(assignment.vehicle_id, assignment);
    }
  }

  const driverNameById = new Map((state.driverOptions || []).map(d => [String(d.id), d.full_name || '—']));

  tbody.innerHTML = state.vehicleOptions.map(v => `
    <tr>
      <td>${escapeHtml(v.vehicle_name || '—')}</td>
      <td>${escapeHtml(v.rego || '—')}</td>
      <td>${escapeHtml(getCurrentDriverName(v.id, assignmentByVehicle, driverNameById))}</td>
      <td>
        <select class="vehicle-driver-select" data-vehicle-id="${escapeHtml(v.id)}">
          ${driverOptionsMarkup(assignmentByVehicle.get(v.id)?.driver_id || null)}
        </select>
      </td>
      <td style="text-align:right;">
        <button type="button" class="inline-btn small save-vehicle-driver-btn" data-vehicle-id="${escapeHtml(v.id)}">Save</button>
      </td>
    </tr>
  `).join('');
}

function driverOptionsMarkup(selectedDriverId) {
  const selected = selectedDriverId == null ? '' : String(selectedDriverId);
  return ['<option value="">Unassigned</option>']
    .concat(
      (state.driverOptions || []).map(d => {
        const id = String(d.id);
        return `<option value="${escapeHtml(d.id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(d.full_name || 'Driver')}</option>`;
      })
    ).join('');
}

function getCurrentDriverName(vehicleId, assignmentByVehicle, driverNameById) {
  const current = assignmentByVehicle.get(vehicleId);
  if (!current?.driver_id) return 'Unassigned';
  return driverNameById.get(String(current.driver_id)) || 'Assigned';
}

async function saveVehicleAssignment(vehicleId, driverId) {
  const nowIso = new Date().toISOString();

  const { error: closeError } = await sb
    .from('vehicle_driver_assignments')
    .update({ is_current: false, assigned_to: nowIso })
    .eq('vehicle_id', vehicleId)
    .eq('is_current', true);

  if (closeError) {
    toast('Failed to update assignment: ' + closeError.message, true);
    return;
  }

  if (driverId) {
    const { error: insertError } = await sb
      .from('vehicle_driver_assignments')
      .insert({
        vehicle_id: vehicleId,
        driver_id: driverId,
        assigned_from: nowIso,
        is_current: true
      });

    if (insertError) {
      toast('Failed to save assignment: ' + insertError.message, true);
      return;
    }
  }

  toast('Vehicle assignment updated');
  await loadVehicles();
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

  document.getElementById('reloadVehiclesBtn')?.addEventListener('click', loadVehicles);

  document.addEventListener('click', async (evt) => {
    const saveBtn = evt.target.closest('.save-vehicle-driver-btn');
    if (!saveBtn) return;

    const vehicleId = saveBtn.getAttribute('data-vehicle-id');
    const select = document.querySelector(`.vehicle-driver-select[data-vehicle-id="${vehicleId}"]`);
    const driverId = select?.value || null;

    if (!vehicleId) return;

    await saveVehicleAssignment(vehicleId, driverId);
  });
}