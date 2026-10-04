// EduTrans YouTube dual subtitles (experimental).
(function () {
  'use strict';

  let subs = null;
  let overlay = null;
  let enabled = false;
  let loading = false;

  function getVideo() {
    return document.querySelector('video');
  }

  function parseTracks() {
    try {
      for (const s of document.querySelectorAll('script')) {
        const t = s.textContent || '';
        const i = t.indexOf('"captionTracks"');
        if (i < 0) continue;
        const m = t.slice(t.indexOf('[', i));
        let depth = 0;
        let end = -1;
        let inStr = false;
        let esc = false;
        for (let j = 0; j < m.length; j++) {
          const c = m[j];
          if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
          }
          if (c === '"') inStr = true;
          else if (c === '[') depth++;
          else if (c === ']') {
            depth--;
            if (depth === 0) { end = j + 1; break; }
          }
        }
        if (end < 0) continue;
        const arr = JSON.parse(m.slice(0, end));
        return Array.isArray(arr) ? arr : [];
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  function pickTrack(tracks) {
    if (!tracks.length) return null;
    let tr = null;
    for (const x of tracks) {
      if (x && x.baseUrl && x.languageCode === 'en') { tr = x; break; }
    }
    if (!tr) tr = tracks.find(function (x) { return x && x.baseUrl; });
    return tr || null;
  }

  async function fetchSegments(track) {
    const url = track.baseUrl + '&fmt=json3';
    const resp = await chrome.runtime.sendMessage({
      type: 'FETCH_JSON',
      url: url
    });
    if (!resp || !resp.ok) {
      throw new Error((resp && resp.error) || 'fetch failed');
    }
    const data = resp.json;
    const segs = [];
    (data.events || []).forEach(function (ev) {
      if (!ev.segs || typeof ev.tStartMs !== 'number') return;
      const text = ev.segs.map(function (s) {
        return s.utf8 || '';
      }).join('').trim();
      if (text) segs.push({ t: ev.tStartMs, d: ev.dDurationMs || 3000, text: text });
    });
    return segs;
  }

  let toastEl = null;
  let toastTimer = null;

  function showToastMsg(m) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'edutrans-ui edutrans-toast';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = m;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) { toastEl.remove(); toastEl = null; }
    }, 5000);
  }

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    const player = document.getElementById('movie_player') || getVideo();
    if (!player) return null;
    overlay = document.createElement('div');
    overlay.className = 'edutrans-ui edutrans-yt';
    (player.parentElement || player).appendChild(overlay);
    return overlay;
  }

  function findSeg(segs, ms) {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = segs[mid];
      if (s.t <= ms && ms < s.t + s.d) return s;
      if (s.t < ms) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  }

  function tick() {
    if (!enabled) return;
    const v = getVideo();
    const box = ensureOverlay();
    if (!v || !box) {
      setTimeout(tick, 800);
      return;
    }
    const hit = subs ? findSeg(subs, Math.round(v.currentTime * 1000)) : null;
    const key = hit ? (hit.t + ':' + hit.text) : '';
    if (key !== (box.getAttribute('data-key') || '')) {
      box.setAttribute('data-key', key);
      box.textContent = '';
      if (hit) {
        const l1 = document.createElement('div');
        l1.className = 'edutrans-ui edutrans-yt-src';
        l1.textContent = hit.text;
        const l2 = document.createElement('div');
        l2.className = 'edutrans-ui edutrans-yt-out';
        l2.textContent = hit.zh || '';
        box.appendChild(l1);
        box.appendChild(l2);
      }
    }
    setTimeout(tick, 250);
  }

  async function enableSubs() {
    if (loading) return;
    loading = true;
    try {
      const track = pickTrack(parseTracks());
      if (!track) {
        showToastMsg(EduTransI18n.content.ytNoTrack);
        return;
      }
      const segs = await fetchSegments(track);
      if (!segs.length) {
        showToastMsg(EduTransI18n.content.ytNoTrack);
        return;
      }
      for (let i = 0; i < segs.length; i += 20) {
        const part = segs.slice(i, i + 20);
        const resp = await chrome.runtime.sendMessage({
          type: 'TRANSLATE_BATCH',
          texts: part.map(function (s) { return s.text; }),
          ctx: { title: document.title, url: location.href }
        });
        if (resp && resp.ok) {
          for (let j = 0; j < part.length; j++) {
            part[j].zh = resp.texts[j] || '';
          }
        }
        showToastMsg(EduTransI18n.content.ytLoading + ' ' +
          Math.min(i + 20, segs.length) + '/' + segs.length);
      }
      subs = segs;
      enabled = true;
      tick();
    } catch (e) {
      showToastMsg(String((e && e.message) || e));
    } finally {
      loading = false;
    }
  }

  function disableSubs() {
    enabled = false;
    subs = null;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, s, sendResponse) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'TOGGLE_YT_SUBS') {
      sendResponse({ ok: true, enabled: enabled });
      if (enabled) disableSubs(); else enableSubs();
    }
    if (msg.type === 'GET_YT_STATE') {
      sendResponse({ enabled: enabled });
    }
  });
})();
