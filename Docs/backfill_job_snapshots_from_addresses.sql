-- Backfill nullable job snapshot columns from linked address-book rows
-- Safe defaults:
-- 1) The SELECT below is dry-run only.
-- 2) The UPDATE is commented out by default.
-- 3) Only NULL snapshot columns are filled.
-- 4) Jobs without pickup_address_id or delivery_address_id are untouched.

-- DRY RUN: inspect what would be backfilled
SELECT
  j.id,
  j.job_number,
  j.pickup_address_id,
  j.delivery_address_id,
  j.pickup_company_name AS current_pickup_company_name,
  ap.company_name AS candidate_pickup_company_name,
  j.pickup_contact_name AS current_pickup_contact_name,
  ap.contact_name AS candidate_pickup_contact_name,
  j.pickup_phone AS current_pickup_phone,
  ap.contact_phone AS candidate_pickup_phone,
  j.pickup_address_text AS current_pickup_address_text,
  ap.address_line AS candidate_pickup_address_text,
  j.pickup_suburb AS current_pickup_suburb,
  ap.suburb AS candidate_pickup_suburb,
  j.pickup_state AS current_pickup_state,
  ap.state AS candidate_pickup_state,
  j.pickup_postcode AS current_pickup_postcode,
  ap.postcode AS candidate_pickup_postcode,
  j.delivery_company_name AS current_delivery_company_name,
  ad.company_name AS candidate_delivery_company_name,
  j.delivery_contact_name AS current_delivery_contact_name,
  ad.contact_name AS candidate_delivery_contact_name,
  j.delivery_phone AS current_delivery_phone,
  ad.contact_phone AS candidate_delivery_phone,
  j.delivery_address_text AS current_delivery_address_text,
  ad.address_line AS candidate_delivery_address_text,
  j.delivery_suburb AS current_delivery_suburb,
  ad.suburb AS candidate_delivery_suburb,
  j.delivery_state AS current_delivery_state,
  ad.state AS candidate_delivery_state,
  j.delivery_postcode AS current_delivery_postcode,
  ad.postcode AS candidate_delivery_postcode
FROM jobs j
LEFT JOIN addresses ap ON ap.id = j.pickup_address_id
LEFT JOIN addresses ad ON ad.id = j.delivery_address_id
WHERE
  (
    j.pickup_address_id IS NOT NULL
    AND (
      j.pickup_company_name IS NULL
      OR j.pickup_contact_name IS NULL
      OR j.pickup_phone IS NULL
      OR j.pickup_address_text IS NULL
      OR j.pickup_suburb IS NULL
      OR j.pickup_state IS NULL
      OR j.pickup_postcode IS NULL
    )
  )
  OR
  (
    j.delivery_address_id IS NOT NULL
    AND (
      j.delivery_company_name IS NULL
      OR j.delivery_contact_name IS NULL
      OR j.delivery_phone IS NULL
      OR j.delivery_address_text IS NULL
      OR j.delivery_suburb IS NULL
      OR j.delivery_state IS NULL
      OR j.delivery_postcode IS NULL
    )
  )
ORDER BY j.created_at DESC;

-- APPLY BACKFILL: uncomment to run
/*
UPDATE jobs j
SET
  pickup_company_name = COALESCE(j.pickup_company_name, src.pickup_company_name),
  pickup_contact_name = COALESCE(j.pickup_contact_name, src.pickup_contact_name),
  pickup_phone = COALESCE(j.pickup_phone, src.pickup_phone),
  pickup_address_text = COALESCE(j.pickup_address_text, src.pickup_address_text),
  pickup_suburb = COALESCE(j.pickup_suburb, src.pickup_suburb),
  pickup_state = COALESCE(j.pickup_state, src.pickup_state),
  pickup_postcode = COALESCE(j.pickup_postcode, src.pickup_postcode),
  delivery_company_name = COALESCE(j.delivery_company_name, src.delivery_company_name),
  delivery_contact_name = COALESCE(j.delivery_contact_name, src.delivery_contact_name),
  delivery_phone = COALESCE(j.delivery_phone, src.delivery_phone),
  delivery_address_text = COALESCE(j.delivery_address_text, src.delivery_address_text),
  delivery_suburb = COALESCE(j.delivery_suburb, src.delivery_suburb),
  delivery_state = COALESCE(j.delivery_state, src.delivery_state),
  delivery_postcode = COALESCE(j.delivery_postcode, src.delivery_postcode)
FROM (
  SELECT
    j2.id AS job_id,
    ap.company_name AS pickup_company_name,
    ap.contact_name AS pickup_contact_name,
    ap.contact_phone AS pickup_phone,
    ap.address_line AS pickup_address_text,
    ap.suburb AS pickup_suburb,
    ap.state AS pickup_state,
    ap.postcode AS pickup_postcode,
    ad.company_name AS delivery_company_name,
    ad.contact_name AS delivery_contact_name,
    ad.contact_phone AS delivery_phone,
    ad.address_line AS delivery_address_text,
    ad.suburb AS delivery_suburb,
    ad.state AS delivery_state,
    ad.postcode AS delivery_postcode
  FROM jobs j2
  LEFT JOIN addresses ap ON ap.id = j2.pickup_address_id
  LEFT JOIN addresses ad ON ad.id = j2.delivery_address_id
) src
WHERE
  src.job_id = j.id
  AND (
    j.pickup_company_name IS NULL
    OR j.pickup_contact_name IS NULL
    OR j.pickup_phone IS NULL
    OR j.pickup_address_text IS NULL
    OR j.pickup_suburb IS NULL
    OR j.pickup_state IS NULL
    OR j.pickup_postcode IS NULL
    OR j.delivery_company_name IS NULL
    OR j.delivery_contact_name IS NULL
    OR j.delivery_phone IS NULL
    OR j.delivery_address_text IS NULL
    OR j.delivery_suburb IS NULL
    OR j.delivery_state IS NULL
    OR j.delivery_postcode IS NULL
  );
*/
