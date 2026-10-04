// EduTrans popup controller.
(function () {
  'use strict';

  let settings = null;
  let activeTab = null;
  let host = '';

  const $ = function (id) { return document.getElementById(id); };

  function engineDisplayName(id, eng) {
    const P = EduTransI18n.popup;
    if (eng.type === 'device') return P.deviceEngine;
    if (eng.type === 'google') return P.googleEngine;
    if (eng.type === 'microsoft') return P.msEngine;
    return (eng.name || id) + ' \u00b7 ' + P.tagAI;
  }

  function fillLabels() {
    const I = EduTransI18n.popup;
    $('app-name').textContent = EduTransI18n.appName;
    $('open-options').textContent = I.settings;
    $('link-vocab').textContent = I.vocab;
    $('site-auto-label').textContent = I.siteAuto;
    $('btn-summary').textContent = I.summarize;
    $('btn-yt').textContent = I.ytSubs;
    const engineLabel = document.querySelector('label[for="engine"]');
    const modeLabel = document.querySelector('label[for="mode"]');
    if (engineLabel) engineLabel.textContent = I.engine;
    if (modeLabel) modeLabel.textContent = I.mode;
    $('mode').options[0].textContent = I.bilingual;
    $('mode').options[1].textContent = I.translation;
  }

  function fillEngines() {
    const sel = $('engine');
    sel.textContent = '';
    EduTransCommon.engineOrder(settings).forEach(function (id) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = engineDisplayName(id, settings.engines[id]);
      sel.appendChild(opt);
    });
    sel.value = settings.defaultEngineId;
  }

  async function savePref(patch) {
    if (!host) return;
    if (!settings.sitePrefs[host]) settings.sitePrefs[host] = {};
    Object.assign(settings.sitePrefs[host], patch);
    await EduTransCommon.saveSettings(settings);
  }

  async function refreshToggle() {
    let state = { active: false };
    try {
      state = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_STATE' }) || state;
    } catch (e) { /* content script not ready */ }
    const btn = $('toggle');
    btn.classList.toggle('off', !state.active);
    btn.textContent = state.active ?
      EduTransI18n.popup.disable : EduTransI18n.popup.enable;
  }

  $('engine').addEventListener('change', async function () {
    settings.defaultEngineId = this.value;
    settings.defaultEngineExplicit = true;
    await savePref({ engineId: this.value });
  });

  $('mode').addEventListener('change', async function () {
    settings.mode = this.value;
    await EduTransCommon.saveSettings(settings);
    chrome.tabs.sendMessage(activeTab.id, {
      type: 'MODE_CHANGED', mode: this.value
    }).catch(function () {});
  });

  $('site-auto').addEventListener('change', async function () {
    await savePref({ enabled: this.checked });
  });

  $('toggle').addEventListener('click', async function () {
    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_PAGE' });
    } catch (e) {
      $('status').textContent = EduTransI18n.popup.reloadNeeded;
      return;
    }
    const pref = settings.sitePrefs[host] || {};
    await savePref({ enabled: !pref.enabled });
    setTimeout(refreshToggle, 200);
  });

  $('btn-summary').addEventListener('click', function () {
    if (!activeTab || !activeTab.id) return;
    chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_SUMMARY' })
      .catch(function () {
        $('status').textContent = EduTransI18n.popup.reloadNeeded;
      });
  });

  $('btn-yt').addEventListener('click', function () {
    if (!activeTab || !activeTab.id) return;
    chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_YT_SUBS' })
      .then(function (resp) {
        const on = resp && resp.enabled;
        $('btn-yt').textContent = on
          ? EduTransI18n.popup.ytSubsOff
          : EduTransI18n.popup.ytSubs;
      }).catch(function () {
        $('status').textContent = EduTransI18n.popup.reloadNeeded;
      });
  });

  $('open-options').addEventListener('click', function (e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  $('link-vocab').addEventListener('click', function (e) {
    e.preventDefault();
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/options/options.html#vocab')
    });
  });

  (async function init() {
    settings = await EduTransCommon.getSettings();
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0] || null;
    if (activeTab && activeTab.url && activeTab.url.indexOf('http') === 0) {
      host = new URL(activeTab.url).hostname;
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      $('btn-yt').classList.remove('hidden');
    }
    const pref = (settings.sitePrefs && settings.sitePrefs[host]) || {};
    fillLabels();
    fillEngines();
    if (pref.engineId && settings.engines[pref.engineId]) {
      $('engine').value = pref.engineId;
    }
    $('mode').value = settings.mode || 'bilingual';
    $('site-auto').checked = !!pref.enabled;
    refreshToggle();
  })();
})();
