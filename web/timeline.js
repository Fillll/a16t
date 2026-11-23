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
  let inspectorRequest = null;
  let failed = false;
  let recordingCount = 0;
  let newestRecording = null;
  let tipMark = null;
  let tipTimeout;
  let plottedRange;

  view.innerHTML = `
    <div class="tl-heading"><div class="tl-heading-line"><h2>Last 60 minutes</h2><p class="tl-summary"></p></div>
      <div class="tl-legend" aria-label="Transmission types"></div></div>
    <div class="tl-workspace">
      <div class="tl-plot">
        <div class="tl-scroll" tabindex="0" role="region" aria-label="Channel activity over the last hour">
          <div class="tl-axis"><span class="tl-axis-label" aria-label="Channel">Ch.</span>
            <div class="tl-scale" aria-label="Time in UTC"><span></span><span></span><span></span><span></span><span>Now</span></div></div>
          <div class="tl-rows" role="list" aria-label="Channels in selected profile"></div>
        </div>
        <p class="tl-feedback" role="status"></p>
      </div>
      <aside class="tl-inspector" aria-labelledby="tl-detail-channel" tabindex="-1">
        <header class="tl-inspector-head"><h2 id="tl-detail-channel">Transmission</h2>
          <p class="tl-inspector-frequency" hidden></p></header>
        <p class="tl-inspector-empty" role="status">Select a drop or channel to see its transmissions.</p>
        <div class="tl-inspector-body" hidden>
          <nav class="tl-nav" aria-label="Channel history">
            <button type="button" class="tl-prev" aria-disabled="true">← Previous</button>
            <button type="button" class="tl-next" aria-disabled="true">Next →</button>
          </nav>
          <p class="tl-inspector-position" role="status"></p>
          <div class="tl-inspector-recording" hidden>
            <p class="tl-inspector-kind"></p><p class="tl-inspector-meta" aria-live="polite"></p>
            <audio controls preload="metadata" aria-label="Selected transmission" hidden></audio>
            <p class="tl-audio-note" role="status"></p>
            <section class="tl-transcript"><h3>Transcript</h3><p></p></section>
          </div>
        </div>
      </aside>
    </div>
    <div id="tl-tip" role="tooltip" hidden>
      <strong class="tl-tip-kind"></strong><span class="tl-tip-source"></span>
      <p class="tl-tip-meta"></p><p class="tl-tip-time"></p><p class="tl-tip-preview"></p>
    </div>`;
  const get = selector => view.querySelector(selector);
  const list = get(".tl-rows");
  const ticks = [...view.querySelectorAll(".tl-scale span")];
  const inspector = get(".tl-inspector");
  const previous = get(".tl-prev");
  const nextClip = get(".tl-next");
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
    if (!item) { hideTip(); return; }
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
    if (item.live) inspect(item.row, null, item.clip.start_ms);
    else inspect(item.row, item.clip.id);
    revealInspector(event);
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

  function showClip(row, clip, live) {
    const kind = kindOf(live ? row.channel.default_kind : clip.kind);
    const classification = get(".tl-inspector-kind");
    classification.dataset.kind = kind;
    write(classification, live ? "Receiving" : [kinds.get(kind), evidence(clip)].filter(Boolean).join(" · "));
    const duration = (clip.end_ms - clip.start_ms) / 1000;
    const meta = get(".tl-inspector-meta");
    meta.setAttribute("aria-live", live ? "off" : "polite");
    write(meta, `${date.format(clip.start_ms)}\n${timeLabel(clip)}\n${duration.toFixed(2)} s`);
    const available = !live && ["queued", "ready", "failed"].includes(clip.status);
    player.hidden = !available;
    const path = "/api/clips/" + encodeURIComponent(clip.id) + "/audio";
    if (!available || player.getAttribute("src") !== path) {
      clearPlayer();
      if (available) player.src = path;
      const expired = ["expiring", "expired"].includes(clip.status);
      write(get(".tl-audio-note"), available || live ? "" : expired ? "Recording audio has expired." : "Recording audio unavailable.");
    }
    get(".tl-transcript").hidden = live;
    const pending = ["pending", "sending"].includes(clip.transcription_status);
    write(get(".tl-transcript p"), clip.transcript || (pending ? "Awaiting transcription…" : "No transcript available."));
  }

  function selectMarks(old) {
    if (old) {
      const row = rows.get(old.channel);
      row?.node.removeAttribute("data-selected");
      row?.name.setAttribute("aria-pressed", "false");
      row?.marks.get(old.id)?.setAttribute("aria-pressed", "false");
      row?.live.setAttribute("aria-pressed", "false");
    }
    const row = rows.get(selection?.channel);
    if (!row) return;
    row.node.dataset.selected = "true";
    row.name.setAttribute("aria-pressed", "true");
    row.marks.get(selection.id)?.setAttribute("aria-pressed", "true");
    row.live.setAttribute("aria-pressed", String(selection.liveSince === row.channel.active_since_ms && selection.liveSince !== null));
  }

  function renderInspector() {
    const row = rows.get(selection?.channel);
    const body = get(".tl-inspector-body");
    const empty = get(".tl-inspector-empty");
    const station = get(".tl-inspector-frequency");
    body.hidden = !row;
    empty.hidden = Boolean(row);
    station.hidden = !row;
    write(get("#tl-detail-channel"), row ? channelName(row.channel) : "Transmission");
    if (!row) { clearPlayer(); return; }
    write(station, frequency(row.channel) + " MHz");
    const {data, liveSince, error, id} = selection;
    const live = liveSince !== null;
    const channel = row.channel;
    const receiving = live && channel.active_since_ms === liveSince && Date.now() - channel.last_sample_ms < 5000;
    const clip = live
      ? (receiving ? {start_ms: liveSince, end_ms: channel.active_until_ms} : null)
      : (data?.clip || row.clips.get(id));
    previous.setAttribute("aria-disabled", String(previousId() == null));
    nextClip.setAttribute("aria-disabled", String(live || data?.next_id == null));
    let message = "";
    if (error) message = "Couldn’t update channel history. Retrying…";
    else if (live && !receiving) message = "Waiting for the recording…";
    else if (!data && !clip) message = "Loading channel history…";
    else if (!clip) message = "No recordings for this channel yet.";
    else if (!live && clip.end_ms <= bounds().start) message = "Outside the last 60 minutes";
    write(get(".tl-inspector-position"), message);
    get(".tl-inspector-recording").hidden = !clip;
    if (clip) showClip(row, clip, live);
    else clearPlayer();
  }

  function previousId() {
    if (!selection?.data) return null;
    if (selection.liveSince === null) return selection.data.previous_id;
    const clip = selection.data.clip;
    return clip && clip.start_ms < selection.liveSince ? clip.id : null;
  }

  function inspect(row, id = null, liveSince = null) {
    hideTip();
    const old = selection;
    inspectorRequest?.abort();
    inspectorRequest = null;
    selection = {channel: row.channel.id, id, liveSince, data: null, error: false};
    inspector.scrollTop = 0;
    selectMarks(old);
    renderInspector();
    refreshInspector();
  }

  function revealInspector(event) {
    if (!event.detail) inspector.focus({preventScroll: true});
    if (window.matchMedia("(max-width: 750px)").matches) inspector.scrollIntoView({block: "nearest"});
  }

  async function refreshInspector() {
    if (!visible || !selection || inspectorRequest) return;
    const selected = selection;
    const controller = new AbortController();
    inspectorRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    const path = "/api/channels/" + encodeURIComponent(selected.channel) + "/history";
    const query = selected.id === null ? "" : "?id=" + encodeURIComponent(selected.id);
    try {
      const response = await fetch(path + query, {signal: controller.signal, cache: "no-store"});
      if (!response.ok) throw Error("Channel history unavailable");
      const data = await response.json();
      if (inspectorRequest !== controller) return;
      const old = {...selected};
      selected.data = data;
      selected.error = false;
      if (selected.liveSince === null) selected.id = data.clip?.id ?? null;
      else if (data.clip?.start_ms === selected.liveSince) {
        selected.id = data.clip.id;
        selected.liveSince = null;
      }
      if (old.id !== selected.id || old.liveSince !== selected.liveSince) selectMarks(old);
    } catch {
      if (inspectorRequest === controller) selected.error = true;
    } finally {
      clearTimeout(timeout);
      if (inspectorRequest === controller) { inspectorRequest = null; renderInspector(); }
    }
  }

  function moveTo(id) {
    const row = rows.get(selection?.channel);
    if (row && id != null) inspect(row, id);
  }

  previous.addEventListener("click", () => moveTo(previousId()));
  nextClip.addEventListener("click", () => {
    if (selection?.liveSince === null) moveTo(selection.data?.next_id);
  });
  player.addEventListener("error", () => {
    if (player.hasAttribute("src")) write(get(".tl-audio-note"), "Recording audio unavailable.");
  });

  function createRow(channel) {
    const node = document.createElement("div");
    node.className = "tl-row";
    node.setAttribute("role", "listitem");
    node.dataset.channel = channel.id;
    node.innerHTML = `<div class="tl-channel"><button type="button" class="tl-name" aria-pressed="false"></button></div>
      <div class="tl-lane"><button type="button" class="tl-live" hidden></button></div>`;
    const row = {node, channel, clips: new Map(), marks: new Map(), name: node.querySelector("button"),
      lane: node.querySelector(".tl-lane"), live: node.querySelector(".tl-live")};
    row.name.addEventListener("click", event => {
      inspect(row);
      revealInspector(event);
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
        row.live.setAttribute("aria-pressed", String(selection?.channel === ch.id &&
          selection.liveSince === ch.active_since_ms));
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
        mark.setAttribute("aria-pressed", String(selection?.channel === row.channel.id && selection.id === clip.id));
        mark.setAttribute("aria-label", channelName(row.channel) + " · " + kinds.get(mark.dataset.kind) + " · " + timeLabel(clip));
        position(mark, clip.start_ms, clip.end_ms, range);
        if (tipMark === mark) showTip(mark);
      }
      row.node.dataset.hasClips = String(row.clips.size > 0);
    }
    const counts = [`${rows.size} channel${rows.size === 1 ? "" : "s"}`];
    if (history) counts.push(`${recordingCount} recording${recordingCount === 1 ? "" : "s"}`);
    counts.push("UTC");
    write(get(".tl-summary"), counts.join(" · "));
    if (selection?.liveSince != null) {
      const row = rows.get(selection.channel);
      const saved = [...(row?.clips.values() || [])].find(clip => clip.start_ms === selection.liveSince);
      if (saved) inspect(row, saved.id);
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

  function refreshVisible() {
    if (document.hidden) return;
    refresh();
    refreshInspector();
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
      inspectorRequest?.abort(); inspectorRequest = null;
      const old = selection;
      selection = null;
      selectMarks(old);
      renderInspector();
      syncRows(state.channels);
      renderHistory();
      refresh();
    } else {
      for (const ch of state.channels) rows.get(ch.id).channel = ch;
      renderFeedback(renderLive(bounds()));
      if (selection?.liveSince != null) renderInspector();
      if (newest !== newestRecording) refreshVisible();
    }
    newestRecording = newest;
  }

  function show(next) {
    if (visible) { update(next); return; }
    visible = true;
    update(next);
    fitLanes();
    renderHistory();
    renderInspector();
    refreshVisible();
    timer = setInterval(refreshVisible, 5000);
  }

  document.addEventListener("visibilitychange", refreshVisible);

  function hide() {
    visible = false;
    hideTip();
    request?.abort(); request = null;
    inspectorRequest?.abort(); inspectorRequest = null;
    clearInterval(timer);
    clearPlayer();
  }

  return {show, update, hide};
})();
