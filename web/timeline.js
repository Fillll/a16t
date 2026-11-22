"use strict";

window.a16tTimeline = (() => {
  const view = document.getElementById("timeline-view");
  const hour = 60 * 60 * 1000;
  const minutes = new Intl.DateTimeFormat("en-GB", {timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23"});
  const seconds = new Intl.DateTimeFormat("en-GB", {timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"});
  const date = new Intl.DateTimeFormat("en-GB", {timeZone: "UTC", day: "2-digit", month: "short", year: "numeric"});
  const rows = new Map();
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

  view.innerHTML = `
    <div class="tl-heading"><div><h2>Last 60 minutes</h2><p class="tl-summary"></p></div>
      <div class="tl-legend"><span>Recorded</span><span>Receiving</span></div></div>
    <div class="tl-scroll" tabindex="0" role="region" aria-label="Channel activity over the last hour">
      <div class="tl-axis"><span class="tl-axis-label">Channel</span>
        <div class="tl-scale" aria-label="Time in UTC"><span></span><span></span><span></span><span></span><span>Now</span></div></div>
      <div class="tl-rows" role="list" aria-label="Channels in selected profile"></div>
    </div>
    <p class="tl-feedback" role="status"></p>
    <dialog class="tl-dialog" aria-labelledby="tl-detail-channel">
      <div class="tl-dialog-head"><div><p class="eyebrow">Transmission</p><h3 id="tl-detail-channel"></h3></div>
        <button type="button" class="tl-close" autofocus>Close</button></div>
      <label class="tl-picker-label" for="tl-picker">Recording on this channel</label>
      <select id="tl-picker"></select><p class="tl-details"></p>
      <audio controls preload="none" aria-label="Timeline recording"></audio><p class="tl-audio-note" role="status"></p>
    </dialog>`;
  const get = selector => view.querySelector(selector);
  const list = get(".tl-rows");
  const ticks = [...view.querySelectorAll(".tl-scale span")];
  const dialog = get("dialog");
  const picker = get("select");
  const player = get("audio");

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
    // Keep even a subsecond call visible at the right-hand edge of the plot.
    mark.style.left = `min(calc(100% - 4px), ${(start - range.start) * 100 / range.width}%)`;
    mark.style.width = `${(end - start) * 100 / range.width}%`;
  }

  function precise(ms) {
    return seconds.format(ms) + "." + String(Math.floor(ms) % 1000).padStart(3, "0");
  }

  function timeLabel(clip) {
    return precise(clip.start_ms) + " – " + precise(clip.end_ms) + " UTC";
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
    write(get("#tl-detail-channel"), row.channel.label || row.channel.id);
    const duration = (clip.end_ms - clip.start_ms) / 1000;
    write(get(".tl-details"), `${date.format(clip.start_ms)} · ${timeLabel(clip)} · ${duration.toFixed(2)} s · ${row.freq.textContent} MHz`);
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
    picker.replaceChildren();
    for (const item of row.clips.values()) {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = timeLabel(item);
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
    node.innerHTML = `<div class="tl-channel"><button type="button" class="tl-name" disabled></button><span class="tl-freq"></span></div>
      <div class="tl-lane"><span class="tl-live" hidden></span></div>`;
    const row = {node, channel, clips: new Map(), marks: new Map(), name: node.querySelector("button"),
      freq: node.querySelector(".tl-freq"), lane: node.querySelector(".tl-lane"), live: node.querySelector(".tl-live")};
    row.name.addEventListener("click", () => {
      const latest = [...row.clips.keys()].pop();
      if (latest != null) inspect(row, latest);
    });
    return row;
  }

  function syncRows(channels) {
    const ids = new Set(channels.map(ch => ch.id));
    for (const [id, row] of rows) {
      if (!ids.has(id)) { row.node.remove(); rows.delete(id); }
    }
    let next = list.firstElementChild;
    for (const channel of channels) {
      let row = rows.get(channel.id);
      if (!row) { row = createRow(channel); rows.set(channel.id, row); }
      row.channel = channel;
      const label = channel.label || channel.id;
      write(row.name, label);
      write(row.freq, (channel.frequency_hz / 1e6).toFixed(3));
      row.freq.setAttribute("aria-label", row.freq.textContent + " megahertz");
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
        row.live.title = "Receiving since " + seconds.format(ch.active_since_ms) + " UTC";
        row.live.setAttribute("role", "img");
        row.live.setAttribute("aria-label", row.live.title);
      }
    }
    return receiving;
  }

  function renderHistory() {
    const range = bounds();
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
        if (!row.clips.has(id)) { mark.remove(); row.marks.delete(id); }
      }
      for (const clip of row.clips.values()) {
        let mark = row.marks.get(clip.id);
        if (!mark) {
          mark = document.createElement("button");
          mark.type = "button";
          mark.className = "tl-mark";
          mark.title = row.name.textContent + " · " + timeLabel(clip);
          mark.setAttribute("aria-label", mark.title);
          mark.addEventListener("click", () => inspect(row, clip.id));
          row.lane.append(mark);
          row.marks.set(clip.id, mark);
        }
        position(mark, clip.start_ms, clip.end_ms, range);
      }
      row.name.disabled = !row.clips.size;
      row.name.title = row.clips.size ? `Inspect ${row.name.textContent} recordings` : "";
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
    renderHistory();
    refresh();
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  function hide() {
    visible = false;
    request?.abort(); request = null;
    clearInterval(timer);
    if (dialog.open) dialog.close();
    clearPlayer();
  }

  return {show, update, hide};
})();
