"use strict";

window.a16tTimeline = (() => {
  const view = document.getElementById("timeline-view");
  const hour = 60 * 60 * 1000;
  const clock = {hour: "2-digit", minute: "2-digit", hourCycle: "h23"};
  const minutes = stamp => window.a16tTime.format(stamp, clock);
  const seconds = stamp => window.a16tTime.format(stamp, {...clock, second: "2-digit"});
  const date = stamp => window.a16tTime.format(stamp, {day: "2-digit", month: "short", year: "numeric"});
  const zone = () => window.a16tTime.label;
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
  let syncedEnd = null;
  let pastEnd = null;
  let fetchedEnd = null;
  let drag = null;
  let panFrame = 0;
  let request = null;
  let timer = null;
  let selection = null;
  let inspectorRequest = null;
  let conversation = null;
  let pageRequest = null;
  let lastScroll = 0;
  let failed = false;
  let recordingCount = 0;
  let newestRecording = null;
  let tipMark = null;
  let tipTimeout;
  let plottedRange;

  view.innerHTML = `
    <div class="tl-heading"><div class="tl-heading-line"><h2>Last 60 minutes</h2><p class="tl-summary"></p>
      <button type="button" class="tl-now" hidden>Back to now</button></div>
      <div class="tl-legend" aria-label="Transmission types"></div></div>
    <div class="tl-workspace">
      <div class="tl-plot">
        <div class="tl-scroll" tabindex="0" role="region" aria-label="One hour of channel activity">
          <div class="tl-axis" tabindex="0" role="group" aria-describedby="tl-pan-help"><span class="tl-axis-label" aria-label="Channel">Ch.</span>
            <div class="tl-scale"><span></span><span></span><span></span><span></span><span>Now</span></div></div>
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
          <button type="button" class="tl-selected-time" hidden></button>
          <p class="tl-inspector-position" role="status"></p>
          <div class="tl-live-detail"><div class="tl-inspector-recording" hidden>
            <p class="tl-inspector-kind"></p><p class="tl-inspector-meta" aria-live="polite"></p>
            <audio controls preload="metadata" aria-label="Selected transmission" hidden></audio>
            <p class="tl-audio-note" role="status"></p>
            <section class="tl-transcript"><h3>Transcript</h3><p></p></section>
          </div></div>
          <div class="tl-conversations" role="region" aria-label="Channel transmissions" tabindex="0" hidden>
            <button type="button" class="tl-page tl-newer" hidden>Newer transmissions</button>
            <ol class="tl-conversation-list"></ol>
            <button type="button" class="tl-page tl-older" hidden>Older transmissions</button>
          </div>
        </div>
      </aside>
    </div>
    <span id="tl-pan-help" hidden>Drag the time ruler, or use Left and Right to move 15 minutes. Press Home to return to live.</span>
    <div id="tl-tip" role="tooltip" hidden>
      <strong class="tl-tip-kind"></strong><span class="tl-tip-source"></span>
      <p class="tl-tip-meta"></p><p class="tl-tip-time"></p><p class="tl-tip-preview"></p>
    </div>`;
  const get = selector => view.querySelector(selector);
  const list = get(".tl-rows");
  const ticks = [...view.querySelectorAll(".tl-scale span")];
  const axis = get(".tl-axis");
  const scale = get(".tl-scale");
  const now = get(".tl-now");
  const inspector = get(".tl-inspector");
  const previous = get(".tl-prev");
  const nextClip = get(".tl-next");
  const selectedTime = get(".tl-selected-time");
  const player = get("audio");
  const detail = get(".tl-inspector-recording");
  const liveDetail = get(".tl-live-detail");
  const conversations = get(".tl-conversations");
  const conversationList = get(".tl-conversation-list");
  const older = get(".tl-older");
  const newer = get(".tl-newer");
  const channelRows = new Map();
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

  function liveEnd() {
    return syncedEnd === null ? Date.now() : syncedEnd + performance.now() - syncedAt;
  }

  function bounds() {
    const end = pastEnd ?? liveEnd();
    return {start: end - hour, end, width: hour};
  }

  function panTo(end) {
    const latest = liveEnd();
    const earliest = Number.isFinite(history?.earliest_ms) ? history.earliest_ms + hour : latest;
    const limit = Math.min(latest, earliest);
    const next = end === null || end >= latest ? null : Math.round(Math.max(limit, end));
    pastEnd = next !== null && next < latest - 1 ? next : null;
    renderHistory();
  }

  function stopPan() {
    cancelAnimationFrame(panFrame);
    panFrame = 0;
    axis.removeAttribute("data-dragging");
  }

  function finishPan() {
    stopPan();
    renderHistory();
    renderInspector();
    refresh();
  }

  function startInertia(speed) {
    const started = performance.now();
    let previous = started;
    let end = bounds().end;
    function frame(now) {
      const elapsed = now - started;
      end += speed * Math.exp(-elapsed / 135) * Math.min(32, now - previous);
      previous = now;
      panTo(end);
      if (elapsed >= 490 || pastEnd === null || Math.abs(end - pastEnd) > 2) finishPan();
      else panFrame = requestAnimationFrame(frame);
    }
    panFrame = requestAnimationFrame(frame);
  }

  axis.addEventListener("pointerdown", event => {
    if (!history || !event.isPrimary || event.button !== 0 || !scale.clientWidth) return;
    stopPan();
    axis.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId, x: event.clientX, end: bounds().end, factor: hour / scale.clientWidth,
      lastX: event.clientX, stamp: event.timeStamp, speed: 0, moved: false
    };
  });
  window.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    if (event.buttons === 0 && event.pointerType === "mouse") { releaseRuler(event); return; }
    const delta = event.clientX - drag.x;
    if (!drag.moved && Math.abs(delta) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      axis.dataset.dragging = "true";
      hideTip();
      request?.abort(); request = null;
    }
    const dt = event.timeStamp - drag.stamp;
    if (dt > 0) {
      const instant = (event.clientX - drag.lastX) / dt;
      drag.speed = 0.45 * drag.speed + 0.55 * Math.max(-2, Math.min(2, instant));
      drag.stamp = event.timeStamp;
      drag.lastX = event.clientX;
    }
    panTo(drag.end - delta * drag.factor);
  }, true);
  function releaseRuler(event) {
    if (drag?.id !== event.pointerId) return;
    const released = drag;
    drag = null;
    axis.removeAttribute("data-dragging");
    const coast = event.type === "pointerup" && event.timeStamp - released.stamp < 90 &&
      Math.abs(released.speed) > 0.055 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (released.moved && coast) startInertia(-released.speed * released.factor);
    else finishPan();
  }
  for (const event of ["pointerup", "pointercancel"]) window.addEventListener(event, releaseRuler, true);
  window.addEventListener("blur", () => {
    if (!drag) return;
    drag = null;
    finishPan();
  });

  function changeHour(end) {
    if (!history) return;
    stopPan();
    request?.abort(); request = null;
    panTo(end);
    finishPan();
  }
  now.addEventListener("click", () => {
    changeHour(null);
    axis.focus({preventScroll: true});
  });
  axis.addEventListener("keydown", event => {
    const key = event.key;
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(key)) return;
    event.preventDefault();
    const step = hour / 4;
    changeHour(key === "Home" ? null : bounds().end + (key === "ArrowLeft" ? -step : step));
  });

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
    return seconds(ms) + "." + String(Math.floor(ms) % 1000).padStart(3, "0");
  }

  function timeLabel(clip) {
    return precise(clip.start_ms) + " – " + precise(clip.end_ms) + " " + zone();
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
    write(tipTime, seconds(clip.start_ms) + " " + zone() + " · " + span + (live ? " · Receiving" : ""));
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
    if (mark) {
      const item = transmission(mark);
      if (!item) return;
      if (item.live) inspect(item.row, null, item.clip.start_ms);
      else inspect(item.row, item.clip.id);
    } else {
      const row = rows.get(event.target.closest(".tl-row")?.dataset.channel);
      if (!row) return;
      inspect(row);
    }
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
    write(meta, `${date(clip.start_ms)}\n${timeLabel(clip)}\n${duration.toFixed(2)} s`);
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
    if (!row) { clearPlayer(); renderConversations(); return; }
    write(station, frequency(row.channel) + " MHz");
    const {data, liveSince, error, id} = selection;
    const live = liveSince !== null;
    const channel = row.channel;
    const receiving = live && channel.active_since_ms === liveSince && Date.now() - channel.last_sample_ms < 5000;
    const clip = live
      ? (receiving ? {start_ms: liveSince, end_ms: channel.active_until_ms} : null)
      : (data?.clip || row.clips.get(id));
    const selectedMark = clip ?? conversation?.items.find(item => item.id === id);
    selectedTime.hidden = live || !selectedMark;
    if (selectedMark) write(selectedTime, "Selected · " + seconds(selectedMark.start_ms) + " " + zone());
    previous.setAttribute("aria-disabled", String(previousId() == null));
    nextClip.setAttribute("aria-disabled", String(live || data?.next_id == null));
    let message = "";
    if (error) message = "Couldn’t update channel history. Retrying…";
    else if (live && !receiving) message = "Waiting for the recording…";
    else if (!data && !clip) message = "Loading channel history…";
    else if (!clip) message = "No recordings for this channel yet.";
    else if (!live && (clip.end_ms <= bounds().start || clip.start_ms >= bounds().end)) message = "Outside the displayed hour";
    write(get(".tl-inspector-position"), message);
    detail.hidden = !clip;
    renderConversations();
    if (clip) showClip(row, clip, live);
    else clearPlayer();
  }

  function byTime(a, b) {
    return a.start_ms - b.start_ms || a.id - b.id;
  }

  function renderConversations() {
    const items = conversation?.items ?? [];
    const selectedId = selection?.liveSince === null ? selection.id : null;
    const ids = new Set(items.map(item => item.id));
    const target = channelRows.get(selectedId);
    if ((!ids.has(selectedId) || !target) && detail.parentNode !== liveDetail) liveDetail.append(detail);
    for (const [id, node] of channelRows) {
      if (!ids.has(id)) { node.remove(); channelRows.delete(id); }
    }
    let next = conversationList.firstElementChild;
    for (const item of [...items].reverse()) {
      let node = channelRows.get(item.id);
      if (!node) {
        node = document.createElement("li");
        node.className = "tl-conversation";
        node.innerHTML = '<button type="button" class="tl-conversation-select"><time class="tl-conversation-time"></time><span class="tl-conversation-selection" hidden>Selected</span><span class="tl-conversation-preview"></span></button>';
        node.firstElementChild.addEventListener("click", () => moveTo(item.id));
        channelRows.set(item.id, node);
      }
      const marked = item.id === selectedId;
      node.dataset.selected = String(marked);
      const button = node.firstElementChild;
      if (marked) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
      const time = button.querySelector("time");
      time.dateTime = new Date(item.start_ms).toISOString();
      write(time, date(item.start_ms) + " · " + seconds(item.start_ms) + " " + zone());
      button.querySelector(".tl-conversation-selection").hidden = !marked;
      write(button.querySelector(".tl-conversation-preview"), marked ? "" : (item.preview || ""));
      if (node !== next) conversationList.insertBefore(node, next);
      next = node.nextElementSibling;
      if (marked && detail.parentNode !== node) node.append(detail);
    }
    conversations.hidden = items.length === 0;
    for (const [button, id] of [[older, conversation?.older_id], [newer, conversation?.newer_id]]) {
      button.hidden = id == null;
      button.disabled = Boolean(pageRequest);
    }
  }

  function mergeConversation(window) {
    if (!window?.items.length) return;
    const first = window.items[0];
    const last = window.items.at(-1);
    const current = conversation?.items;
    if (!current || byTime(first, current.at(-1)) > 0 || byTime(last, current[0]) < 0) {
      conversation = window;
      return;
    }
    const clips = new Map(current.map(item => [item.id, item]));
    for (const item of window.items) clips.set(item.id, item);
    conversation = {
      items: [...clips.values()].sort(byTime),
      older_id: byTime(first, current[0]) <= 0 ? window.older_id : conversation.older_id,
      newer_id: byTime(last, current.at(-1)) >= 0 ? window.newer_id : conversation.newer_id
    };
  }

  function revealTransmission() {
    const row = channelRows.get(selection?.id);
    if (!row) return;
    const area = conversations.getBoundingClientRect();
    const card = row.getBoundingClientRect();
    if (card.top < area.top || card.bottom > area.bottom) {
      conversations.scrollTop += card.top - area.top - (area.height - Math.min(area.height, card.height)) / 2;
      lastScroll = conversations.scrollTop;
    }
  }

  async function fetchHistory(channel, id, signal) {
    const path = "/api/channels/" + encodeURIComponent(channel) + "/history";
    const query = new URLSearchParams({window: "true"});
    if (id !== null) query.set("id", id);
    const response = await fetch(path + "?" + query, {signal, cache: "no-store"});
    if (!response.ok) throw Error("Channel history unavailable");
    return response.json();
  }

  async function pageHistory(direction) {
    const id = conversation?.[direction + "_id"];
    if (!selection || id == null || pageRequest) return;
    const channel = selection.channel;
    const controller = new AbortController();
    const button = direction === "older" ? older : newer;
    const timeout = setTimeout(() => controller.abort(), 6000);
    pageRequest = controller;
    button.textContent = "Loading transmissions…";
    renderConversations();
    try {
      const data = await fetchHistory(channel, id, controller.signal);
      if (pageRequest !== controller) return;
      const anchor = direction === "newer" ? conversationList.firstElementChild : null;
      const top = anchor?.getBoundingClientRect().top;
      mergeConversation(data.window);
      renderConversations();
      if (anchor?.isConnected) {
        conversations.scrollTop += anchor.getBoundingClientRect().top - top;
        lastScroll = conversations.scrollTop;
      }
      button.textContent = direction === "older" ? "Older transmissions" : "Newer transmissions";
    } catch {
      if (pageRequest === controller) button.textContent = "Retry loading transmissions";
    } finally {
      clearTimeout(timeout);
      if (pageRequest === controller) { pageRequest = null; renderConversations(); }
    }
  }

  older.addEventListener("click", () => pageHistory("older"));
  newer.addEventListener("click", () => pageHistory("newer"));
  selectedTime.addEventListener("click", revealTransmission);
  conversations.addEventListener("scroll", () => {
    const top = conversations.scrollTop;
    const delta = top - lastScroll;
    lastScroll = top;
    if (delta < 0 && top < 45) pageHistory("newer");
    if (delta > 0 && conversations.scrollHeight - conversations.clientHeight - top < 45) pageHistory("older");
  }, {passive: true});

  function resetConversation() {
    pageRequest?.abort(); pageRequest = null;
    conversation = null;
    conversations.scrollTop = 0;
    lastScroll = 0;
    older.textContent = "Older transmissions";
    newer.textContent = "Newer transmissions";
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
    if (old?.channel !== row.channel.id || id === null) resetConversation();
    selection = {channel: row.channel.id, id, liveSince, data: null, error: false, reveal: true};
    selectMarks(old);
    renderInspector();
    revealTransmission();
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
    try {
      const data = await fetchHistory(selected.channel, selected.id, controller.signal);
      if (inspectorRequest !== controller) return;
      const old = {...selected};
      selected.data = data;
      selected.error = false;
      mergeConversation(data.window);
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
      if (inspectorRequest === controller) {
        inspectorRequest = null;
        renderInspector();
        if (selected.reveal) {
          revealTransmission();
          selected.reveal = false;
        }
      }
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
      if (pastEnd === null && Number.isFinite(ch.active_since_ms) && Number.isFinite(ch.active_until_ms) && range.end - ch.last_sample_ms < 5000) {
        position(row.live, ch.active_since_ms, ch.active_until_ms, range);
      } else {
        row.live.hidden = true;
      }
      if (!row.live.hidden) {
        receiving++;
        row.live.dataset.kind = kindOf(ch.default_kind);
        row.live.setAttribute("aria-label", channelName(ch) + " · " + kinds.get(row.live.dataset.kind) +
          " · Receiving since " + seconds(ch.active_since_ms) + " " + zone());
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
      write(ticks[i], minutes(stamp));
    }
    const past = pastEnd !== null;
    write(ticks.at(-1), past ? minutes(range.end) : "Now");
    write(get(".tl-heading h2"), past ? date(range.start) : "Last 60 minutes");
    now.hidden = !past;
    axis.setAttribute("aria-label", "Time ruler · " + zone());
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
    counts.push(zone());
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
    else if (pastEnd !== null && fetchedEnd !== pastEnd) message = drag || panFrame ? "" : "Loading this hour…";
    else if (!recordingCount && !receiving) message = pastEnd === null
      ? "No recorded transmissions in the last hour." : "No recorded transmissions in this hour.";
    write(get(".tl-feedback"), message);
  }

  async function refresh() {
    if (!visible || request || !state || drag || panFrame || (pastEnd !== null && pastEnd === fetchedEnd)) return;
    const end = pastEnd;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const query = end === null ? "" : "?end_ms=" + end;
      const response = await fetch("/api/timeline" + query, {signal: controller.signal, cache: "no-store"});
      if (!response.ok) throw Error("Timeline unavailable");
      const payload = await response.json();
      if (request !== controller) return;
      if (payload.profile !== state.profile || payload.source !== state.source ||
          !Array.isArray(payload.transmissions) || !(payload.end_ms > payload.start_ms)) throw Error("Invalid timeline");
      history = payload;
      fetchedEnd = end;
      if (end === null) {
        syncedAt = performance.now();
        syncedEnd = payload.end_ms;
      }
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
      fetchedEnd = null;
      pastEnd = null;
      drag = null;
      stopPan();
      failed = false;
      hideTip();
      inspectorRequest?.abort(); inspectorRequest = null;
      resetConversation();
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
  window.addEventListener("a16t-timezone-change", () => {
    if (visible) { renderHistory(); renderInspector(); }
  });

  function hide() {
    visible = false;
    hideTip();
    request?.abort(); request = null;
    inspectorRequest?.abort(); inspectorRequest = null;
    pageRequest?.abort(); pageRequest = null;
    drag = null;
    stopPan();
    clearInterval(timer);
    clearPlayer();
  }

  return {show, update, hide};
})();
