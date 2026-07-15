import { sb } from '../core/supabaseClient.js';
import { escapeHtml } from '../core/utils.js';

function normalizeProofType(event) {
  return String(event?.proof_type || '').toLowerCase();
}

function eventSortValue(event) {
  const value = Date.parse(event?.event_at || '');
  return Number.isFinite(value) ? value : 0;
}

function latestProofByType(events) {
  const latest = new Map();
  for (const event of events || []) {
    const type = normalizeProofType(event);
    if (type !== 'pickup' && type !== 'delivery') continue;
    const existing = latest.get(type);
    if (!existing || eventSortValue(event) > eventSortValue(existing)) {
      latest.set(type, event);
    }
  }
  return {
    pickup: latest.get('pickup') || null,
    delivery: latest.get('delivery') || null
  };
}

function formatPodDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const parts = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).formatToParts(date);

  const byType = {};
  for (const part of parts) {
    byType[part.type] = part.value;
  }

  const day = byType.day || '00';
  const month = byType.month || '—';
  const year = byType.year || '0000';
  const hour = byType.hour || '00';
  const minute = byType.minute || '00';
  const dayPeriod = String(byType.dayPeriod || '').toLowerCase();
  return `${day} ${month} ${year}, ${hour}:${minute} ${dayPeriod}`;
}

function toUpperLocation(suburb, state, postcode) {
  return [suburb, state, postcode]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toUpperCase() || '—';
}

function formatCubic(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.000';
  return n.toFixed(3);
}

function formatWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return n.toFixed(1);
}

function truncateWithEllipsis(text, maxLength) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trimEnd()}...`;
}

function getSignedFileUrlMap(files) {
  const grouped = new Map();
  for (const file of files || []) {
    const bucket = file.bucket_name || 'pod-files';
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(file);
  }

  return Promise.all(
    [...grouped.entries()].map(async ([bucket, bucketFiles]) => {
      const paths = bucketFiles.map(file => file.object_path).filter(Boolean);
      if (!paths.length) return { bucket, entries: [] };

      const { data } = await sb.storage.from(bucket).createSignedUrls(paths, 60 * 30);
      const dataByPath = new Map((data || []).map(row => [row.path, row.signedUrl || null]));
      const entries = bucketFiles.map(file => ({
        key: `${bucket}::${file.object_path}`,
        signedUrl: dataByPath.get(file.object_path) || null
      }));
      return { bucket, entries };
    })
  ).then(groups => {
    const urlMap = new Map();
    for (const group of groups) {
      for (const entry of group.entries) {
        urlMap.set(entry.key, entry.signedUrl);
      }
    }
    return urlMap;
  });
}

function getFileUrl(urlMap, file) {
  const bucket = file.bucket_name || 'pod-files';
  const key = `${bucket}::${file.object_path}`;
  return urlMap.get(key) || null;
}

function groupProofFilesByEvent(files) {
  const grouped = new Map();
  for (const file of files || []) {
    const eventId = file.proof_event_id;
    if (!grouped.has(eventId)) grouped.set(eventId, []);
    grouped.get(eventId).push(file);
  }
  return grouped;
}

function buildFreightRows(consignmentItems) {
  const rows = (consignmentItems || []).map(item => {
    const qty = Number(item.qty);
    const weight = Number(item.weight_kg);
    const lineWeight = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(weight) ? weight : 0);
    return {
      description: item.description || '—',
      item_type: item.item_type || '—',
      cubic_m3: Number(item.cubic_m3) || 0,
      line_weight_kg: lineWeight
    };
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.cubic += Number(row.cubic_m3) || 0;
      acc.weight += Number(row.line_weight_kg) || 0;
      return acc;
    },
    { cubic: 0, weight: 0 }
  );

  return {
    rows,
    totals
  };
}

export async function loadPodDocumentData({ jobId, customerId = null }) {
  if (!jobId) {
    return { error: 'Missing job id.' };
  }

  let jobQuery = sb
    .from('jobs')
    .select('id, customer_id, job_number, customer_reference, pickup_company_name, pickup_address_text, pickup_suburb, pickup_state, pickup_postcode, delivery_company_name, delivery_address_text, delivery_suburb, delivery_state, delivery_postcode')
    .eq('id', jobId);

  if (customerId) {
    jobQuery = jobQuery.eq('customer_id', customerId);
  }

  const { data: job, error: jobError } = await jobQuery.maybeSingle();
  if (jobError) return { error: jobError.message };
  if (!job) return { error: 'Job not found or access denied.' };

  const { data: customer } = await sb
    .from('customers')
    .select('company_name')
    .eq('id', job.customer_id)
    .maybeSingle();

  const { data: consignments, error: consignmentError } = await sb
    .from('consignments')
    .select('id')
    .eq('job_id', job.id);
  if (consignmentError) return { error: consignmentError.message };

  const consignmentIds = (consignments || []).map(row => row.id);
  let consignmentItems = [];
  if (consignmentIds.length) {
    const { data: items, error: itemsError } = await sb
      .from('consignment_items')
      .select('consignment_id, description, item_type, qty, cubic_m3, weight_kg')
      .in('consignment_id', consignmentIds)
      .order('created_at', { ascending: true });

    if (itemsError) return { error: itemsError.message };
    consignmentItems = items || [];
  }

  const { data: proofEvents, error: proofEventsError } = await sb
    .from('proof_events')
    .select('id, job_id, stop_id, proof_type, signed_name, notes, event_at')
    .eq('job_id', job.id)
    .order('event_at', { ascending: true });
  if (proofEventsError) return { error: proofEventsError.message };

  const latestProofs = latestProofByType(proofEvents || []);
  const selectedEvents = [latestProofs.pickup, latestProofs.delivery].filter(Boolean);
  const selectedEventIds = selectedEvents.map(event => event.id);

  let proofFiles = [];
  if (selectedEventIds.length) {
    const { data: files, error: filesError } = await sb
      .from('proof_files')
      .select('proof_event_id, bucket_name, object_path, mime_type, created_at')
      .in('proof_event_id', selectedEventIds)
      .order('created_at', { ascending: true });
    if (filesError) return { error: filesError.message };
    proofFiles = files || [];
  }

  const urlMap = await getSignedFileUrlMap(proofFiles);
  const filesByEvent = groupProofFilesByEvent(proofFiles);

  const withAssets = event => {
    if (!event) return null;
    const files = filesByEvent.get(event.id) || [];
    const signature = files.find(file => String(file.object_path || '').toLowerCase().includes('signature')) || null;
    const photos = files.filter(file => {
      const mime = String(file.mime_type || '').toLowerCase();
      const path = String(file.object_path || '').toLowerCase();
      return mime.startsWith('image/') && !path.includes('signature');
    });

    return {
      ...event,
      signature: signature
        ? {
            ...signature,
            url: getFileUrl(urlMap, signature)
          }
        : null,
      photos: photos.map(photo => ({
        ...photo,
        url: getFileUrl(urlMap, photo)
      })).filter(photo => photo.url)
    };
  };

  const freight = buildFreightRows(consignmentItems);
  return {
    error: null,
    generatedAt: new Date().toISOString(),
    job: {
      id: job.id,
      job_number: job.job_number,
      customer_reference: job.customer_reference,
      customer_company_name: customer?.company_name || '—',
      pickup_company_name: job.pickup_company_name || '—',
      pickup_address_text: job.pickup_address_text || '—',
      pickup_location_line: toUpperLocation(job.pickup_suburb, job.pickup_state, job.pickup_postcode),
      delivery_company_name: job.delivery_company_name || '—',
      delivery_address_text: job.delivery_address_text || '—',
      delivery_location_line: toUpperLocation(job.delivery_suburb, job.delivery_state, job.delivery_postcode)
    },
    proofs: {
      pickup: withAssets(latestProofs.pickup),
      delivery: withAssets(latestProofs.delivery)
    },
    freight
  };
}

function headerSuffix(proofs) {
  const hasPickup = Boolean(proofs?.pickup);
  const hasDelivery = Boolean(proofs?.delivery);
  if (!hasPickup && !hasDelivery) return ' (No proof captured)';
  if (hasPickup && !hasDelivery) return ' (Pending Delivery)';
  return '';
}

function renderNotesBlock(notes, keyBase, interactive = true) {
  const value = String(notes || '').trim();
  if (!value) {
    return '<div class="pod-proof-text">—</div>';
  }

  const short = truncateWithEllipsis(value, 220);
  const isTruncated = short !== value;
  if (!isTruncated) {
    return `<div class="pod-proof-text" title="${escapeHtml(value)}">${escapeHtml(value)}</div>`;
  }

  const shortId = `${keyBase}-short`;
  const fullId = `${keyBase}-full`;

  return `
    <div class="pod-notes-wrap" title="${escapeHtml(value)}">
      <div id="${escapeHtml(shortId)}" class="pod-proof-text">${escapeHtml(short)}</div>
      <div id="${escapeHtml(fullId)}" class="pod-proof-text hidden">${escapeHtml(value)}</div>
      ${interactive ? `<button type="button" class="pod-inline-toggle no-print" data-short-id="${escapeHtml(shortId)}" data-full-id="${escapeHtml(fullId)}">Show full notes</button>` : ''}
    </div>
  `;
}

function renderPhotosBlock(photos, keyBase, interactive = true) {
  const allPhotos = photos || [];
  if (!allPhotos.length) {
    return '<div class="pod-proof-text">No photos recorded</div>';
  }

  const visible = allPhotos.slice(0, 4);
  const extra = allPhotos.slice(4);
  const group = `${keyBase}-photos`;

  const renderThumb = (photo, extraClass = '') => `
    <a class="pod-photo-link ${extraClass}" data-photo-group="${escapeHtml(group)}" href="${escapeHtml(photo.url)}" target="_blank" rel="noopener">
      <img src="${escapeHtml(photo.url)}" class="pod-photo" loading="lazy" alt="Proof photo" />
    </a>
  `;

  return `
    <div class="pod-photo-grid">
      ${visible.map(photo => renderThumb(photo)).join('')}
      ${extra.map(photo => renderThumb(photo, 'hidden pod-photo-extra')).join('')}
    </div>
    ${extra.length && interactive ? `<button type="button" class="pod-inline-toggle pod-more-photos no-print" data-photo-group="${escapeHtml(group)}">+${extra.length} more</button>` : ''}
  `;
}

function renderProofColumn(label, icon, proof, pendingText, keyPrefix, interactive = true) {
  if (!proof) {
    return `
      <section class="pod-proof-panel pod-proof-panel-pending">
        <div class="pod-proof-heading">${icon} ${escapeHtml(label)}</div>
        <div class="pod-proof-pending-text">${escapeHtml(pendingText)}</div>
      </section>
    `;
  }

  const signatureHtml = proof.signature?.url
    ? `
      <div class="pod-signature-box">
        <img src="${escapeHtml(proof.signature.url)}" class="pod-signature" alt="Signature" />
      </div>
      <div class="pod-signature-meta">Signed ${escapeHtml(formatPodDateTime(proof.event_at))}</div>
    `
    : '<div class="pod-proof-text">No signature recorded</div>';

  return `
    <section class="pod-proof-panel">
      <div class="pod-proof-heading">${icon} ${escapeHtml(label)}</div>
      <div class="pod-proof-time">${escapeHtml(formatPodDateTime(proof.event_at))}</div>

      <div class="pod-proof-field">
        <div class="pod-proof-label">RECEIVED BY</div>
        <div class="pod-proof-text">${escapeHtml(proof.signed_name || '—')}</div>
      </div>

      <div class="pod-proof-field">
        <div class="pod-proof-label">NOTES</div>
        ${renderNotesBlock(proof.notes, `${keyPrefix}-notes`, interactive)}
      </div>

      <div class="pod-proof-field">
        <div class="pod-proof-label">SIGNATURE</div>
        ${signatureHtml}
      </div>

      <div class="pod-proof-field">
        <div class="pod-proof-label">PHOTOS</div>
        ${renderPhotosBlock(proof.photos, `${keyPrefix}-photos`, interactive)}
      </div>
    </section>
  `;
}

export function renderPodDocument(data, options = {}) {
  const interactive = options.interactive !== false;
  const logoSrc = options.logoSrc || '';
  const jobNumber = data?.job?.job_number || '—';
  const proofSuffix = headerSuffix(data?.proofs);
  const freightRows = data?.freight?.rows || [];
  const freightTotals = data?.freight?.totals || { cubic: 0, weight: 0 };

  const freightTableHtml = freightRows.length
    ? `
      <table class="pod-freight-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Type</th>
            <th class="num">Cubic (m3)</th>
            <th class="num">Total Weight (kg)</th>
          </tr>
        </thead>
        <tbody>
          ${freightRows.map(row => `
            <tr>
              <td>${escapeHtml(row.description)}</td>
              <td>${escapeHtml(row.item_type)}</td>
              <td class="num">${escapeHtml(formatCubic(row.cubic_m3))}</td>
              <td class="num">${escapeHtml(formatWeight(row.line_weight_kg))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
    : '<div class="pod-empty">No freight items recorded</div>';

  return `
    <article class="pod-doc-root">
      <header class="pod-doc-header pod-keep-together">
        <div class="pod-doc-header-brand">
          ${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="TFC logo" class="pod-doc-logo" />` : ''}
        </div>
        <div class="pod-doc-header-title">PROOF OF DELIVERY - Job #${escapeHtml(jobNumber)}${escapeHtml(proofSuffix)}</div>
      </header>

      <section class="pod-summary-strip pod-keep-together">
        <div>
          <div class="pod-strip-label">CUSTOMER</div>
          <div class="pod-strip-value">${escapeHtml(data?.job?.customer_company_name || '—')}</div>
        </div>
        <div>
          <div class="pod-strip-label">REFERENCE</div>
          <div class="pod-strip-value">${escapeHtml(data?.job?.customer_reference || '—')}</div>
        </div>
      </section>

      <section class="pod-parties-strip pod-keep-together">
        <div class="pod-party-col">
          <div class="pod-party-heading">SENDER</div>
          <div class="pod-party-line">${escapeHtml(data?.job?.pickup_company_name || '—')}</div>
          <div class="pod-party-line">${escapeHtml(data?.job?.pickup_address_text || '—')}</div>
          <div class="pod-party-line">${escapeHtml(data?.job?.pickup_location_line || '—')}</div>
        </div>
        <div class="pod-party-col">
          <div class="pod-party-heading">RECEIVER</div>
          <div class="pod-party-line">${escapeHtml(data?.job?.delivery_company_name || '—')}</div>
          <div class="pod-party-line">${escapeHtml(data?.job?.delivery_address_text || '—')}</div>
          <div class="pod-party-line">${escapeHtml(data?.job?.delivery_location_line || '—')}</div>
        </div>
      </section>

      <section class="pod-freight-strip pod-keep-together">
        <div class="pod-section-title">FREIGHT ITEMS</div>
        ${freightTableHtml}
        <div class="pod-freight-total">Total: ${escapeHtml(formatCubic(freightTotals.cubic))} m3 / ${escapeHtml(formatWeight(freightTotals.weight))} kg</div>
      </section>

      <section class="pod-proof-strip">
        ${renderProofColumn('PROOF OF PICKUP', '📦', data?.proofs?.pickup, 'Pending pickup', 'pickup', interactive)}
        ${renderProofColumn('PROOF OF DELIVERY', data?.proofs?.delivery ? '✅' : '⏳', data?.proofs?.delivery, 'Pending delivery', 'delivery', interactive)}
      </section>

      <footer class="pod-doc-footer">Generated ${escapeHtml(formatPodDateTime(data?.generatedAt))} · TFC TMS · Job #${escapeHtml(jobNumber)}</footer>
    </article>
  `;
}

export function bindPodDocumentInteractions(container) {
  if (!container || container.dataset.podInteractiveBound === '1') return;
  container.dataset.podInteractiveBound = '1';

  container.addEventListener('click', evt => {
    const notesBtn = evt.target.closest('.pod-inline-toggle[data-short-id][data-full-id]');
    if (notesBtn) {
      const shortId = notesBtn.getAttribute('data-short-id');
      const fullId = notesBtn.getAttribute('data-full-id');
      const shortNode = shortId ? container.querySelector(`#${CSS.escape(shortId)}`) : null;
      const fullNode = fullId ? container.querySelector(`#${CSS.escape(fullId)}`) : null;
      if (!shortNode || !fullNode) return;

      const showingFull = !fullNode.classList.contains('hidden');
      shortNode.classList.toggle('hidden', !showingFull);
      fullNode.classList.toggle('hidden', showingFull);
      notesBtn.textContent = showingFull ? 'Show full notes' : 'Show less';
      return;
    }

    const morePhotosBtn = evt.target.closest('.pod-more-photos[data-photo-group]');
    if (morePhotosBtn) {
      const group = morePhotosBtn.getAttribute('data-photo-group');
      if (!group) return;
      container.querySelectorAll(`.pod-photo-extra[data-photo-group="${CSS.escape(group)}"]`).forEach(node => {
        node.classList.remove('hidden');
      });
      morePhotosBtn.classList.add('hidden');
    }
  });
}
