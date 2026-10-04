// Pure translation checks shared by page and background. No network or credentials.
(function (global) {
  'use strict';
  const COMMON = new Set(('a an the this these that those it its their our your his her we they you i ' +
    'and but or nor so yet because although however despite unless whereas therefore thus ' +
    'after before when while if then now here there today tomorrow yesterday ' +
    'hello world first second third good bad great new old most more less all any every each ' +
    'only even also not never always often sometimes can could will would should may might must ' +
    'be is are was were been being have has had do does did done ' +
    'in on at of to for from with without by as into over under between through ' +
    'english chinese french japanese korean german spanish russian ' +
    'spectacularly successfully importantly basically actually particularly effectively significantly ' +
    'failed fails failure success continue continues continuing translation translate').split(/\s+/));

  function cleanProtected(text) {
    return String(text || '').normalize('NFC')
      .replace(/`[^`]*`/g, ' ')
      .replace(/https?:\/\/[^\s<>"'）)]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, ' ')
      .replace(/\b[A-Za-z][A-Za-z0-9_.+-]*\d[A-Za-z0-9_.+-]*\b/g, ' ');
  }

  function latinWords(text) {
    return String(text || '').normalize('NFC').match(/[\p{Script=Latin}\p{M}]+(?:['’-][\p{Script=Latin}\p{M}]+)*/gu) || [];
  }

  function sourceWords(source) {
    const words = new Map();
    for (const word of latinWords(cleanProtected(source))) {
      const key = word.toLowerCase();
      if (!words.has(key)) words.set(key, []);
      words.get(key).push(word);
    }
    return words;
  }

  function ordinary(word, variants) {
    const key = word.toLowerCase();
    if (COMMON.has(key)) return true;
    if (/^\p{Lu}{2,}$/u.test(word)) return false;
    if (variants && variants.some(v => /\p{Ll}\p{Lu}/u.test(v))) return false;
    return variants ? variants.some(v => /^\p{Ll}/u.test(v)) : /^\p{Ll}/u.test(word);
  }

  function inspect(source, translation, ctx) {
    ctx = ctx || {};
    if (typeof translation !== 'string' || !translation.trim()) {
      return { ok: false, reason: '译文为空或格式错误', residualWords: [] };
    }
    if (!/^zh(?:-|$)/i.test(ctx.targetLang || '')) return { ok: true, residualWords: [] };
    const words = sourceWords(source), allowed = new Set();
    for (const term of ctx.terms || []) {
      for (const word of latinWords(term.to)) {
        allowed.add(word.toLowerCase());
      }
    }
    for (const word of ctx.preserveTerms || []) allowed.add(String(word).normalize('NFC').toLowerCase());
    const comparative = String(source || '').match(/\b(?:less|more)\s+likely\b/gi) || [];
    if (comparative.length === 1 && !/\b(?:not|no)\s+(?:less|more)\s+likely\b/i.test(source)) {
      if (/^less/i.test(comparative[0]) && /(?:更|更加|较)(?:有)?可能/.test(translation)) {
        return { ok: false, reason: '比较方向误译：less likely 不应译为更可能', residualWords: [] };
      }
      if (/^more/i.test(comparative[0]) && /更不可能/.test(translation) && !/(?:更|更加|较)(?:有)?可能/.test(translation)) {
        return { ok: false, reason: '比较方向误译：more likely 不应译为更不可能', residualWords: [] };
      }
    }
    const seasons = { winter: /冬/, summer: /夏|暑/, spring: /春/, autumn: /秋/, fall: /秋/ };
    for (const anchor of cleanProtected(source).match(/\b(?:[Tt]his|[Nn]ext|[Ll]ast)\s+(?:winter|summer|spring|autumn|fall)\b/g) || []) {
      const season = anchor.split(/\s+/).pop();
      if (!seasons[season].test(translation)) return { ok: false, reason: '时间信息漏译：' + anchor, residualWords: [] };
    }
    const residual = new Set();
    const rawWords = latinWords(cleanProtected(translation));
    for (const word of rawWords) {
      const key = word.toLowerCase(), variants = words.get(key);
      if (word.length >= 3 && !allowed.has(key) && ordinary(word, variants)) residual.add(word);
    }
    const sourceOrdinary = [...words.entries()].some(([key, variants]) => ordinary(key, variants));
    if (!/[\u3400-\u9fff]/.test(translation) && sourceOrdinary && !(rawWords.length && rawWords.every(w => allowed.has(w.toLowerCase())))) {
      return { ok: false, reason: '中文译文仍主要是原文', residualWords: [...residual] };
    }
    if (residual.size) return { ok: false, reason: '普通英文词漏译：' + [...residual].join(', '), residualWords: [...residual] };
    return { ok: true, residualWords: [] };
  }

  function classify(text, ctx) {
    text = String(text || ''); ctx = ctx || {};
    const compact = text.trim(), words = compact.match(/[A-Za-z]+/g) || [];
    const connectors = (compact.match(/\b(?:although|however|despite|unless|whereas|nevertheless|notwithstanding|only|not|yet)\b/gi) || []).length;
    const term = (ctx.terms || []).some(t => t.from && compact.toLowerCase().includes(String(t.from).toLowerCase()));
    const sentences = (compact.match(/[.!?](?:\s|$)/g) || []).length;
    const reported = /\b(?:said|says|claimed|claims|argued|argues|alleged|allegedly|reportedly|according to)\b/i.test(compact);
    const embedded = /\b(?:that|which|who|whom|whose|whether|because|while|when|what)\b/i.test(compact);
    if (compact.length >= (ctx.complexThreshold || 650) || connectors >= 2 || term || reported || /\b(?:press the advantage|stay the course|mowing the lawn|death spiral|good-faith)\b/i.test(compact)) return 'complex';
    if (compact.length <= (ctx.localThreshold || 220) && words.length <= 36 && sentences <= 2 && !connectors && !embedded && !/[;—“”]/.test(compact)) return 'local';
    return 'standard';
  }

  global.EduTransQuality = { inspect: inspect, classify: classify };
})(typeof self !== 'undefined' ? self : this);
