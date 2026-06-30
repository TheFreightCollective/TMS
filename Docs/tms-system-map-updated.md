# TFC TMS SYSTEM MAP (UPDATED – VEHICLE-FIRST MODEL)

## OVERVIEW
This document reflects the corrected fleet-based design:
Jobs are assigned to vehicles. Drivers are assigned to vehicles.
Drivers see jobs via the vehicle they are currently assigned to.

---

# CORE MODEL (CRITICAL)

Job → Vehicle
Vehicle → Driver
Driver sees jobs via vehicle

Rules:
- Jobs NEVER belong directly to drivers
- Drivers can change vehicles without reassigning jobs
- Vehicles are the operational resource

---

# BACKEND STRUCTURE

## jobs
Main job record
- customer
- pickup/delivery
- totals
- status

---

## job_allocations (UPDATED)
Primary allocation table

Fields:
- job_id
- leg_type
- vehicle_id ✅ PRIMARY
- driver_id ⚠️ transitional only
- is_current

RULE:
Vehicle is the ONLY required assignment

---

## vehicle_driver_assignments ✅ NEW

Fields:
- vehicle_id
- driver_id
- assigned_from
- assigned_to
- is_current

Purpose:
Defines which driver is currently operating a vehicle

---

## DRIVER JOB VISIBILITY

Drivers see jobs using:
vehicle_driver_assignments → job_allocations → jobs

---

# FRONTEND STRUCTURE

## SIDEBAR UPDATE
Rename:
Staff & Drivers → Resources

---

## RESOURCES SECTION

### Vehicles
- create vehicle
- edit vehicle
- view capacity

### Drivers
- existing functionality

### Vehicle Assignments (NEW)
- assign driver to vehicle
- change active driver
- show current assignment

---

## ALLOCATION BOARD

CURRENT:
driver-first

TARGET:
vehicle-first

Rules:
- select vehicle first
- driver optional / secondary

---

## DRIVER PANEL

CURRENT:
jobs via driver_id

TARGET:
jobs via vehicle assignment

---

# FLOW

1. Create job
2. Assign vehicle
3. Assign driver to vehicle
4. Driver sees vehicle jobs
5. Driver completes job

---

# CRITICAL RULES

- NEVER assign jobs directly to drivers
- ALWAYS assign vehicles first
- Drivers are linked only through vehicles

---

# NEXT CODE SESSION TASKS

- Update allocation UI to vehicle-first
- Add vehicle management UI
- Add vehicle_driver_assignments UI
- Update driver queries to use vehicle linkage

---

System is now fleet-based and ready for real-world ops.
