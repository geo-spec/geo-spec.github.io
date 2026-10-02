/* Тбилиси в кармане - логика. Без сборки и зависимостей, кроме Leaflet. */
(function () {
  'use strict';

  var T = window.TRIP;
  var ROUTES = window.ROUTES || {};
  var P = {};
  T.places.forEach(function (p) { P[p.id] = p; });
  var HOTEL = P[T.hotelId];
  var HOTEL_LL = [HOTEL.lat, HOTEL.lon];

  /* ---------- утилиты ---------- */
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var ico = function (n, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true"><use href="#i-' + n + '"/></svg>'; };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('tb:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tb:' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } }
  };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var nf = new Intl.NumberFormat('ru-RU');
  var dec = function (x) { return String(x).replace('.', ','); };
  var cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
  var tel = function (s) { return String(s).replace(/[^\d+]/g, ''); };
  var deg = function (t) { var r = Math.round(t); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r) + '°'; };
  var plural = function (n, f) { var a = Math.abs(n) % 100, b = a % 10; return f[a > 10 && a < 20 ? 2 : b > 1 && b < 5 ? 1 : b === 1 ? 0 : 2]; };

  /* ---------- время Тбилиси (UTC+4, без перехода на летнее) ---------- */
  var TZ = 4 * 3600e3;
  var override = null;
  (function () {
    var q = new URLSearchParams(location.search).get('t');
    var m = q && q.match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/);
    if (m) override = { base: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]), at: Date.now() };
  })();
  /* Дата, у которой UTC-поля равны настенному времени Тбилиси */
  function tbNow() { return new Date(override ? override.base + (Date.now() - override.at) : Date.now() + TZ); }
  var dkey = function (d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  var mins = function (d) { return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  var hm = function (s) { var a = s.split(':'); return +a[0] * 60 + +a[1]; };
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WDAY = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var WDS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  function dateOf(key) { var a = key.split('-'); return new Date(Date.UTC(+a[0], a[1] - 1, +a[2])); }
  function dayLabel(key) { var d = dateOf(key); return cap(WDAY[d.getUTCDay()]) + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function addDays(key, n) { var d = dateOf(key); d.setUTCDate(d.getUTCDate() + n); return dkey(d); }
  function inText(min) {
    if (min < 1) return 'сейчас';
    if (min < 60) return 'через ' + min + ' мин';
    var h = Math.floor(min / 60), m = min % 60;
    if (h >= 20) return 'завтра';
    return 'через ' + h + ' ч' + (m ? ' ' + m + ' мин' : '');
  }
  function phase(m) {
    if (m < 390 || m >= 1185) return 'night';
    if (m < 510) return 'dawn';
    if (m < 1065) return 'day';
    return 'dusk';
  }

  /* ---------- часы работы ---------- */
  var DAYIDX = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
  function daySet(spec) {
    if (spec === 'daily') return [0, 1, 2, 3, 4, 5, 6];
    var ab = spec.split('-'), a = DAYIDX[ab[0]], b = DAYIDX[ab[1]], out = [];
    for (var i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b) break; }
    return out;
  }
  var clk = function (s) { return s === '00:00' ? 'полуночи' : s; };
  function openState(h, tb) {
    tb = tb || tbNow();
    if (!h) return { k: 'unknown', t: 'часы не указаны' };
    if (h === '24/7') return { k: 'open', t: 'круглосуточно', live: true };
    var m = mins(tb), wd = tb.getUTCDay(), key = dkey(tb), mm, o, c;
    if ((mm = h.match(/^until (\d\d:\d\d)$/))) {
      c = hm(mm[1]) || 1440;
      if (m >= 360 && m < c) return c - m <= 45 ? { k: 'soon', t: 'закроется в ' + (c === 1440 ? 'полночь' : mm[1]), live: true } : { k: 'unknown', t: 'до ' + clk(mm[1]), live: true };
      return { k: 'closed', t: 'закрыто, работает до ' + clk(mm[1]) };
    }
    if ((mm = h.match(/^fest (\d\d:\d\d)-(\d\d:\d\d)$/))) {
      var fd = T.festival.dates;
      if (fd.indexOf(key) < 0) return key < fd[0] ? { k: 'unknown', t: addDays(key, 1) === fd[0] ? 'завтра с ' + mm[1] : '3–4 октября' } : { k: 'closed', t: 'Тбилисоба прошла' };
      o = hm(mm[1]); c = hm(mm[2]);
      if (m < o) return { k: o - m <= 60 ? 'soon' : 'closed', t: 'откроется в ' + mm[1] };
      if (m < c) return c - m <= 45 ? { k: 'soon', t: 'закроется в ' + mm[2], live: true } : { k: 'open', t: 'идёт до ' + mm[2], live: true };
      return { k: 'closed', t: key === fd[0] ? 'завтра с ' + mm[1] : 'закрыто' };
    }
    if ((mm = h.match(/^([a-z]{2}-[a-z]{2}|daily) (\d\d:\d\d)-(\d\d:\d\d)$/))) {
      var days = daySet(mm[1]);
      o = hm(mm[2]); c = hm(mm[3]);
      var night = c <= o;
      if (night && days.indexOf((wd + 6) % 7) >= 0 && m < c) {
        return c - m <= 45 ? { k: 'soon', t: 'закроется в ' + mm[3], live: true } : { k: 'open', t: 'открыто до ' + mm[3], live: true };
      }
      if (days.indexOf(wd) < 0) return { k: 'closed', t: 'сегодня выходной' };
      if (m < o) return { k: o - m <= 60 ? 'soon' : 'closed', t: 'откроется в ' + mm[2] };
      var end = night ? c + 1440 : c;
      if (m < end) return end - m <= 45 ? { k: 'soon', t: 'закроется в ' + mm[3], live: true } : { k: 'open', t: 'открыто до ' + clk(mm[3]), live: true };
      return { k: 'closed', t: 'закрыто с ' + mm[3] };
    }
    return { k: 'unknown', t: h };
  }
  var DAYRU = { daily: 'ежедневно', 'mo-sa': 'пн–сб', 'tu-sa': 'вт–сб', 'tu-su': 'вт–вс', 'mo-fr': 'пн–пт' };
  function hoursText(h) {
    if (!h) return '';
    if (h === '24/7') return 'Круглосуточно';
    var mm;
    if ((mm = h.match(/^until (\d\d:\d\d)$/))) return 'До ' + clk(mm[1]) + ' (время открытия не указано)';
    if ((mm = h.match(/^fest (\d\d:\d\d)-(\d\d:\d\d)$/))) return '3 и 4 октября, ' + mm[1] + '–' + mm[2];
    if ((mm = h.match(/^(\S+) (\d\d:\d\d)-(\d\d:\d\d)$/))) return cap(DAYRU[mm[1]] || mm[1]) + ', ' + mm[2] + '–' + mm[3];
    return h;
  }
  function stChip(st) { return '<span class="st st-' + st.k + '">' + esc(cap(st.t)) + '</span>'; }

  /* ---------- расстояния ---------- */
  function dist(a, b) {
    var r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    var x = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * 6371e3 * Math.asin(Math.sqrt(x));
  }
  function distShort(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' м' : dec((m / 1000).toFixed(1)) + ' км'; }
  /* 75 м/мин и поправка 1,3 на изгибы улиц: время честно примерное */
  function walkMin(m) { return Math.max(1, Math.round(m * 1.3 / 75)); }
  function distText(m) { return distShort(m) + ' по прямой · ~' + walkMin(m) + ' мин пешком'; }
  var ll = function (p) { return [p.lat, p.lon]; };

  /* ---------- ссылки ---------- */
  var gWalk = function (p) { return 'https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lon + '&travelmode=walking'; };
  var gDrive = function (p) { return 'https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lon + '&travelmode=driving'; };
  var yaWalk = function (p) { return 'https://yandex.ru/maps/?rtext=~' + p.lat + ',' + p.lon + '&rtt=pd'; };
  function gOpen(p) {
    var l = (p.links || []).filter(function (x) { return x[0] === 'Google Maps'; })[0];
    return l ? l[1] : 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lon;
  }

  /* ---------- состояние ---------- */
  var state = {
    tab: 'now',
    day: null,
    train: store.get('train', '17:10'),
    seg: store.get('seg', null),
    openOnly: false,
    nearMe: false,
    mapCat: 'all',
    routes: {}
  };
  var checks = store.get('checks', {});
  var me = null;

  /* ---------- погода ---------- */
  var WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=41.7008&longitude=44.8201' +
    '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation' +
    '&wind_speed_unit=ms&timezone=Asia%2FTbilisi&start_date=2026-10-02&end_date=2026-10-05';
  var wx = store.get('wx', null);
  function loadWx() {
    if (!navigator.onLine && wx) return;
    fetch(WX_URL).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (data) {
      if (!data || !data.hourly) return;
      wx = { at: Date.now(), data: data };
      store.set('wx', wx);
      renderSoft();
    }).catch(function () { /* офлайн: остаётся прогноз Яндекса */ });
  }
  function wxHour(key, h) {
    if (!wx) return null;
    var H = wx.data.hourly, i = H.time.indexOf(key + 'T' + pad(h) + ':00');
    if (i < 0 || H.temperature_2m[i] == null) return null;
    return { t: H.temperature_2m[i], f: H.apparent_temperature[i], pp: H.precipitation_probability[i], pr: H.precipitation[i], c: H.weather_code[i], w: H.wind_speed_10m[i], g: H.wind_gusts_10m[i], h: h };
  }
  function wmo(c, h) {
    var night = h != null && (h < 7 || h >= 19);
    if (c === 0) return ['ясно', night ? 'moon' : 'sun'];
    if (c <= 2) return ['малооблачно', night ? 'moon' : 'partly'];
    if (c === 3) return ['пасмурно', 'cloud'];
    if (c <= 48) return ['туман', 'fog'];
    if (c <= 57) return ['морось', 'rain'];
    if (c <= 67) return ['дождь', 'rain'];
    if (c <= 77) return ['снег', 'cloud'];
    if (c <= 82) return ['ливень', 'rain'];
    return ['гроза', 'rain'];
  }
  var partOf = function (h) { return h < 6 ? 'ночь' : h < 12 ? 'утро' : h < 17 ? 'день' : h < 22 ? 'вечер' : 'ночь'; };
  function wxNow(tb) {
    var key = dkey(tb), h = tb.getUTCHours();
    var c = wx && !override && wx.data.current;
    if (c && Math.abs(Date.now() - wx.at) < 3 * 3600e3) {
      return { t: c.temperature_2m, f: c.apparent_temperature, c: c.weather_code, w: c.wind_speed_10m, g: c.wind_gusts_10m, pr: c.precipitation, h: h, live: true };
    }
    var x = wxHour(key, h);
    if (x) { x.live = false; return x; }
    var d = T.weather.days[key];
    if (!d) return null;
    var part = partOf(h), p = d.parts.filter(function (q) { return q[0] === part; })[0] || d.parts[0];
    return { t: p[1], f: p[2], text: p[3], icon: p[4], yandex: true, h: h };
  }
  /* что надеть: по ощущаемой температуре, ветру и дождю на ближайшие 6 часов */
  function wearAdvice(tb) {
    var key = dkey(tb), h = tb.getUTCHours(), feels = [], gust = 0, rain = 0, pp = 0, i, x;
    for (i = 0; i < 7; i++) {
      x = wxHour(key, h + i);
      if (!x) break;
      feels.push(x.f); gust = Math.max(gust, x.g || 0); rain += x.pr || 0; pp = Math.max(pp, x.pp || 0);
    }
    var d = T.weather.days[key];
    if (!feels.length && d) {
      d.parts.forEach(function (p) { feels.push(p[2] != null ? p[2] : p[1]); if (p[4] === 'rain') pp = 70; });
      if (d.warn) gust = 15;
    }
    if (!feels.length) return null;
    var fmin = Math.min.apply(null, feels), out = [], icon = 'jacket';
    if (fmin <= 9) out.push('Ощущается до ' + deg(fmin) + ': тёплая куртка обязательно');
    else if (fmin <= 14) out.push('Ощущается до ' + deg(fmin) + ': куртка или плотный свитер');
    else out.push('До ' + deg(fmin) + ' по ощущениям: хватит лёгкой кофты');
    if (gust >= 12) out.push('порывы до ' + Math.round(gust) + ' м/с - зонт вывернет, лучше капюшон');
    else if (rain >= 0.3 || pp >= 50) { out.push('может капать - капюшон или зонт'); icon = 'umbrella'; }
    return { icon: icon, text: out.join('; ') + '.' };
  }

  /* ---------- дни и пункты ---------- */
  function dayOf(key) { return T.days.filter(function (d) { return d.date === key; })[0]; }
  function trainItems() {
    var tr = T.trains[state.train] || T.trains['17:10'];
    return tr.rows.map(function (r) { return { t: r[0], s: r[1], e: r[2], title: r[3], text: r[4], place: r[5], key: !!r[6], train: true }; });
  }
  function itemsOf(day) { return day.train ? trainItems() : day.items; }
  function nowState(tb) {
    var key = dkey(tb), m = mins(tb), first = T.days[0].date, last = T.days[T.days.length - 1].date;
    if (key < first) return { mode: 'before', days: Math.round((dateOf(first) - dateOf(key)) / 864e5) };
    if (key > last) return { mode: 'after' };
    var day = dayOf(key), items = itemsOf(day);
    if (day.train) {
      var dep = items[items.length - 1];
      if (m >= hm(dep.s) + 1) return { mode: 'after', day: day };
    }
    var live = items.filter(function (i) { return !i.done && hm(i.s) <= m && m < hm(i.e); });
    var main = live.filter(function (i) { return !i.opt && !i.tip; });
    var pool = (main.length ? main : live).slice().sort(function (a, b) { return hm(b.s) - hm(a.s); });
    var cur = pool[0] || null;
    var also = main.filter(function (i) { return i !== cur; });
    var next = items.filter(function (i) { return !i.done && hm(i.s) > m; }).sort(function (a, b) { return hm(a.s) - hm(b.s); }).slice(0, 4);
    var tomorrow = null;
    if (next.length < 2) {
      var nd = dayOf(addDays(key, 1));
      if (nd) tomorrow = { day: nd, items: itemsOf(nd).filter(function (i) { return !i.tip && !i.done; }).slice(0, 3) };
    }
    return { mode: 'trip', key: key, day: day, items: items, cur: cur, also: also, next: next, tomorrow: tomorrow, m: m };
  }

  /* ---------- рендер: общие куски ---------- */
  var CATNAME = { base: 'Опорная точка', sight: 'Достопримечательность', fest: 'Тбилисоба', museum: 'Музей', food: 'Еда', shop: 'Магазин и бытовое' };
  var CATICON = { base: 'base', sight: 'sight', fest: 'fest', museum: 'museum', food: 'food', shop: 'shop' };
  function catDot(p) { return '<span class="cat-dot c-' + p.cat + ' pi">' + ico(p.id === T.hotelId ? 'hotel' : p.id === 'station' ? 'train' : CATICON[p.cat]) + '</span>'; }
  function placeChip(id) { var p = P[id]; return p ? '<button type="button" class="chip" data-place="' + id + '">' + ico('pin') + esc(p.short || p.name) + '</button>' : ''; }
  function routeChip(key, label) {
    var r = ROUTES[key];
    return r ? '<button type="button" class="chip" data-route="' + key + '">' + ico('route') + esc(label || 'Маршрут на карте') + ' · ' + r.min + ' мин</button>' : '';
  }
  function wxIcon(name) { return ico(name || 'cloud'); }

  function checklistHTML(key, compact) {
    var cl = T.checklists[key];
    if (!cl) return '';
    var done = cl.items.filter(function (_, i) { return checks[key + ':' + i]; }).length;
    var html = (compact ? '' : '<div class="card-head"><h3>' + esc(cl.title) + '</h3><span class="prog" data-prog="' + key + '">' + done + ' из ' + cl.items.length + '</span></div>') +
      '<ul class="check">' + cl.items.map(function (t, i) {
        var id = key + ':' + i;
        return '<li><label><input type="checkbox" data-check="' + id + '"' + (checks[id] ? ' checked' : '') + '><span>' + esc(t) + '</span></label></li>';
      }).join('') + '</ul>';
    return html;
  }

  /* ---------- погода: карточка ---------- */
  function weatherCard(tb, key) {
    key = key || dkey(tb);
    var d = T.weather.days[key];
    var now = key === dkey(tb) ? wxNow(tb) : null;
    var html = '<article class="card rv" style="--i:3"><div class="card-head"><h3>Погода</h3><span class="muted small">' + esc(dayLabel(key)) + '</span></div>';
    if (now) {
      var desc = now.yandex ? [now.text, now.icon] : wmo(now.c, now.h);
      html += '<div class="wx-now"><div class="wx-big num">' + deg(now.t) + '</div><div class="wx-meta">' +
        '<b>' + esc(cap(desc[0] || '')) + '</b>' +
        (now.f != null ? '<br>ощущается ' + deg(now.f) : '') +
        (now.w != null ? '<br>ветер ' + Math.round(now.w) + ' м/с' + (now.g ? ', порывы до ' + Math.round(now.g) : '') : '') +
        '</div><svg style="width:46px;height:46px;margin-left:auto;color:var(--gold)" aria-hidden="true"><use href="#i-' + (desc[1] || 'cloud') + '"/></svg></div>';
    }
    if (d) {
      var cur = now ? partOf(now.h) : null;
      html += '<div class="wx-parts" style="--n:' + d.parts.length + '">' + d.parts.map(function (p) {
        return '<div class="wx-part' + (p[0] === cur ? ' cur' : '') + '"><div class="p">' + p[0] + '</div>' + wxIcon(p[4]) +
          '<div class="t num">' + deg(p[1]) + '</div><div class="f">' + (p[2] != null ? 'ощущ. ' + deg(p[2]) : esc(p[3] || '&nbsp;')) + '</div></div>';
      }).join('') + '</div>';
      html += '<div class="wx-head' + (d.warn ? ' warn' : '') + '">' + ico(d.warn ? 'wind' : 'check') + '<div><b>' + esc(d.head) + '</b>' +
        (d.wind ? ' · ветер ' + esc(d.wind) : '') + (d.note ? '<div class="muted small">' + esc(d.note) + '</div>' : '') + '</div></div>';
    }
    if (key === dkey(tb)) {
      var w = wearAdvice(tb);
      if (w) html += '<div class="wear">' + ico(w.icon) + '<div>' + esc(w.text) + '</div></div>';
    }
    html += sparkHTML(key, key === dkey(tb) ? tb.getUTCHours() : null);
    html += '<div class="src">' + (wx ? 'Почасово - Open-Meteo, обновлено ' + timeOf(wx.at) + '. ' : 'Нет связи - показан сохранённый прогноз. ') + 'По частям суток - ' + esc(T.weather.source) + '.</div></article>';
    return html;
  }
  function timeOf(ms) { var d = new Date(ms + TZ); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + (dkey(d) !== dkey(tbNow()) ? ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] : ''); }
  /* почасовой график: линия температуры и столбики осадков */
  function sparkHTML(key, hourNow) {
    var hs = [], h;
    for (h = 6; h <= 23; h++) { var x = wxHour(key, h); if (x) hs.push(x); }
    if (hs.length < 6) return '';
    var W = 320, H = 64, top = 14, bot = 50;
    var ts = hs.map(function (x) { return x.t; }), mn = Math.min.apply(null, ts), mx = Math.max.apply(null, ts), span = Math.max(4, mx - mn);
    var X = function (hh) { return 8 + (hh - 6) / 17 * (W - 16); };
    var Y = function (t) { return bot - (t - mn) / span * (bot - top); };
    var line = hs.map(function (x, i) { return (i ? 'L' : 'M') + X(x.h).toFixed(1) + ' ' + Y(x.t).toFixed(1); }).join('');
    var bars = hs.map(function (x) { var v = Math.min(1, (x.pr || 0) / 2); return v > 0.02 ? '<rect class="bar" x="' + (X(x.h) - 4).toFixed(1) + '" y="' + (bot - v * 26).toFixed(1) + '" width="8" height="' + (v * 26).toFixed(1) + '" rx="2"/>' : ''; }).join('');
    var imax = ts.indexOf(mx), imin = ts.indexOf(mn);
    var lbl = function (i, dy) { return '<text class="tv" x="' + X(hs[i].h).toFixed(1) + '" y="' + (Y(hs[i].t) + dy).toFixed(1) + '" text-anchor="middle">' + deg(hs[i].t) + '</text>'; };
    var ticks = [6, 9, 12, 15, 18, 21].map(function (t) { return '<text x="' + X(t).toFixed(1) + '" y="63" text-anchor="middle">' + t + ':00</text>'; }).join('');
    var nowMark = hourNow != null && hourNow >= 6 ? '<line x1="' + X(hourNow).toFixed(1) + '" x2="' + X(hourNow).toFixed(1) + '" y1="6" y2="52" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="2 3"/>' : '';
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Температура по часам">' + bars + nowMark +
      '<path class="ln" d="' + line + '"/>' + lbl(imax, -6) + (imin !== imax ? lbl(imin, -7) : '') + ticks + '</svg>';
  }

  /* ---------- вкладка «Сейчас» ---------- */
  function renderNow() {
    var tb = tbNow(), key = dkey(tb), m = mins(tb), st = nowState(tb), html = '';
    var dayIdx = T.days.map(function (d) { return d.date; }).indexOf(key);
    var wn = wxNow(tb);
    var wmini = wn ? '<span class="seg-src">' + wxIcon(wn.yandex ? wn.icon : wmo(wn.c, wn.h)[1]) + '<b class="num" style="font-size:17px;color:var(--ink)">' + deg(wn.t) + '</b></span>' : '';

    /* билет «что сейчас» */
    html += '<article class="card ticket rv" style="--i:1"><div class="ticket-top"><div><div class="eyebrow">' +
      (dayIdx >= 0 ? 'День ' + (dayIdx + 1) + ' из ' + T.days.length : 'Тбилиси') + '</div><div class="ticket-day">' + esc(dayLabel(key)) + '</div></div>' + wmini + '</div><div class="ticket-body">';
    if (st.mode === 'before') {
      html += '<span class="now-label">До поездки</span><div class="now-title">' + st.days + ' ' + plural(st.days, ['день', 'дня', 'дней']) + '</div><p class="now-text">Поезд №803 из Батуми приходит 2 октября около полудня.</p>';
    } else if (st.mode === 'after') {
      html += '<span class="now-label"><span class="now-dot"></span>Поезд ушёл</span><div class="now-title">Нахвамдис, Тбилиси!</div><p class="now-text">Поездка закончилась. <span class="ka" lang="ka">ნახვამდის</span> - «до свидания». Гид остаётся на память.</p>';
    } else {
      if (st.cur) {
        html += '<span class="now-label"><span class="now-dot"></span>Сейчас · ' + esc(st.cur.t) + '</span>' +
          '<div class="now-title">' + esc(st.cur.title) + '</div>' + (st.cur.text ? '<p class="now-text">' + esc(st.cur.text) + '</p>' : '');
        var chips = [];
        if (st.cur.place) chips.push(placeChip(st.cur.place));
        (st.cur.places || []).forEach(function (id) { chips.push(placeChip(id)); });
        if (st.cur.route) chips.push(routeChip(st.cur.route));
        if (st.cur.check) chips.push('<button type="button" class="chip" data-tab="info" data-anchor="cl-' + st.cur.check + '">' + ico('check') + 'Список: ' + esc(T.checklists[st.cur.check].title.toLowerCase()) + '</button>');
        if (chips.length) html += '<div class="chips">' + chips.join('') + '</div>';
        if (st.also.length) html += '<p class="now-text small" style="margin-top:10px">Параллельно: ' + st.also.map(function (i) { return esc(i.title); }).join('; ') + '</p>';
      } else {
        html += '<span class="now-label">Свободное время</span><div class="now-title">' + (m < 420 ? 'Спим' : 'Ничего обязательного') + '</div><p class="now-text">' + esc(st.day.lead) + '</p>';
      }
      var list = st.next.map(function (i) {
        return '<li><time>' + esc(i.s) + '</time><button type="button" class="linkish" style="text-decoration:none;color:var(--ink);font-weight:500;text-align:left" data-goday="' + st.key + '">' +
          esc(i.title) + (i.opt ? ' <span class="muted small">· по желанию</span>' : '') + '</button><span class="in">' + inText(hm(i.s) - m) + '</span></li>';
      });
      if (st.tomorrow) {
        list = list.concat(st.tomorrow.items.map(function (i) {
          return '<li><time>' + esc(i.s) + '</time><button type="button" class="linkish" style="text-decoration:none;color:var(--ink);font-weight:500;text-align:left" data-goday="' + st.tomorrow.day.date + '">' + esc(i.title) + '</button><span class="in">' + (WDS[dateOf(st.tomorrow.day.date).getUTCDay()]) + '</span></li>';
        }));
      }
      if (list.length) html += '<ul class="next-list">' + list.join('') + '</ul>';
    }
    html += '</div></article>';

    /* быстрые действия */
    html += '<div class="quick rv" style="--i:2">' +
      '<button type="button" class="qbtn" data-taxi="hotel"><span class="qi">' + ico('taxi') + '</span><span>Домой на такси<small>адрес по-грузински</small></span></button>' +
      '<a class="qbtn tile" href="tel:' + tel(HOTEL.phone) + '"><span class="qi">' + ico('phone') + '</span><span>Ресепшен<small>позвонить, 24/7</small></span></a>' +
      '<button type="button" class="qbtn gold" data-tab="food" data-open-now><span class="qi">' + ico('food') + '</span><span>Поесть<small>что открыто сейчас</small></span></button>' +
      '<button type="button" class="qbtn tile" data-tab="map" data-locate-go><span class="qi">' + ico('locate') + '</span><span>Где я<small>карта и отель</small></span></button></div>';

    /* Тбилисоба */
    var fd = T.festival.dates, fkey = fd.indexOf(key) >= 0 ? key : addDays(key, 1) === fd[0] ? fd[0] : null;
    if (fkey && st.mode === 'trip') html += festCard(tb, fkey);

    /* погода */
    html += '<div class="sec">' + weatherCard(tb) + '</div>';

    /* еда рядом */
    if (st.mode === 'trip') html += foodNowCard(tb, st);

    /* список дня */
    var cl = key === '2026-10-02' ? 'reception' : key === '2026-10-05' ? 'monday' : key === '2026-10-04' && m >= 1080 ? 'monday' : 'bag';
    if (st.mode === 'trip') html += '<article class="card rv" style="--i:6;margin-top:14px" id="now-cl">' + checklistHTML(cl) + '</article>';

    html += footHTML();
    $('#now-dyn').innerHTML = html;

    /* небо */
    var hero = $('.hero');
    hero.dataset.phase = phase(m);
    setOrb(phase(m));
    $('#hero-dates').textContent = fd.indexOf(key) >= 0 ? 'Тбилисоба · идёт сейчас' : '2–5 октября · Тбилисоба 3–4';
  }

  function festCard(tb, fkey) {
    var key = dkey(tb), m = mins(tb), today = fkey === key;
    var shows = T.festival.shows[fkey] || [];
    var groups = {};
    shows.forEach(function (s) { (groups[s[0]] = groups[s[0]] || []).push(s); });
    var slots = Object.keys(groups).sort().map(function (t) {
      var d = hm(t) - m, cls = today ? (d < -60 ? ' past' : d <= 90 && d > -60 ? ' soon' : '') : '';
      return '<div class="show-slot' + cls + '"><time>' + t + '</time><div class="show-opts">' + groups[t].map(function (s, i) {
        var p = P[s[1]];
        return (i ? '<div class="or">или</div>' : '') + '<button type="button" class="show-opt" data-place="' + s[1] + '"><b>' + esc(s[2]) + '</b>' +
          (s[3] && /[\u10A0-\u10FF]/.test(s[3]) ? ' <span class="ka small" lang="ka">' + esc(s[3]) + '</span>' : '') +
          '<span class="w">' + esc(p.short || p.name) + (s[3] && !/[\u10A0-\u10FF]/.test(s[3]) ? ', ' + esc(s[3]) : '') + (today && d > 0 && d <= 180 ? ' · ' + inText(d) : '') + '</span></button>';
      }).join('') + '</div></div>';
    }).join('');
    var venues = T.festival.venues.map(function (v) {
      var p = P[v[0]], s = openState(p.h, tb);
      return '<button type="button" class="venue-row" data-place="' + v[0] + '">' + catDot(p) + '<span class="vn">' + esc(p.name) + '<small>' + esc(v[2]) + '</small></span>' + stChip(s) + '</button>';
    }).join('');
    return '<div class="ornament rv" style="--i:3">' + ico('borj') + '</div>' +
      '<article class="card fest-card rv" style="--i:3"><div class="card-head"><div><div class="eyebrow">' + (today ? 'Сегодня' : 'Завтра') + ' · 12:00–23:00</div><h3>Тбилисоба</h3></div>' +
      '<span class="ka muted" lang="ka">თბილისობა</span></div>' +
      '<p class="muted small" style="margin:0 0 6px">Городской праздник: пять площадок в Старом городе. Вечером одна сцена на выбор.</p>' +
      slots + '<div class="ornament" style="margin:16px 0 4px">' + ico('borj') + '</div>' + venues +
      '<div class="notice"><b>Перекрытия.</b> С 3 октября площадь Европы, Метехский мост и подъём закрыты для машин - такси туда не подъедет. Обратно в отель - от Рике пешком к мосту или такси с соседних улиц.</div></article>';
  }

  function foodNowCard(tb, st) {
    var m = mins(tb), key = dkey(tb);
    var area = key === '2026-10-05' && m < 990 ? 'tbc' : 'hotel';
    var list = T.places.filter(function (p) { return p.cat === 'food' && p.area === area; });
    var from = area === 'tbc' ? ll(P.tbc) : HOTEL_LL;
    list = list.map(function (p) { return { p: p, s: openState(p.h, tb), d: dist(from, ll(p)) }; })
      .sort(function (a, b) { return (b.s.live ? 1 : 0) - (a.s.live ? 1 : 0) || pickRank(a.p) - pickRank(b.p) || a.d - b.d; }).slice(0, 4);
    return '<article class="card rv" style="--i:5;margin-top:14px"><div class="card-head"><h3>Поесть ' + (area === 'tbc' ? 'у TBC' : 'у отеля') + '</h3>' +
      '<button type="button" class="linkish" data-tab="food" data-seg-go="' + area + '">Все места</button></div><ul class="plist">' +
      list.map(function (x) {
        return '<li><button type="button" class="prow" data-place="' + x.p.id + '">' + catDot(x.p) + '<span class="pn"><b>' + esc(x.p.name) + '</b><small>' +
          esc(x.p.dist || distShort(x.d)) + (x.p.pick ? ' · ' + PICK[x.p.pick] : '') + '</small></span>' + stChip(x.s) + '</button></li>';
      }).join('') + '</ul>' + (area === 'hotel' ? '<p class="muted small" style="margin:10px 0 0">Сил нет выходить - Wolt или Glovo на адрес Hotel Urban Bliss, 24 Odzisi St.</p>' : '') + '</article>';
  }

  function footHTML() {
    return '<footer class="foot">' + ico('borj') + 'Сверено ' + esc(T.checked) + ' по Тбилиси. Часы и цены могут меняться - перед выходом гляньте карту.<br>' +
      '<span class="ka" lang="ka">გაუმარჯოს!</span> · Время на сайте всегда тбилисское, UTC+4.</footer>';
  }

  /* ---------- небо ---------- */
  function buildStars() {
    var g = $('#stars'), s = 7, out = '';
    var rnd = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (var i = 0; i < 46; i++) {
      out += '<circle class="star" cx="' + (rnd() * 400).toFixed(1) + '" cy="' + (rnd() * 190).toFixed(1) + '" r="' + (0.5 + rnd() * 1.1).toFixed(2) + '" style="opacity:' + (0.35 + rnd() * 0.6).toFixed(2) + '"/>';
    }
    g.innerHTML = out;
  }
  function setOrb(ph) {
    var orb = $('#orb'), glow = $('#orb-glow'), cut = $('#crescent-cut');
    var cfg = {
      day: [325, 58, 17, '#fff6d6', 46, null],
      dawn: [70, 150, 21, '#ffe1b4', 60, null],
      dusk: [318, 168, 26, '#ffd08a', 70, null],
      night: [322, 60, 15, '#f8ecc8', 40, 'url(#crescent)']
    }[ph];
    orb.setAttribute('cx', cfg[0]); orb.setAttribute('cy', cfg[1]); orb.setAttribute('r', cfg[2]); orb.setAttribute('fill', cfg[3]);
    glow.setAttribute('cx', cfg[0]); glow.setAttribute('cy', cfg[1]); glow.setAttribute('r', cfg[4]);
    glow.setAttribute('opacity', ph === 'night' ? '.35' : '.75');
    if (cfg[5]) { orb.setAttribute('mask', cfg[5]); cut.setAttribute('cx', cfg[0] + 7); cut.setAttribute('cy', cfg[1] - 5); cut.setAttribute('r', cfg[2] - 1); } else orb.removeAttribute('mask');
  }

  /* ---------- вкладка «Дни» ---------- */
  function renderDays() {
    var tb = tbNow(), today = dkey(tb), m = mins(tb);
    if (!state.day) state.day = dayOf(today) ? today : T.days[0].date;
    var day = dayOf(state.day), items = itemsOf(day), isToday = day.date === today, isPast = day.date < today;
    var html = '<div class="view-head rv" style="--i:0"><div class="eyebrow">Программа</div><h2>Четыре дня <em>в Тбилиси</em></h2></div>';
    html += '<div class="leaves rv" style="--i:1" role="tablist">' + T.days.map(function (d) {
      var w = T.weather.days[d.date], tmax = w ? Math.max.apply(null, w.parts.map(function (p) { return p[1]; })) : null;
      var wi = w ? (w.warn ? 'wind' : (w.parts[1] || w.parts[0])[4]) : 'cloud';
      return '<button type="button" class="leaf" role="tab" data-day="' + d.date + '" aria-pressed="' + (d.date === state.day) + '">' +
        (d.date === today ? '<span class="today">сегодня</span>' : '') + '<span class="wd">' + d.wd + '</span><span class="dn">' + d.num + '</span>' +
        (tmax != null ? '<span class="lw">' + ico(wi) + deg(tmax) + '</span>' : '') + '</button>';
    }).join('') + '</div>';

    html += '<h2 class="day-title rv" style="--i:2">' + esc(day.title) + '</h2><p class="lead rv" style="--i:2">' + esc(day.lead) + '</p>';

    var w = T.weather.days[day.date];
    if (w) {
      html += '<div class="wx-parts rv" style="--n:' + w.parts.length + ';--i:3">' + w.parts.map(function (p) {
        return '<div class="wx-part"><div class="p">' + p[0] + '</div>' + wxIcon(p[4]) + '<div class="t num">' + deg(p[1]) + '</div><div class="f">' + (p[2] != null ? 'ощущ. ' + deg(p[2]) : esc(p[3] || '&nbsp;')) + '</div></div>';
      }).join('') + '</div><div class="wx-head rv' + (w.warn ? ' warn' : '') + '" style="--i:3">' + ico(w.warn ? 'wind' : 'check') + '<div><b>' + esc(w.head) + '</b>' + (w.wind ? ' · ветер ' + esc(w.wind) : '') + (w.note ? '<div class="muted small">' + esc(w.note) + '</div>' : '') + '</div></div>';
    }

    if (day.train) {
      var tr = T.trains[state.train];
      html += '<div class="train-switch rv" style="--i:4" role="group" aria-label="Время поезда">' + Object.keys(T.trains).map(function (k) {
        return '<button type="button" data-train="' + k + '" aria-pressed="' + (k === state.train) + '"><b class="num">' + k + '</b><small>' + (k === '17:10' ? 'по расписанию' : 'из разговора') + '</small></button>';
      }).join('') + '</div><div class="notice rv" style="--i:4">' + ico('train', 'sr') + '<b>Поезд ' + esc(tr.label) + ':</b> ' + esc(tr.status) + '. Сверьте время с билетом - от него зависит весь день. Выбор запомнится.</div>';
    }

    html += '<ol class="timeline">' + items.map(function (it, idx) {
      var cls = ['tl'];
      if (it.opt) cls.push('opt');
      if (it.tip) cls.push('tip');
      if (it.key) cls.push('key');
      if (it.done) cls.push('done');
      if (isPast || (isToday && hm(it.e) <= m && !it.done)) cls.push('past');
      if (isToday && !it.done && hm(it.s) <= m && m < hm(it.e) && !it.tip) cls.push('cur');
      var flags = [];
      if (it.key) flags.push('<span class="flag">главное</span>');
      if (it.opt) flags.push('<span class="flag o">по желанию</span>');
      if (it.tip) flags.push('<span class="flag o">запасной вариант</span>');
      if (cls.indexOf('cur') >= 0) flags.push('<span class="flag n">сейчас</span>');
      var chips = [];
      if (it.place) chips.push(placeChip(it.place));
      (it.places || []).forEach(function (id) { chips.push(placeChip(id)); });
      if (it.route) chips.push(routeChip(it.route, it.route === 'sunday' ? 'Воскресная петля' : 'Пешком от отеля'));
      var body = '<h4>' + esc(it.title) + (it.ka ? '<span class="ka" lang="ka">' + esc(it.ka) + '</span>' : '') + '</h4>' + (it.text ? '<p>' + esc(it.text) + '</p>' : '');
      if (it.choice) {
        body += '<div class="choice">' + it.choice.map(function (c) {
          return '<button type="button" data-place="' + c[3] + '"><time class="num">' + c[0] + '</time><div><b>' + esc(c[1]) + '</b><span>' + esc(c[2]) + '</span></div></button>';
        }).join('') + '</div>';
      }
      if (flags.length) body += '<div class="tl-flags">' + flags.join('') + '</div>';
      if (chips.length) body += '<div class="chips">' + chips.join('') + '</div>';
      if (it.check) body += '<div class="card" style="margin-top:10px;padding:4px 14px">' + checklistHTML(it.check, true) + '</div>';
      return '<li class="' + cls.join(' ') + ' rv" style="--i:' + Math.min(idx + 5, 12) + '" id="it-' + day.date + '-' + idx + '"><div class="tt num">' + esc(it.t) + '</div><div class="dot"></div><div class="tl-body">' + body + '</div></li>';
    }).join('') + '</ol>';

    if (day.date === '2026-10-04') html += '<div class="card rv" style="--i:12"><div class="card-head"><h3>Если устанем</h3></div><p class="muted small" style="margin:0">Хватит Рике, площади Европы и одного вечернего концерта. Обратно в гору - такси: от отеля всё ниже, подъём до 89 метров.</p></div>';
    $('#view-days').innerHTML = html + footHTML();
  }

  /* ---------- вкладка «Еда» ---------- */
  var PICK = { main: 'главный выбор', backup: 'запасной', fast: 'быстрее всех', late: 'поздно вечером' };
  var pickRank = function (p) { return { main: 0, backup: 1, fast: 2, late: 3 }[p.pick] != null ? { main: 0, backup: 1, fast: 2, late: 3 }[p.pick] : 9; };
  var SEGS = [
    ['hotel', 'У отеля', 'Ужин в 200 метрах, без подъёма в гору. Сил выйти нет - Wolt или Glovo на 24 Odzisi St.'],
    ['tbc', 'У TBC', 'Обед в рабочие дни и в понедельник перед поездом. Расстояния - от TBC Concept.'],
    ['old', 'Старый город', 'Воскресенье у Тбилисобы: Абанотубани и Сололаки.'],
    ['rust', 'Руставели', 'Рядом с музеями на Руставели.'],
    ['shop', 'Магазины', 'Продукты, банкомат, аптеки и вино у отеля.']
  ];
  function renderFood() {
    var tb = tbNow();
    if (!state.seg) state.seg = dkey(tb) === '2026-10-05' ? 'tbc' : 'hotel';
    var seg = SEGS.filter(function (s) { return s[0] === state.seg; })[0] || SEGS[0];
    var html = '<div class="view-head rv" style="--i:0"><div class="eyebrow">Где поесть</div><h2>Хинкали <em>по пути</em></h2><p class="lead">' + esc(seg[2]) + '</p></div>';
    html += '<div class="segs rv" style="--i:1" role="tablist">' + SEGS.map(function (s) {
      return '<button type="button" class="chip" role="tab" data-seg="' + s[0] + '" aria-pressed="' + (s[0] === state.seg) + '">' + esc(s[1]) + '</button>';
    }).join('') + '</div>';
    html += '<div class="filters rv" style="--i:1"><button type="button" class="chip" data-filter="open" aria-pressed="' + state.openOnly + '">' + ico('clock') + 'Открыто сейчас</button>' +
      '<button type="button" class="chip" data-filter="near" aria-pressed="' + state.nearMe + '">' + ico('locate') + 'Ближе ко мне</button></div>';

    var isShop = seg[0] === 'shop';
    var from = seg[0] === 'tbc' ? ll(P.tbc) : HOTEL_LL;
    var list = T.places.filter(function (p) { return isShop ? p.cat === 'shop' : p.cat === 'food' && p.area === seg[0]; })
      .map(function (p) { return { p: p, s: openState(p.h, tb), d: dist(from, ll(p)), dm: me ? dist(me, ll(p)) : null }; });
    if (state.openOnly) list = list.filter(function (x) { return x.s.live; });
    list.sort(function (a, b) {
      if (state.nearMe && me) return a.dm - b.dm;
      return isShop ? a.d - b.d : pickRank(a.p) - pickRank(b.p) || (b.p.rating || 0) - (a.p.rating || 0);
    });

    var out = '';
    if (!list.length) out = '<div class="nope rv" style="--i:2"><h4>Пусто</h4><p>Сейчас здесь ничего не открыто. Снимите фильтр или загляните в соседний раздел: Driver 24, Spar и Nikora у метро работают круглосуточно, Ghebi у TBC - тоже.</p></div>';
    else if (isShop) {
      out = '<article class="card rv" style="--i:2"><ul class="plist">' + list.map(function (x) {
        return '<li><button type="button" class="prow" data-place="' + x.p.id + '">' + catDot(x.p) + '<span class="pn"><b>' + esc(x.p.name) + '</b><small>' + esc(x.p.what || '') + '</small><small style="display:block">' +
          esc(x.p.dist || distShort(x.d)) + (x.dm != null ? ' · от вас ' + distShort(x.dm) : '') + '</small></span>' + stChip(x.s) + '</button></li>';
      }).join('') + '</ul></article>';
    } else {
      out = list.map(function (x, i) { return foodCard(x, i); }).join('');
    }
    html += '<div class="stack" style="margin-top:14px">' + out + '</div>';
    $('#view-food').innerHTML = html + footHTML();
  }
  function foodCard(x, i) {
    var p = x.p, stats = [];
    if (p.rating) stats.push('<div><b class="num">' + dec(p.rating) + ' ★</b><span>Google</span></div>');
    if (p.reviews) stats.push('<div><b class="num">' + nf.format(p.reviews) + '</b><span>' + plural(p.reviews, ['отзыв', 'отзыва', 'отзывов']) + '</span></div>');
    if (p.price) stats.push('<div><b class="num">' + esc(p.price) + ' <span class="lari">₾</span></b><span>на одного</span></div>');
    var ht = (x.s && x.s.t || '').toLowerCase();
    var tags = (p.tags || []).filter(function (t) { return t.toLowerCase() !== ht; }).map(function (t) { return '<span class="tag' + (/наличн/.test(t) ? ' cash' : '') + '">' + esc(t) + '</span>'; }).join('');
    return '<article class="card food-card rv" style="--i:' + Math.min(i + 2, 9) + '">' +
      '<div class="fc-top"><span class="fc-rank num">' + (i + 1) + '</span><div class="fc-name"><h3>' + esc(p.name) + '</h3>' +
      (p.ka ? '<span class="ka" lang="ka">' + esc(p.ka) + '</span>' : '') +
      '<div class="small muted">' + esc(p.dist || distShort(x.d)) + (x.dm != null ? ' · от вас ' + distShort(x.dm) : '') + '</div>' +
      (p.pick ? '<span class="flag fc-pick' + (p.pick === 'main' ? '' : ' o') + '">' + PICK[p.pick] + '</span>' : '') + '</div></div>' +
      (stats.length ? '<div class="fc-stats" style="grid-template-columns:repeat(' + stats.length + ',1fr)">' + stats.join('') + '</div>' : '') +
      '<div class="fc-body"><p>' + esc(p.what || '') + '</p>' + (p.order ? '<p class="fc-order"><b>Что взять:</b> ' + esc(p.order) + '</p>' : '') +
      (p.warn ? '<p class="fc-warn">' + esc(p.warn) + '</p>' : '') + (tags ? '<div class="tags">' + tags + '</div>' : '') + '</div>' +
      '<div class="fc-foot">' + stChip(x.s) + '<div class="fc-actions">' +
      '<a class="chip" href="' + gWalk(p) + '" target="_blank" rel="noopener">' + ico('walk') + 'Маршрут</a>' +
      '<button type="button" class="chip" data-place="' + p.id + '">Подробнее</button></div></div></article>';
  }

  /* ---------- вкладка «Справка» ---------- */
  function renderInfo() {
    var html = '<div class="view-head rv" style="--i:0"><div class="eyebrow">Справка</div><h2>Всё <em>под рукой</em></h2><p class="lead">Адреса для таксиста, отель, высоты, маршруты и списки.</p></div>';

    html += '<div class="addr-cards rv" style="--i:1">' + ['hotel', 'tbc', 'silk', 'station'].map(function (id, i) {
      var p = P[id];
      return '<button type="button" class="addr' + (i ? ' alt' : '') + '" data-taxi="' + id + '"><b>' + esc(p.short || p.name) + '</b><span class="ka" lang="ka">' + esc(p.ka) + '</span><small>Показать водителю →</small></button>';
    }).join('') + '</div>';

    /* отель */
    html += '<article class="card rv" style="--i:2;margin-top:14px"><div class="card-head"><div><div class="eyebrow">Наш отель</div><h3>' + esc(HOTEL.name) + '</h3></div>' + catDot(HOTEL) + '</div>' +
      '<p class="muted small" style="margin:0">' + esc(HOTEL.addr) + ' · ' + esc(HOTEL.rating) + '</p>' +
      '<div class="facts"><div><span>Завтрак</span><b>9:00–11:00</b></div><div><span>Выезд</span><b>до 12:00</b></div>' +
      '<div><span>Ресепшен</span><b>круглосуточно</b></div><div><span>Оплата</span><b>наличными</b></div>' +
      '<div><span>Багаж</span><b>можно оставить</b></div><div><span>Телефон</span><b><a href="tel:' + tel(HOTEL.phone) + '">' + esc(HOTEL.phone) + '</a></b></div></div>' +
      '<div class="actions"><button type="button" class="act" data-place="hotel">' + ico('pin') + 'Подробнее</button>' +
      '<a class="act" href="https://geo-spec.github.io/tbilisi-urban-bliss/" target="_blank" rel="noopener">' + ico('ext') + 'Статья об отеле</a></div></article>';

    /* высоты */
    html += '<article class="card rv" style="--i:3;margin-top:14px"><div class="card-head"><div><div class="eyebrow">Почему обратно на такси</div><h3>Всё ниже отеля</h3></div>' + ico('up', 'sr') + '</div>' +
      elevationSVG() + '<p class="muted small" style="margin:6px 0 0">Отель стоит на 488 м. Рике на 89 м ниже - это примерно 30-этажный дом. Вниз - прогулка, наверх - такси за 4–5 минут.</p></article>';

    /* маршруты */
    html += '<article class="card rv" style="--i:4;margin-top:14px"><div class="card-head"><h3>Как добраться</h3></div><table class="tbl"><thead><tr><th>Куда</th><th>Пешком</th><th>Такси</th></tr></thead><tbody>' +
      T.routesTable.map(function (r) {
        return '<tr><td>' + esc(r[0]) + (r[3] ? '<small>Метро: ' + esc(r[3]) + '</small>' : '') + '</td><td>' + esc(r[1] || '-') + '</td><td>' + esc(r[2] || '-') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="chips" style="margin-top:12px">' + routeChip('hotel_rike', 'Отель → Рике') + routeChip('hotel_avlabari', 'Отель → метро') + routeChip('sunday', 'Воскресная петля') + '</div></article>';

    /* списки */
    ['monday', 'reception', 'bag'].forEach(function (k, i) {
      html += '<article class="card rv" style="--i:' + (5 + i) + ';margin-top:14px" id="cl-' + k + '">' + checklistHTML(k) + '</article>';
    });

    /* перекрытия */
    html += '<article class="card rv" style="--i:8;margin-top:14px"><div class="card-head"><div><div class="eyebrow">Тбилисоба</div><h3>Перекрытия улиц</h3></div>' + ico('alert', 'sr') + '</div><table class="tbl"><tbody>' +
      T.festival.closures.map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td class="num" style="white-space:nowrap">' + esc(c[1]) + '</td></tr>'; }).join('') + '</tbody></table></article>';

    /* фразы */
    var phrases = [['გამარჯობა', 'гамарджоба', 'здравствуйте'], ['მადლობა', 'мадлоба', 'спасибо'], ['კი / არა', 'ки / ара', 'да / нет'],
      ['რა ღირს?', 'ра гхирс?', 'сколько стоит?'], ['ანგარიში, თუ შეიძლება', 'ангариши, ту шеидзлеба', 'счёт, пожалуйста'], ['გემრიელია!', 'гемриелиа!', 'вкусно!']];
    html += '<article class="card rv" style="--i:9;margin-top:14px"><div class="card-head"><div><div class="eyebrow">Шесть слов</div><h3>По-грузински</h3></div>' + ico('chat', 'sr') + '</div><table class="tbl"><tbody>' +
      phrases.map(function (p) { return '<tr><td><span class="ka" lang="ka">' + p[0] + '</span><small>' + p[1] + '</small></td><td>' + p[2] + '</td></tr>'; }).join('') +
      '</tbody></table><p class="muted small" style="margin:8px 0 0">По-русски в Тбилиси понимают почти везде, но «мадлоба» приятно слышать всем.</p></article>';

    /* экстренное */
    html += '<article class="card rv" style="--i:10;margin-top:14px"><div class="card-head"><h3>Если что-то пошло не так</h3></div><ul class="plist">' +
      '<li><a class="prow" href="tel:112" style="text-decoration:none;color:inherit"><span class="cat-dot pi" style="--c:var(--bad)">' + ico('alert') + '</span><span class="pn"><b>112</b><small>Единый экстренный номер</small></span></a></li>' +
      '<li><a class="prow" href="tel:' + tel(HOTEL.phone) + '" style="text-decoration:none;color:inherit">' + catDot(HOTEL) + '<span class="pn"><b>' + esc(HOTEL.phone) + '</b><small>Ресепшен отеля, круглосуточно</small></span></a></li>' +
      '<li><a class="prow" href="tel:1331" style="text-decoration:none;color:inherit"><span class="cat-dot c-base pi">' + ico('train') + '</span><span class="pn"><b>1331</b><small>Справочная Georgian Railway, также +995 32 219 90 10</small></span></a></li>' +
      '<li><button type="button" class="prow" data-place="s-gpc">' + catDot(P['s-gpc']) + '<span class="pn"><b>Аптека GPC, 24/7</b><small>У метро «Авлабари», ближе к отелю аптек нет</small></span></button></li></ul></article>';

    /* офлайн */
    html += '<article class="card rv" style="--i:11;margin-top:14px" id="offline-card">' + offlineHTML() + '</article>';

    /* источники */
    html += '<article class="card rv" style="--i:12;margin-top:14px"><div class="card-head"><h3>Источники</h3></div><ul class="srcs">' +
      T.sources.map(function (s) { return '<li><a href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + esc(s[0]) + '</a></li>'; }).join('') +
      '</ul><p class="muted small" style="margin:10px 0 0">Карта: тайлы © Esri, данные © OpenStreetMap contributors. Погода - Open-Meteo и Яндекс Погода.</p></article>';

    $('#view-info').innerHTML = html + footHTML();
  }
  function elevationSVG() {
    var E = T.elevation, W = 330, H = 150, x0 = 26, x1 = W - 26, y0 = 26, y1 = 120;
    var X = function (i) { return x0 + i * (x1 - x0) / (E.length - 1); };
    var Y = function (v) { return y0 + (-v) / 89 * (y1 - y0); };
    var pts = E.map(function (e, i) { return X(i).toFixed(1) + ',' + Y(e[1]).toFixed(1); });
    var area = 'M' + pts.join(' L') + ' L' + x1 + ',' + (y1 + 18) + ' L' + x0 + ',' + (y1 + 18) + ' Z';
    var out = '<svg class="elev" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Высоты относительно отеля: Самеба минус 39 метров, Авлабари минус 57, TBC минус 74, Рике минус 89">' +
      '<line class="gl" x1="' + x0 + '" x2="' + x1 + '" y1="' + y0 + '" y2="' + y0 + '"/>' +
      '<path class="ground" d="' + area + '"/>';
    E.forEach(function (e, i) {
      var x = X(i), y = Y(e[1]);
      out += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (i ? 4.5 : 6) + '"' + (i ? '' : ' class="h"') + '/>' +
        '<text x="' + x.toFixed(1) + '" y="' + (y - 11).toFixed(1) + '" text-anchor="middle">' + esc(e[0]) + '</text>' +
        (i ? '<text class="m" x="' + x.toFixed(1) + '" y="' + (y + 18).toFixed(1) + '" text-anchor="middle">−' + Math.abs(e[1]) + ' м</text>' : '<text class="m" x="' + x.toFixed(1) + '" y="' + (y + 20).toFixed(1) + '" text-anchor="middle">488 м</text>');
    });
    return out + '</svg>';
  }

  /* ---------- нижний лист места ---------- */
  var sheetOpen = false, taxiOpen = false;
  function openPlace(id) {
    var p = P[id];
    if (!p) return;
    var tb = tbNow(), s = openState(p.h, tb), rows = [];
    if (p.addr) rows.push(['pin', esc(p.addr)]);
    if (p.hText || p.h) rows.push(['clock', esc(p.hText || hoursText(p.h))]);
    if (p.phone) rows.push(['phone', '<a href="tel:' + tel(p.phone) + '">' + esc(p.phone) + '</a>']);
    if (p.rating) rows.push(['star', typeof p.rating === 'number' ? dec(p.rating) + ' ★ в Google' + (p.reviews ? ', ' + nf.format(p.reviews) + ' ' + plural(p.reviews, ['отзыв', 'отзыва', 'отзывов']) : '') : esc(p.rating)]);
    if (p.price) rows.push(['cash', p.cat === 'museum' ? 'Билет ' + esc(p.price) : esc(p.price) + ' ₾ на человека']);
    if (id !== T.hotelId) rows.push(['walk', 'От отеля ' + distText(dist(HOTEL_LL, ll(p))) + (p.dist ? '<br><span class="muted">В гиде: ' + esc(p.dist) + '</span>' : '')]);
    if (me) rows.push(['locate', 'От вас ' + distText(dist(me, ll(p)))]);
    var text = [p.note, p.what].filter(Boolean).map(function (t) { return '<p class="sh-text">' + esc(t) + '</p>'; }).join('');
    if (p.order) text += '<p class="sh-text fc-order"><b>Что взять:</b> ' + esc(p.order) + '</p>';
    if (p.warn) text += '<p class="fc-warn">' + esc(p.warn) + '</p>';
    var tags = (p.tags || []).map(function (t) { return '<span class="tag' + (/наличн/.test(t) ? ' cash' : '') + '">' + esc(t) + '</span>'; }).join('');
    var acts = '<a class="act pri" href="' + gWalk(p) + '" target="_blank" rel="noopener">' + ico('walk') + 'Пешком · Google</a>' +
      '<a class="act" href="' + yaWalk(p) + '" target="_blank" rel="noopener">' + ico('route') + 'Яндекс Карты</a>' +
      '<button type="button" class="act" data-map="' + id + '">' + ico('map') + 'На карте</button>' +
      (p.phone ? '<a class="act" href="tel:' + tel(p.phone) + '">' + ico('phone') + 'Позвонить</a>' : '<a class="act" href="' + gOpen(p) + '" target="_blank" rel="noopener">' + ico('ext') + 'В Google Maps</a>') +
      (p.ka ? '<button type="button" class="act wide" data-taxi="' + id + '">' + ico('taxi') + 'Показать адрес водителю</button>' : '');
    var links = (p.links || []).map(function (l) { return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + ' ↗</a>'; }).join('');
    $('#sheet').innerHTML = '<div class="grab"></div><div class="sh-head">' + catDot(p) + '<div><div class="eyebrow">' + CATNAME[p.cat] + '</div><h3>' + esc(p.name) + '</h3>' +
      (p.ka ? '<span class="ka" lang="ka">' + esc(p.ka) + (p.kaNote ? ' · ' + esc(p.kaNote) : '') + '</span>' : '') + '</div>' +
      '<button type="button" class="icon-btn sh-close" data-close aria-label="Закрыть">' + ico('close') + '</button></div>' +
      '<div style="margin:12px 0 4px">' + stChip(s) + '</div>' + text + (tags ? '<div class="tags" style="margin-bottom:12px">' + tags + '</div>' : '') +
      rows.map(function (r) { return '<div class="sh-row">' + ico(r[0]) + '<div>' + r[1] + '</div></div>'; }).join('') +
      '<div class="actions">' + acts + '</div>' + (links ? '<div class="ext">' + links + '</div>' : '');
    $('#sheet').setAttribute('aria-label', p.name);
    showSheet();
  }
  function showSheet() {
    var sh = $('#sheet');
    sh.scrollTop = 0;
    sh.style.transform = '';
    if (!sheetOpen) { history.pushState({ layer: 'sheet' }, ''); sheetOpen = true; }
    sh.classList.add('on'); $('#scrim').classList.add('on');
    setTimeout(function () { sh.focus({ preventScroll: true }); }, 50);
  }
  function hideLayers() {
    sheetOpen = false; taxiOpen = false;
    $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); $('#taxi').classList.remove('on');
  }
  function closeLayer() { if (history.state && history.state.layer) history.back(); else hideLayers(); }

  /* свайп вниз закрывает лист */
  (function () {
    var sh = $('#sheet'), y0 = null, dy = 0;
    sh.addEventListener('touchstart', function (e) { if (sh.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; } }, { passive: true });
    sh.addEventListener('touchmove', function (e) {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0) sh.style.transform = 'translateY(' + dy + 'px)'; else { y0 = null; sh.style.transform = ''; }
    }, { passive: true });
    sh.addEventListener('touchend', function () {
      sh.style.transition = '';
      if (y0 != null && dy > 90) closeLayer(); else sh.style.transform = '';
      y0 = null;
    });
  })();

  /* ---------- «Покажи водителю» ---------- */
  var TAXI = ['hotel', 'tbc', 'silk', 'station'];
  function openTaxi(id) {
    if (TAXI.indexOf(id) < 0) id = 'hotel';
    var p = P[id], ru = {
      hotel: 'Hotel Urban Bliss. Квартал Элиа, верхнее Авлабари, над собором Самеба.',
      tbc: 'TBC Concept, коворкинг. Улица Марджанишвили, 7.',
      silk: 'Государственный музей шёлка. Улица Цабадзе, 6.',
      station: 'Центральный вокзал, Вокзальная площадь.'
    }[id];
    var phone = id === 'station' ? null : p.phone;
    $('#taxi').innerHTML = '<div class="t-tabs" role="tablist">' + TAXI.map(function (t) {
      return '<button type="button" data-taxi="' + t + '" aria-pressed="' + (t === id) + '">' + esc(P[t].short || P[t].name) + '</button>';
    }).join('') + '</div><button type="button" class="icon-btn t-close" data-close aria-label="Закрыть">' + ico('close') + '</button>' +
      '<div class="t-eyebrow">Покажите водителю</div><div class="t-ka2" lang="ka" style="margin-top:14px">გთხოვთ, მიმიყვანეთ:</div>' +
      '<div class="t-ka" lang="ka">' + esc(p.ka) + '</div><div class="t-ka2" lang="ka">' + esc(p.kaNote || '') + '</div>' +
      '<div class="t-lat">' + esc(p.name) + (p.addr ? '<br>' + esc(p.addr) : '') + '</div><div class="t-ru">' + esc(ru) + '</div>' +
      '<div class="t-actions">' + (phone ? '<a class="act pri" href="tel:' + tel(phone) + '">' + ico('phone') + (id === 'hotel' ? 'Ресепшен объяснит дорогу' : 'Позвонить') + '</a>' : '') +
      '<button type="button" class="act" data-copy="' + id + '">' + ico('copy') + 'Скопировать адрес</button>' +
      '<a class="act" href="' + gDrive(p) + '" target="_blank" rel="noopener">' + ico('taxi') + 'Маршрут на машине</a></div>';
    if (!taxiOpen) {
      if (sheetOpen) { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); sheetOpen = false; history.replaceState({ layer: 'taxi' }, ''); }
      else history.pushState({ layer: 'taxi' }, '');
      taxiOpen = true;
    }
    $('#taxi').classList.add('on');
  }
  function copyAddr(id) {
    var p = P[id], txt = p.ka + (p.kaNote ? ', ' + p.kaNote : '') + ' · ' + p.name + (p.addr ? ', ' + p.addr : '') + ', Tbilisi';
    var done = function () { toast('Адрес скопирован - вставьте в Bolt или Yandex Go'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
    else { fallbackCopy(txt); done(); }
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* нет буфера */ } ta.remove();
  }

  var toastT;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 3200);
  }

  /* ---------- геолокация ---------- */
  var watchId = null, meWaiters = [];
  function locate(cb) {
    if (cb) meWaiters.push(cb);
    if (me && cb) { flushMe(); return; }
    if (!navigator.geolocation) { toast('Геолокация в этом браузере недоступна'); return; }
    if (watchId != null) return;
    toast('Ищу, где вы…');
    watchId = navigator.geolocation.watchPosition(function (pos) {
      var p = [pos.coords.latitude, pos.coords.longitude];
      if (dist(p, HOTEL_LL) > 40000) {
        toast('Похоже, вы не в Тбилиси - расстояния считаю от отеля');
        navigator.geolocation.clearWatch(watchId); watchId = null; meWaiters = []; return;
      }
      var first = !me;
      me = p; me.acc = pos.coords.accuracy;
      updateMeMarker();
      if (first || meWaiters.length) { flushMe(); if (state.tab === 'food' && state.nearMe) renderFood(); }
    }, function (err) {
      toast(err.code === 1 ? 'Нет доступа к геолокации - разрешите её в настройках браузера' : 'Не получилось определить место');
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null; meWaiters = [];
      state.nearMe = false; if (state.tab === 'food') renderFood();
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }
  function flushMe() { var w = meWaiters; meWaiters = []; w.forEach(function (f) { f(me); }); }

  /* ---------- карта ---------- */
  var map = null, tiles = null, groups = {}, pins = {}, lines = {}, meMarker = null, meCircle = null, selPin = null;
  /* Esri: без ключа, с CORS, подписи латиницей и по-грузински. Тёмная тема - подложка и слой подписей. */
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var TILE = {
    light: [['World_Street_Map', 18]],
    dark: [['Canvas/World_Dark_Gray_Base', 16], ['Canvas/World_Dark_Gray_Reference', 16]]
  };
  var tileUrl = function (svc) { return ESRI + svc + '/MapServer/tile/{z}/{y}/{x}'; };
  var MAPCATS = [['all', 'Всё'], ['fest', 'Тбилисоба'], ['food', 'Еда'], ['shop', 'Магазины'], ['museum', 'Музеи'], ['base', 'Опорные']];
  var ROUTEINFO = {
    hotel_rike: ['Отель → Рике', 'через Самеба, вниз'],
    hotel_avlabari: ['Отель → метро', 'вниз к «Авлабари»'],
    sunday: ['Воскресная петля', 'Рике → пл. Европы → бани → Легвтахеви → Гудиашвили → Орбелиани']
  };
  var groupOf = function (c) { return c === 'sight' ? 'base' : c; };
  function pinIcon(p) {
    var big = p.id === T.hotelId;
    var n = big ? 'hotel' : p.id === 'station' ? 'train' : CATICON[p.cat];
    return L.divIcon({
      className: '',
      html: '<div class="pin c-' + p.cat + (big ? ' big home' : '') + '" data-pin="' + p.id + '">' + ico(n) + '</div>',
      iconSize: big ? [40, 40] : [30, 30],
      iconAnchor: big ? [20, 46] : [15, 35],
      tooltipAnchor: big ? [10, -26] : [6, -20]
    });
  }
  function setTiles() {
    if (!map) return;
    var mode = document.documentElement.dataset.mode;
    if (tiles) map.removeLayer(tiles);
    tiles = L.layerGroup(TILE[mode].map(function (t, i) {
      return L.tileLayer(tileUrl(t[0]), {
        maxNativeZoom: t[1], maxZoom: 19, crossOrigin: true, className: i ? 'tiles-ref' : 'tiles-base',
        attribution: i ? '' : 'Tiles © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> · Esri, HERE, Garmin, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      });
    })).addTo(map);
  }
  function initMap() {
    if (map) return true;
    if (!window.L) { $('#map').innerHTML = '<p style="padding:90px 24px;text-align:center" class="muted">Карта не загрузилась. Обновите страницу, когда появится связь.</p>'; return false; }
    map = L.map('map', { zoomControl: false, minZoom: 12, maxZoom: 19, zoomSnap: 0.5, attributionControl: true });
    map.fitBounds(L.latLngBounds(['hotel', 'f-orbeliani', 'f-legv', 'f-gudiashvili', 'sameba'].map(function (id) { return ll(P[id]); })), { padding: [28, 28] });
    map.attributionControl.setPrefix(false);
    setTiles();
    var always = L.layerGroup().addTo(map);
    T.places.forEach(function (p) {
      var mk = L.marker(ll(p), { icon: pinIcon(p), title: p.name, riseOnHover: true, keyboard: true, zIndexOffset: p.id === T.hotelId ? 1000 : p.cat === 'fest' ? 400 : p.cat === 'base' ? 300 : 0 });
      mk.on('click', function () { openPlace(p.id); });
      if (p.cat === 'base' || p.cat === 'fest' || p.cat === 'sight' || p.cat === 'museum') {
        mk.bindTooltip(esc(p.short || p.name), { permanent: true, direction: 'right', className: 'lbl', opacity: 1 });
      }
      pins[p.id] = mk;
      if (p.id === T.hotelId) { mk.addTo(always); return; }
      var g = groupOf(p.cat);
      if (!groups[g]) groups[g] = L.layerGroup().addTo(map);
      mk.addTo(groups[g]);
    });
    Object.keys(ROUTES).forEach(function (k) {
      var r = ROUTES[k];
      lines[k] = L.layerGroup([
        L.polyline(r.pts, { className: 'route-halo', weight: 9, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }),
        L.polyline(r.pts, { className: 'route' + (k === 'sunday' ? ' gold' : ''), weight: 4.5, opacity: 1, dashArray: '1 9', lineCap: 'round', lineJoin: 'round', interactive: false })
      ]);
    });
    map.on('zoomend', zoomCls); zoomCls();
    renderMapChrome();
    if (me) updateMeMarker();
    return true;
  }
  function zoomCls() { $('#map').classList.toggle('zoomed-out', map.getZoom() < 15); }
  function renderMapChrome() {
    $('#map-chips').innerHTML = MAPCATS.map(function (c) {
      return '<button type="button" class="chip" data-cat="' + c[0] + '" aria-pressed="' + (state.mapCat === c[0]) + '">' + esc(c[1]) + '</button>';
    }).join('');
    var on = Object.keys(state.routes).filter(function (k) { return state.routes[k]; });
    $('#map-legend').innerHTML = Object.keys(ROUTEINFO).map(function (k) {
      var r = ROUTES[k];
      return '<button type="button" class="chip" data-route-toggle="' + k + '" aria-pressed="' + !!state.routes[k] + '"><span class="sw' + (k === 'sunday' ? ' g' : '') + '"></span>' + esc(ROUTEINFO[k][0]) + (r ? ' · ' + r.min + ' мин' : '') + '</button>';
    }).join('') + (on.length === 1 && ROUTES[on[0]] ? '<span class="chip" style="font-weight:400">' + dec((ROUTES[on[0]].m / 1000).toFixed(1)) + ' км · ' + esc(ROUTEINFO[on[0]][1]) + '</span>' : '');
  }
  function setMapCat(c) {
    state.mapCat = c;
    Object.keys(groups).forEach(function (g) {
      var show = c === 'all' || c === g;
      if (show && !map.hasLayer(groups[g])) groups[g].addTo(map);
      if (!show && map.hasLayer(groups[g])) map.removeLayer(groups[g]);
    });
    renderMapChrome();
    var pts = T.places.filter(function (p) { return c === 'all' || groupOf(p.cat) === c || p.id === T.hotelId; }).map(ll);
    if (c !== 'all' && pts.length) map.flyToBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16, duration: 0.6 });
  }
  function toggleRoute(k, force) {
    var on = force != null ? force : !state.routes[k];
    state.routes[k] = on;
    if (on) { lines[k].addTo(map); map.flyToBounds(L.latLngBounds(ROUTES[k].pts).pad(0.2), { maxZoom: 17, duration: 0.6 }); }
    else map.removeLayer(lines[k]);
    renderMapChrome();
  }
  function showOnMap(id) {
    go('map');
    setTimeout(function () {
      if (!initMap()) return;
      var p = P[id];
      if (p.id !== T.hotelId && state.mapCat !== 'all' && groupOf(p.cat) !== state.mapCat) setMapCat('all');
      map.invalidateSize();
      map.flyTo(ll(p), Math.max(map.getZoom(), 16.5), { duration: 0.7 });
      if (selPin) selPin.classList.remove('sel');
      selPin = $('[data-pin="' + id + '"]');
      if (selPin) selPin.classList.add('sel');
    }, 60);
  }
  function showRoute(k) {
    go('map');
    setTimeout(function () { if (initMap()) { map.invalidateSize(); toggleRoute(k, true); } }, 60);
  }
  function updateMeMarker() {
    if (!map || !me) return;
    if (!meMarker) {
      meMarker = L.marker(me, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 2000, keyboard: false, title: 'Вы здесь' }).addTo(map);
      meCircle = L.circle(me, { radius: me.acc || 30, weight: 1, color: '#2f7de1', fillColor: '#2f7de1', fillOpacity: 0.08, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(me); meCircle.setLatLng(me).setRadius(me.acc || 30); }
  }
  function locateOnMap() {
    locate(function (p) {
      if (!map) return;
      map.flyToBounds(L.latLngBounds([p, HOTEL_LL]).pad(0.25), { maxZoom: 17, duration: 0.7 });
      toast('До отеля ' + distText(dist(p, HOTEL_LL)));
    });
  }

  /* офлайн-тайлы: z13–16 на центр и Авлабари, около 2 МБ */
  var BBOX = { s: 41.686, n: 41.724, w: 44.786, e: 44.828 };
  function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function lat2y(lat, z) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
  function tileList(mode) {
    var out = [];
    TILE[mode].forEach(function (t) {
      var tpl = tileUrl(t[0]);
      for (var z = 13; z <= 16; z++) {
        for (var x = lon2x(BBOX.w, z); x <= lon2x(BBOX.e, z); x++) {
          for (var y = lat2y(BBOX.n, z); y <= lat2y(BBOX.s, z); y++) out.push(tpl.replace('{z}', z).replace('{y}', y).replace('{x}', x));
        }
      }
    });
    return out;
  }
  var caching = false;
  function cacheTiles() {
    if (caching) return;
    if (!('caches' in window)) { toast('Этот браузер не умеет сохранять карту'); return; }
    var mode = document.documentElement.dataset.mode, urls = tileList(mode), done = 0, bytes = 0, fail = 0;
    caching = true;
    var tick = function () {
      $$('[data-offline-status]').forEach(function (el) { el.textContent = 'Сохраняю ' + done + ' из ' + urls.length + '…'; });
      $$('[data-offline]').forEach(function (b) { b.classList.add('on'); });
    };
    tick();
    caches.open('tb-tiles').then(function (c) {
      var i = 0;
      var worker = function () {
        if (i >= urls.length) return Promise.resolve();
        var u = urls[i++];
        return c.match(u).then(function (hit) {
          if (hit) return hit.blob().then(function (b) { bytes += b.size; });
          return fetch(u, { mode: 'cors' }).then(function (r) {
            if (!r.ok) throw new Error(r.status);
            return r.clone().blob().then(function (b) { bytes += b.size; return c.put(u, r); });
          });
        }).catch(function () { fail++; }).then(function () { done++; if (done % 5 === 0) tick(); return worker(); });
      };
      return Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    }).then(function () {
      caching = false;
      var info = { n: urls.length - fail, mb: bytes / 1048576, at: Date.now() };
      store.set('offline-' + mode, info);
      toast(fail ? 'Сохранено ' + info.n + ' из ' + urls.length + ' фрагментов - часть не скачалась' : 'Карта сохранена: ' + dec(info.mb.toFixed(1)) + ' МБ, работает без интернета');
      refreshOffline();
    });
  }
  function offlineHTML() {
    var mode = document.documentElement.dataset.mode, info = store.get('offline-' + mode, null);
    var sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    return '<div class="card-head"><div><div class="eyebrow">Без интернета</div><h3>Офлайн-режим</h3></div>' + ico('offline', 'sr') + '</div>' +
      '<ul class="plist"><li><div class="prow"><span class="cat-dot pi" style="--c:var(--tile)">' + ico(sw ? 'check' : 'clock') + '</span><span class="pn"><b>' + (sw ? 'Гид сохранён' : 'Гид сохранится после перезагрузки') + '</b><small>Программа, места, адреса и прогноз Яндекса работают без сети</small></span></div></li>' +
      '<li><button type="button" class="prow" data-offline><span class="cat-dot pi" style="--c:var(--gold)">' + ico(info ? 'check' : 'download') + '</span><span class="pn"><b>' + (info ? 'Карта сохранена' : 'Сохранить карту') + '</b><small data-offline-status>' +
      (info ? info.n + ' фрагментов, ' + dec(info.mb.toFixed(1)) + ' МБ, ' + (mode === 'dark' ? 'тёмная' : 'светлая') + ' тема. Нажмите, чтобы обновить' : 'Центр, Старый город и Авлабари, около 2 МБ, текущая тема') + '</small></span></button></li></ul>';
  }
  function refreshOffline() { var c = $('#offline-card'); if (c) c.innerHTML = offlineHTML(); $$('[data-offline]').forEach(function (b) { b.classList.remove('on'); }); }

  /* ---------- навигация ---------- */
  var TABS = ['now', 'days', 'map', 'food', 'info'];
  var rendered = {};
  function go(tab) {
    if (TABS.indexOf(tab) < 0) tab = 'now';
    if (location.hash !== '#' + tab) { location.hash = tab; return; }
    show(tab);
  }
  function show(tab) {
    if (TABS.indexOf(tab) < 0) tab = 'now';
    state.tab = tab;
    TABS.forEach(function (t) {
      var v = $('#view-' + t), on = t === tab;
      if (!on) v.classList.remove('calm');
      v.classList.toggle('on', on);
    });
    $$('.tabbar button').forEach(function (b) { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (tab === 'map') {
      if (initMap()) setTimeout(function () { map.invalidateSize(); }, 30);
    } else {
      render(tab);
      window.scrollTo(0, 0);
    }
  }
  function render(tab) {
    if (tab === 'now') renderNow();
    else if (tab === 'days') renderDays();
    else if (tab === 'food') renderFood();
    else if (tab === 'info') renderInfo();
    rendered[tab] = true;
  }
  /* тихая перерисовка без повторной анимации */
  function renderSoft() {
    if (state.tab === 'map') return;
    var v = $('#view-' + state.tab);
    v.classList.add('calm');
    var y = window.scrollY;
    render(state.tab);
    window.scrollTo(0, y);
  }
  window.addEventListener('hashchange', function () { hideLayers(); show(location.hash.slice(1)); });
  window.addEventListener('popstate', function () { if (sheetOpen || taxiOpen) hideLayers(); });

  /* ---------- клики ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-place],[data-map],[data-route],[data-route-toggle],[data-taxi],[data-tab],[data-day],[data-goday],[data-train],[data-seg],[data-filter],[data-cat],[data-copy],[data-close],[data-locate],[data-fit],[data-offline],#theme,#scrim');
    if (!el) return;
    var d = el.dataset;
    if (el.id === 'scrim' || d.close != null) { closeLayer(); return; }
    if (el.id === 'theme') { toggleTheme(); return; }
    if (d.place) { if (taxiOpen) hideLayers(); openPlace(d.place); return; }
    if (d.map) { closeLayer(); setTimeout(function () { showOnMap(d.map); }, 80); return; }
    if (d.route) { closeLayer(); setTimeout(function () { showRoute(d.route); }, 80); return; }
    if (d.routeToggle) { toggleRoute(d.routeToggle); return; }
    if (d.taxi) { openTaxi(d.taxi); return; }
    if (d.copy) { copyAddr(d.copy); return; }
    if (d.day) { state.day = d.day; renderDays(); return; }
    if (d.goday) { state.day = d.goday; go('days'); return; }
    if (d.train) { state.train = d.train; store.set('train', d.train); var v = $('#view-days'); v.classList.add('calm'); renderDays(); toast('Понедельник пересчитан под поезд ' + d.train); return; }
    if (d.seg) { state.seg = d.seg; store.set('seg', d.seg); renderFood(); return; }
    if (d.filter === 'open') { state.openOnly = !state.openOnly; $('#view-food').classList.add('calm'); renderFood(); return; }
    if (d.filter === 'near') {
      state.nearMe = !state.nearMe;
      if (state.nearMe && !me) locate(function () { renderFood(); });
      $('#view-food').classList.add('calm'); renderFood(); return;
    }
    if (d.cat) { setMapCat(d.cat); return; }
    if (d.locate != null) { locateOnMap(); return; }
    if (d.fit != null) { map.flyToBounds(L.latLngBounds(T.places.map(ll)).pad(0.05), { duration: 0.6 }); return; }
    if (d.offline != null) { cacheTiles(); return; }
    if (d.tab) {
      if (el.hasAttribute('data-open-now')) { state.openOnly = true; state.seg = dkey(tbNow()) === '2026-10-05' ? 'tbc' : 'hotel'; }
      if (d.segGo) state.seg = d.segGo;
      var anchor = d.anchor;
      go(d.tab);
      if (el.hasAttribute('data-locate-go')) setTimeout(locateOnMap, 300);
      if (anchor) setTimeout(function () { var a = document.getElementById(anchor); if (a) a.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
    }
  });
  document.addEventListener('change', function (e) {
    var id = e.target.dataset && e.target.dataset.check;
    if (!id) return;
    checks[id] = e.target.checked;
    store.set('checks', checks);
    $$('[data-check="' + id + '"]').forEach(function (c) { c.checked = e.target.checked; });
    var key = id.split(':')[0], cl = T.checklists[key];
    var n = cl.items.filter(function (_, i) { return checks[key + ':' + i]; }).length;
    $$('[data-prog="' + key + '"]').forEach(function (p) { p.textContent = n + ' из ' + cl.items.length; });
    if (n === cl.items.length && e.target.checked) toast('Список готов');
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (sheetOpen || taxiOpen)) closeLayer(); });

  /* ---------- тема ---------- */
  function applyTheme(mode) {
    document.documentElement.dataset.mode = mode;
    $('#theme use').setAttribute('href', mode === 'dark' ? '#i-theme-light' : '#i-theme-dark');
    $('#theme').setAttribute('aria-label', mode === 'dark' ? 'Светлая тема' : 'Тёмная тема');
    $('#theme-color').setAttribute('content', mode === 'dark' ? '#160d11' : '#f3eadb');
  }
  function toggleTheme() {
    var mode = document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark';
    store.set('theme', mode);
    applyTheme(mode);
    setTiles();
    if (state.tab === 'info') refreshOffline();
  }

  /* ---------- часы и тик ---------- */
  function updateClock() {
    var tb = tbNow();
    $('#clk').textContent = pad(tb.getUTCHours()) + ':' + pad(tb.getUTCMinutes());
    $('#clkd').textContent = WDS[tb.getUTCDay()] + ', ' + tb.getUTCDate() + ' окт';
  }
  var lastMin = -1;
  function tick() {
    updateClock();
    var m = Math.floor((override ? override.base + (Date.now() - override.at) : Date.now()) / 60000);
    if (m === lastMin) return;
    var first = lastMin < 0;
    lastMin = m;
    if (!first && !sheetOpen && !taxiOpen) renderSoft();
  }

  /* ---------- старт ---------- */
  function init() {
    applyTheme(document.documentElement.dataset.mode);
    buildStars();
    if (override) {
      var b = $('#timebanner'), tb = tbNow();
      b.hidden = false;
      document.body.classList.add('has-banner');
      b.innerHTML = ico('clock', 'sr') + 'Время подменено: ' + WDS[tb.getUTCDay()] + ', ' + tb.getUTCDate() + ' окт, ' + pad(tb.getUTCHours()) + ':' + pad(tb.getUTCMinutes()) + ' · <a href="' + location.pathname + location.hash + '">сбросить</a>';
    }
    show((location.hash || '#now').slice(1));
    tick();
    setInterval(tick, 15000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); if (wx && Date.now() - wx.at > 30 * 60e3) loadWx(); } });
    loadWx();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').then(function () {
        navigator.serviceWorker.addEventListener('controllerchange', function () { if (state.tab === 'info') refreshOffline(); });
      }).catch(function () { /* без офлайна */ });
    }
  }
  init();
})();
