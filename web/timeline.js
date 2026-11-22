"use strict";

window.a16tTimeline = (() => {
  const view = document.getElementById("timeline-view");
  const hour = 60 * 60 * 1000;
  const minutes = new Intl.DateTimeFormat("en-GB", {timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23"});
  const seconds = new Intl.DateTimeFormat("en-GB", {timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"});
  const date = new Intl.DateTimeFormat("en-GB", {timeZone: "UTC", day: "2-digit", month: "short", year: "numeric"});
  const rows = new Map();
  const kinds = new Map([
    ["distress", "Distress"], ["urgency", "PAN-PAN"], ["safety", "Safety"],
    ["port", "Port operations"], ["commercial", "Commercial"], ["other", "Other"], ["unknown", "Unclassified"]
  ]);
  let visible = false;
  let state = null;
  let profileKey = null;
  let history = null;
  let syncedAt = 0;
  let request = null;
  let timer = null;
  let selection = null;
  let failed = false;
  let recordingCount = 0;
  let newestRecording = null;
  let tipMark = null;
  let tipTimeout;
  let plottedRange;

  view.innerHTML = `
    <div class="tl-heading"><div class="tl-heading-line"><h2>Last 60 minutes</h2><p class="tl-summary"></p></div>
      <div class="tl-legend" aria-label="Transmission types"></div></div>
    <div class="tl-scroll" tabindex="0" role="region" aria-label="Channel activity over the last hour">
      <div class="tl-axis"><span class="tl-axis-label" aria-label="Channel">Ch.</span>
        <div class="tl-scale" aria-label="Time in UTC"><span></span><span></span><span></span><span></span><span>Now</span></div></div>
      <div class="tl-rows" role="list" aria-label="Channels in selected profile"></div>
    </div>
    <p class="tl-feedback" role="status"></p>
    <div id="tl-tip" role="tooltip" hidden>
      <strong class="tl-tip-kind"></strong><span class="tl-tip-source"></span>
      <p class="tl-tip-meta"></p><p class="tl-tip-time"></p><p class="tl-tip-preview"></p>
    </div>
    <dialog class="tl-dialog" aria-labelledby="tl-detail-channel">
      <div class="tl-dialog-head"><div><p class="eyebrow">Transmission</p><h3 id="tl-detail-channel"></h3></div>
        <button type="button" class="tl-close" autofocus>Close</button></div>
      <label class="tl-picker-label" for="tl-picker">Recording on this channel</label>
      <select id="tl-picker"></select><p class="tl-dialog-kind"></p><p class="tl-details"></p><p class="tl-dialog-preview"></p>
      <audio controls preload="none" aria-label="Timeline recording"></audio><p class="tl-audio-note" role="status"></p>
    </dialog>`;
  const get = selector => view.querySelector(selector);
  const list = get(".tl-rows");
  const ticks = [...view.querySelectorAll(".tl-scale span")];
  const dialog = get("dialog");
  const picker = get("select");
  const player = get("audio");
  const tip = get("#tl-tip");
  const tipKind = get(".tl-tip-kind");
  const tipSource = get(".tl-tip-source");
  const tipMeta = get(".tl-tip-meta");
  const tipTime = get(".tl-tip-time");
  const tipPreview = get(".tl-tip-preview");
  for (const [kind, label] of kinds) {
    const key = document.createElement("span");
    key.dataset.kind = kind;
    key.textContent = label;
    get(".tl-legend").append(key);
  }
  const liveKey = document.createElement("span");
  liveKey.className = "tl-live-key";
  liveKey.textContent = "Receiving";
  get(".tl-legend").append(liveKey);

  function write(node, content) {
    if (node.textContent !== content) node.textContent = content;
  }

  function bounds() {
    const end = history ? history.end_ms + (performance.now() - syncedAt) : Date.now();
    const width = history ? history.end_ms - history.start_ms : hour;
    return {start: end - width, end, width};
  }

  function position(mark, from, to, range) {
    const start = Math.max(from, range.start);
    const end = Math.min(to, range.end);
    mark.hidden = !(end > start);
    if (mark.hidden) return;
    // Center short marks on their real interval while keeping them inside the window.
    const width = `max(var(--drop-min), ${(end - start) * 100 / range.width}%)`;
    const center = (start + (end - start) / 2 - range.start) * 100 / range.width;
    mark.style.width = width;
    mark.style.left = `clamp(0px, calc(${center}% - ${width} / 2), calc(100% - ${width}))`;
  }

  function precise(ms) {
    return seconds.format(ms) + "." + String(Math.floor(ms) % 1000).padStart(3, "0");
  }

  function timeLabel(clip) {
    return precise(clip.start_ms) + " – " + precise(clip.end_ms) + " UTC";
  }

  function kindOf(value) { return kinds.has(value) ? value : "unknown"; }

  function evidence(clip) {
    if (clip.kind_source === "channel") return "Channel use";
    if (clip.kind_source === "transcript") return "Transcript match";
    return "";
  }

  function channelName(channel) { return channel.label || channel.id; }
  function frequency(channel) { return (channel.frequency_hz / 1e6).toFixed(3); }

  function transmission(mark) {
    const row = rows.get(mark.closest(".tl-row")?.dataset.channel);
    if (!row || mark.hidden) return null;
    if (mark === row.live) {
      const ch = row.channel;
      const kind = kindOf(ch.default_kind);
      return {row, clip: {kind, kind_source: kind === "unknown" ? "unknown" : "channel",
        start_ms: ch.active_since_ms, end_ms: ch.active_until_ms}, live: true};
    }
    const clip = row.clips.get(Number(mark.dataset.clipId));
    return clip ? {row, clip, live: false} : null;
  }

  function hideTip() {
    clearTimeout(tipTimeout);
    tipMark?.removeAttribute("aria-describedby");
    tipMark = null;
    tip.hidden = true;
  }

  function leaveTip() {
    clearTimeout(tipTimeout);
    tipTimeout = setTimeout(hideTip, 130);
  }

  function showTip(mark) {
    clearTimeout(tipTimeout);
    const item = transmission(mark);
    if (!item || dialog.open) { hideTip(); return; }
    const {row, clip, live} = item;
    if (tipMark !== mark) tipMark?.removeAttribute("aria-describedby");
    tipMark = mark;
    mark.setAttribute("aria-describedby", "tl-tip");
    tip.dataset.kind = kindOf(clip.kind);
    write(tipKind, kinds.get(tip.dataset.kind));
    write(tipSource, evidence(clip));
    write(tipMeta, channelName(row.channel) + " · " + frequency(row.channel) + " MHz");
    const span = ((clip.end_ms - clip.start_ms) / 1000).toFixed(1) + " s";
    write(tipTime, seconds.format(clip.start_ms) + " UTC · " + span + (live ? " · Receiving" : ""));
    write(tipPreview, clip.preview ? "Transcript · " + clip.preview : "");
    tip.hidden = false;
    const anchor = mark.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, anchor.left + anchor.width / 2 - box.width / 2));
    const top = anchor.top >= box.height + 12 ? anchor.top - box.height - 4 : anchor.bottom + 4;
    tip.style.left = left + "px";
    tip.style.top = Math.min(window.innerHeight - box.height - 4, Math.max(4, top)) + "px";
  }

  function pointerMark(event) {
    const hit = event.target.closest(".tl-mark,.tl-live");
    if (!hit) return null;
    // Adjacent short calls may share pixels. Pick the actual interval closest
    // to the cursor among the overlapping buttons, independent of paint order.
    const marks = document.elementsFromPoint(event.clientX, event.clientY)
      .filter(node => node.matches(".tl-mark,.tl-live"));
    if (marks.length < 2 || !plottedRange) return hit;
    const lane = hit.parentNode.getBoundingClientRect();
    const time = plottedRange.start + (event.clientX - lane.left) * plottedRange.width / lane.width;
    let nearest = hit;
    let distance = Infinity;
    for (const mark of marks) {
      const item = transmission(mark);
      if (item) {
        const gap = Math.max(item.clip.start_ms - time, time - item.clip.end_ms, 0);
        if (gap < distance) { nearest = mark; distance = gap; }
      }
    }
    return nearest;
  }

  list.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    const mark = pointerMark(event);
    if (mark) clearTimeout(tipTimeout);
    if (mark === tipMark) return;
    if (mark) showTip(mark);
    else if (tipMark) leaveTip();
  });
  list.addEventListener("pointerleave", leaveTip);
  tip.addEventListener("pointerenter", () => clearTimeout(tipTimeout));
  tip.addEventListener("pointerleave", hideTip);
  list.addEventListener("focusin", event => {
    if (event.target.matches(".tl-mark,.tl-live")) showTip(event.target);
  });
  list.addEventListener("focusout", hideTip);
  list.addEventListener("click", event => {
    const mark = event.detail ? pointerMark(event) : event.target.closest(".tl-mark,.tl-live");
    if (!mark) return;
    const item = transmission(mark);
    if (!item) return;
    if (item.live) showTip(mark);
    else inspect(item.row, item.clip.id);
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") hideTip(); });
  document.addEventListener("pointerdown", event => {
    if (tipMark && !event.target.closest("#tl-tip,.tl-mark,.tl-live")) hideTip();
  });
  document.addEventListener("scroll", hideTip, true);
  window.addEventListener("resize", hideTip);

  const scroll = get(".tl-scroll");
  function fitLanes() {
    if (!visible) return;
    const top = scroll.getBoundingClientRect().top + window.scrollY;
    view.style.setProperty("--available-height", Math.max(160, window.innerHeight - top - 8) + "px");
  }
  window.addEventListener("resize", fitLanes);
  if ("ResizeObserver" in window) {
    const sizes = new ResizeObserver(fitLanes);
    for (const el of document.querySelectorAll(".masthead,.overview,.archive-warning,.tl-heading")) sizes.observe(el);
  }

  function clearPlayer() {
    if (player.hasAttribute("src")) {
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
  }

  function showClip(row, clip) {
    selection = {channel: row.channel.id, id: clip.id};
    picker.value = String(clip.id);
    write(get("#tl-detail-channel"), channelName(row.channel));
    const kind = kindOf(clip.kind);
    const classification = get(".tl-dialog-kind");
    classification.dataset.kind = kind;
    write(classification, [kinds.get(kind), evidence(clip)].filter(Boolean).join(" · "));
    write(get(".tl-dialog-preview"), clip.preview ? "Transcript · " + clip.preview : "");
    const duration = (clip.end_ms - clip.start_ms) / 1000;
    write(get(".tl-details"), `${date.format(clip.start_ms)} · ${timeLabel(clip)} · ${duration.toFixed(2)} s · ${frequency(row.channel)} MHz`);
    const available = ["queued", "ready", "failed"].includes(clip.status);
    player.hidden = !available;
    const path = "/api/clips/" + encodeURIComponent(clip.id) + "/audio";
    if (!available || player.getAttribute("src") !== path) {
      clearPlayer();
      if (available) player.src = path;
      const expired = ["expiring", "expired"].includes(clip.status);
      write(get(".tl-audio-note"), available ? "" : expired ? "Recording audio has expired." : "Recording audio unavailable.");
    }
  }

  function inspect(row, id) {
    const clip = row.clips.get(id);
    if (!clip) return;
    hideTip();
    picker.replaceChildren();
    for (const item of row.clips.values()) {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = timeLabel(item) + " · " + kinds.get(kindOf(item.kind));
      picker.append(option);
    }
    picker.hidden = get(".tl-picker-label").hidden = row.clips.size < 2;
    showClip(row, clip);
    if (!dialog.open) dialog.showModal();
  }

  get(".tl-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { selection = null; clearPlayer(); });
  picker.addEventListener("change", () => {
    const row = rows.get(selection?.channel);
    const clip = row?.clips.get(Number(picker.value));
    if (clip) showClip(row, clip);
  });
  player.addEventListener("error", () => {
    if (player.hasAttribute("src")) write(get(".tl-audio-note"), "Recording audio unavailable.");
  });

  function createRow(channel) {
    const node = document.createElement("div");
    node.className = "tl-row";
    node.setAttribute("role", "listitem");
    node.dataset.channel = channel.id;
    node.innerHTML = `<div class="tl-channel"><button type="button" class="tl-name" disabled></button></div>
      <div class="tl-lane"><button type="button" class="tl-live" hidden></button></div>`;
    const row = {node, channel, clips: new Map(), marks: new Map(), name: node.querySelector("button"),
      lane: node.querySelector(".tl-lane"), live: node.querySelector(".tl-live")};
    row.name.addEventListener("click", () => {
      const latest = [...row.clips.keys()].pop();
      if (latest != null) inspect(row, latest);
    });
    return row;
  }

  function syncRows(channels) {
    view.style.setProperty("--lane-count", Math.max(1, channels.length));
    const ids = new Set(channels.map(ch => ch.id));
    for (const [id, row] of rows) {
      if (!ids.has(id)) { row.node.remove(); rows.delete(id); }
    }
    let next = list.firstElementChild;
    for (const channel of channels) {
      let row = rows.get(channel.id);
      if (!row) { row = createRow(channel); rows.set(channel.id, row); }
      row.channel = channel;
      const label = channelName(channel);
      const number = /^(?:channel|ch\.?)\s+(\d.*)$/i.exec(label);
      write(row.name, number ? number[1].replace(/\s*\/\s*/g, "/") : frequency(channel));
      const identity = label + " · " + frequency(channel) + " MHz";
      row.name.setAttribute("aria-label", identity);
      row.name.parentNode.title = identity;
      if (row.node !== next) list.insertBefore(row.node, next);
      next = row.node.nextElementSibling;
    }
  }

  function renderLive(range) {
    let receiving = 0;
    for (const row of rows.values()) {
      const ch = row.channel;
      if (Number.isFinite(ch.active_since_ms) && Number.isFinite(ch.active_until_ms) && range.end - ch.last_sample_ms < 5000) {
        position(row.live, ch.active_since_ms, ch.active_until_ms, range);
      } else {
        row.live.hidden = true;
      }
      if (!row.live.hidden) {
        receiving++;
        row.live.dataset.kind = kindOf(ch.default_kind);
        row.live.setAttribute("aria-label", channelName(ch) + " · " + kinds.get(row.live.dataset.kind) +
          " · Receiving since " + seconds.format(ch.active_since_ms) + " UTC");
      }
      if (tipMark === row.live) showTip(row.live);
    }
    return receiving;
  }

  function renderHistory() {
    const range = bounds();
    plottedRange = range;
    for (let i = 0; i < ticks.length - 1; i++) {
      const stamp = range.start + range.width * i / (ticks.length - 1);
      write(ticks[i], minutes.format(stamp));
    }
    const byChannel = new Map();
    for (const clip of history?.transmissions || []) {
      const row = rows.get(clip.channel);
      if (!row || row.channel.frequency_hz !== clip.frequency_hz || clip.start_ms >= range.end || clip.end_ms <= range.start) continue;
      if (!byChannel.has(clip.channel)) byChannel.set(clip.channel, new Map());
      byChannel.get(clip.channel).set(clip.id, clip);
    }
    recordingCount = 0;
    for (const row of rows.values()) {
      row.clips = byChannel.get(row.channel.id) || new Map();
      recordingCount += row.clips.size;
      for (const [id, mark] of row.marks) {
        if (!row.clips.has(id)) {
          if (tipMark === mark) hideTip();
          mark.remove(); row.marks.delete(id);
        }
      }
      for (const clip of row.clips.values()) {
        let mark = row.marks.get(clip.id);
        if (!mark) {
          mark = document.createElement("button");
          mark.type = "button";
          mark.className = "tl-mark";
          mark.dataset.clipId = clip.id;
          row.lane.append(mark);
          row.marks.set(clip.id, mark);
        }
        mark.dataset.kind = kindOf(clip.kind);
        mark.setAttribute("aria-label", channelName(row.channel) + " · " + kinds.get(mark.dataset.kind) + " · " + timeLabel(clip));
        position(mark, clip.start_ms, clip.end_ms, range);
        if (tipMark === mark) showTip(mark);
      }
      row.name.disabled = !row.clips.size;
    }
    const counts = [`${rows.size} channel${rows.size === 1 ? "" : "s"}`];
    if (history) counts.push(`${recordingCount} recording${recordingCount === 1 ? "" : "s"}`);
    counts.push("UTC");
    write(get(".tl-summary"), counts.join(" · "));
    if (selection) {
      const row = rows.get(selection.channel);
      const current = row?.clips.get(selection.id);
      if (current) showClip(row, current);
    }
    renderFeedback(renderLive(range));
  }

  function renderFeedback(receiving) {
    let message = "";
    if (failed) message = history ? "Recording history update failed. Retrying…" : "Recording history unavailable. Retrying…";
    else if (!state) message = "Waiting for the channel profile…";
    else if (!history) message = "Loading recording history…";
    else if (!rows.size) message = "No channels configured.";
    else if (!recordingCount && !receiving) message = "No recorded transmissions in the last hour.";
    write(get(".tl-feedback"), message);
  }

  async function refresh() {
    if (!visible || request || !state) return;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch("/api/timeline", {signal: controller.signal, cache: "no-store"});
      if (!response.ok) throw Error("Timeline unavailable");
      const payload = await response.json();
      if (request !== controller) return;
      if (payload.profile !== state.profile || payload.source !== state.source ||
          !Array.isArray(payload.transmissions) || !(payload.end_ms > payload.start_ms)) throw Error("Invalid timeline");
      history = payload;
      syncedAt = performance.now();
      failed = false;
    } catch {
      if (request === controller) failed = true;
    } finally {
      clearTimeout(timeout);
      if (request === controller) { request = null; renderHistory(); }
    }
  }

  function update(next) {
    state = next;
    if (!visible || !state) return;
    const key = JSON.stringify([state.profile, state.source, state.channels.map(ch => [ch.id, ch.frequency_hz])]);
    const latest = state.clips?.[0];
    const newest = latest ? latest.id + "/" + latest.status : null;
    if (profileKey !== key) {
      profileKey = key;
      request?.abort(); request = null;
      history = null;
      failed = false;
      hideTip();
      if (dialog.open) dialog.close();
      syncRows(state.channels);
      renderHistory();
      refresh();
    } else {
      for (const ch of state.channels) rows.get(ch.id).channel = ch;
      renderFeedback(renderLive(bounds()));
      if (newest !== newestRecording && !document.hidden) refresh();
    }
    newestRecording = newest;
  }

  function show(next) {
    if (visible) { update(next); return; }
    visible = true;
    update(next);
    fitLanes();
    renderHistory();
    refresh();
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  function hide() {
    visible = false;
    hideTip();
    request?.abort(); request = null;
    clearInterval(timer);
    if (dialog.open) dialog.close();
    clearPlayer();
  }

  return {show, update, hide};
})();
