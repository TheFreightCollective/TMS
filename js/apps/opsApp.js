import { bindAuthEvents, refreshFromAuth } from '../core/auth.js';
import { bindCommonUiEvents } from '../modules/ui.js';
import { bindFreightEvents, resetBookingItems } from '../modules/freightItems.js';
import { bindAddressEvents } from '../modules/addresses.js';
import { bindJobEvents } from '../modules/jobs.js';
import { bindAllocationEvents } from '../modules/allocations.js';
import { bindEditJobEvents } from '../modules/editJob.js';
import { bindProofEvents } from '../modules/proof.js';
import { bindStaffManagementEvents } from '../modules/staffManagement.js';
import { bindCustomerManagementEvents } from '../modules/customers.js';
import { bindVehicleEvents } from '../modules/vehicles.js';
import { bindPodViewerEvents } from '../modules/podViewer.js';
import { bindNavEvents } from '../modules/nav.js';
import { bindBrandingEvents } from '../modules/ui.js';
import { bindInvoiceEvents } from '../modules/invoices.js';


function initOpsApp() {
  bindNavEvents();
  bindCommonUiEvents();
  bindAuthEvents();
  bindFreightEvents();
  bindAddressEvents();
  bindJobEvents();
  bindAllocationEvents();
  bindEditJobEvents();
  bindProofEvents();
  bindStaffManagementEvents();
  bindCustomerManagementEvents();
  bindVehicleEvents();
  bindBrandingEvents();
  bindPodViewerEvents();
  bindInvoiceEvents();
  resetBookingItems();
  refreshFromAuth();
}

initOpsApp();