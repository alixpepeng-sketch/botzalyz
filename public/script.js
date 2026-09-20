(() => {
  'use strict';

  const COOLDOWN_SECONDS = 10;
  const STATUS_INTERVAL_MS = 30000;

  const $ = (id) => document.getElementById(id);

  const el = {
    intro: $('step-intro'),
    pair: $('step-pair'),
    start: $('btn-start'),
    back: $('btn-back'),
    form: $('pair-form'),
    number: $('number'),
    submit: $('btn-pair'),
    submitLabel: $('btn-pair-label'),
    feedback: $('feedback'),
    result: $('result'),
    code: $('code'),
    copy: $('btn-copy'),
    copyLabel: $('btn-copy-label'),
    status: $('status'),
    statusText: $('status-text'),
  };

  const state = { busy: false, cooldown: 0, timer: null, copyTimer: null };

  /* ---------------------------- Step ---------------------------- */

  function render(step) {
    const showPair = step === 'pair';
    const next = showPair ? el.pair : el.intro;
    const prev = showPair ? el.intro : el.pair;

    prev.classList.remove('is-active');
    prev.hidden = true;

    next.hidden = false;
    void next.offsetWidth; // paksa reflow supaya transisi berjalan
    next.classList.add('is-active');
    window.scrollTo({ top: 0 });

    if (showPair && !window.matchMedia('(pointer: coarse)').matches) {
      el.number.focus({ preventScroll: true });
    }
  }

  function go(step) {
    const hash = step === 'pair' ? '#pair' : '';
    if (window.location.hash !== hash) {
      history.pushState({ step }, '', hash || window.location.pathname + window.location.search);
    }
    render(step);
  }

  /* ---------------------------- Pesan & tombol ---------------------------- */

  function showFeedback(message, type) {
    el.feedback.dataset.type = type;
    el.feedback.textContent = message;
    el.feedback.hidden = false;
  }

  function updateSubmit() {
    const locked = state.busy || state.cooldown > 0;
    el.submit.disabled = locked;
    el.submit.setAttribute('aria-busy', String(state.busy));

    if (state.busy) el.submitLabel.textContent = 'Memproses...';
    else if (state.cooldown > 0) el.submitLabel.textContent = 'Tunggu ' + state.cooldown + ' detik';
    else el.submitLabel.textContent = 'Dapatkan Kode Pairing';
  }

  function startCooldown(seconds) {
    window.clearInterval(state.timer);
    state.cooldown = seconds;
    updateSubmit();

    state.timer = window.setInterval(() => {
      state.cooldown -= 1;
      if (state.cooldown <= 0) {
        state.cooldown = 0;
        window.clearInterval(state.timer);
      }
      updateSubmit();
    }, 1000);
  }

  function showCode(code) {
    el.code.textContent = code;
    el.result.hidden = false;
    el.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideCode() {
    el.result.hidden = true;
    el.code.textContent = '';
  }

  /* ---------------------------- Nomor ---------------------------- */

  function normalizeNumber(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    return /^\d{8,15}$/.test(digits) ? digits : null;
  }

  el.number.addEventListener('input', () => {
    const clean = el.number.value.replace(/\D/g, '');
    if (clean !== el.number.value) el.number.value = clean;
  });

  /* ---------------------------- Pairing ---------------------------- */

  async function requestCode(event) {
    event.preventDefault();
    if (state.busy || state.cooldown > 0) return;

    const number = normalizeNumber(el.number.value);
    if (!number) {
      showFeedback('Nomor tidak valid. Gunakan kode negara, contoh 6281234567890.', 'error');
      el.number.focus();
      return;
    }

    state.busy = true;
    updateSubmit();
    hideCode();
    showFeedback('Menyiapkan sesi bot. Ini bisa memakan waktu beberapa detik.', 'info');

    let cooldown = COOLDOWN_SECONDS;
    try {
      const res = await fetch('/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: number }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 429) {
        cooldown = Number(data && data.retryAfter) || COOLDOWN_SECONDS;
        showFeedback((data && data.message) || 'Terlalu cepat. Coba lagi sebentar lagi.', 'error');
      } else if (!res.ok || !data || !data.ok) {
        showFeedback(
          (data && data.message) || 'Server tidak merespons dengan benar. Coba lagi.',
          'error'
        );
      } else if (data.connected) {
        showFeedback(data.message || 'Nomor ini sudah terhubung.', 'success');
      } else {
        showFeedback('Kode pairing siap. Masukkan di WhatsApp sebelum kedaluwarsa.', 'success');
        showCode(data.code);
      }
    } catch (err) {
      showFeedback('Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.', 'error');
    } finally {
      state.busy = false;
      startCooldown(cooldown);
    }
  }

  /* ---------------------------- Salin kode ---------------------------- */

  function fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  async function copyCode() {
    const text = el.code.textContent.trim();
    if (!text) return;

    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (err) {
      ok = fallbackCopy(text);
    }

    el.copyLabel.textContent = ok ? 'Tersalin' : 'Salin manual dari kode di atas';
    window.clearTimeout(state.copyTimer);
    state.copyTimer = window.setTimeout(() => {
      el.copyLabel.textContent = 'Salin kode';
    }, 2000);
  }

  /* ---------------------------- Status server ---------------------------- */

  async function checkStatus() {
    let online = false;
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      online = res.ok;
    } catch (err) {
      online = false;
    }
    el.status.dataset.state = online ? 'online' : 'offline';
    el.statusText.textContent = online ? 'Online' : 'Offline';
  }

  /* ---------------------------- Init ---------------------------- */

  el.start.addEventListener('click', () => go('pair'));
  el.back.addEventListener('click', () => go('intro'));
  el.form.addEventListener('submit', requestCode);
  el.copy.addEventListener('click', copyCode);

  window.addEventListener('popstate', () => {
    render(window.location.hash === '#pair' ? 'pair' : 'intro');
  });

  if (window.location.hash === '#pair') render('pair');

  updateSubmit();
  checkStatus();
  window.setInterval(checkStatus, STATUS_INTERVAL_MS);
})();
