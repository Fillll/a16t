"use strict";

const $ = id => document.getElementById(id);
const utcClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});
const utcDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "2-digit", month: "short", year: "numeric"
});
const channelNodes = new Map();
const clipNodes = new Map();
let snapshot = null;
let selectedChannel = null;
let selectedClip = null;
let liveChannel = null;
let liveAudio = null;
let lastUpdate = 0;
let fetching = false;
let initialRequestFailed = false;
let streamReady = false;
let revision = 0;
let timelineVisible = false;

function element(tag, name, content) {
  const node = document.createElement(tag);
  if (name) node.className = name;
  if (content != null) node.textContent = content;
  return node;
}

function setText(node, content) {
  if (node.textContent !== content) node.textContent = content;
}

function fmtFreq(hz) { return Number.isFinite(hz) ? (hz / 1e6).toFixed(3) + " MHz" : "—"; }

function dB(value) {
  if (value === 0) return "−∞";
  return value > 0 && Number.isFinite(value) ? (20 * Math.log10(value)).toFixed(1) : "—";
}

function meterPercent(value) {
  return value > 0 ? Math.min(100, Math.max(0, (20 * Math.log10(value) + 80) * 1.25)) : 0;
}

function sampleAge(ms) {
  if (!ms) return "No samples";
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  if (seconds < 1) return "Now";
  if (seconds < 60) return Math.floor(seconds) + " s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
  return utcDate.format(ms) + " " + utcClock.format(ms) + " UTC";
}

function note(node, message) {
  setText(node, message);
  node.hidden = !message;
}

function applySnapshot(state) {
  if (!state || !Array.isArray(state.channels) || !Array.isArray(state.clips)) {
    throw Error("Invalid receiver snapshot");
  }
  snapshot = state;
  lastUpdate = Date.now();
  revision++;
  if (!state.channels.some(channel => channel.id === selectedChannel)) {
    stopListening();
    selectedChannel = state.channels[0]?.id ?? null;
  }
  if (!state.clips.some(clip => clip.id === selectedClip)) {
    selectedClip = state.clips[0]?.id ?? null;
  }
  setText($("profile"), state.profile || "—");
  setText($("source"), state.source || "—");
  setText($("receiver"), state.receiver || "—");
  const archiveWarning = [];
  if (state.dropped_clips) archiveWarning.push(state.dropped_clips + (state.dropped_clips === 1 ? " dropped recording" : " dropped recordings"));
  if (state.archive_error) archiveWarning.push(state.archive_error);
  note($("archive-warning"), archiveWarning.join(" · "));
  if (timelineVisible) window.a16tTimeline.update(state);
  else {
    renderChannels();
    renderClips();
  }
  updateConnection();
}

// Keep buttons, keyboard focus and scroll positions when a new snapshot arrives.
function updateRows(parent, cache, items, create, update) {
  const keys = new Set(items.map(item => item.id));
  for (const [id, row] of cache) {
    if (!keys.has(id)) {
      row.button.remove();
      cache.delete(id);
    }
  }
  let next = parent.firstElementChild;
  for (const item of items) {
    let row = cache.get(item.id);
    if (!row) {
      row = create(item.id);
      cache.set(item.id, row);
    }
    update(row, item);
    if (row.button !== next) parent.insertBefore(row.button, next);
    next = row.button.nextElementSibling;
  }
}

function channelRow(id) {
  const button = element("button", "channel-row");
  button.type = "button";
  button.addEventListener("click", () => {
    if (selectedChannel !== id) stopListening();
    selectedChannel = id;
    renderChannels();
  });
  const label = element("span", "channel-name");
  const freq = element("span", "frequency");
  const name = element("span");
  name.append(label, freq);
  const meter = element("span", "meter");
  meter.setAttribute("aria-hidden", "true");
  const bar = element("span", "meter-fill");
  const threshold = element("span", "meter-threshold");
  meter.append(bar, threshold);
  const db = element("span", "db");
  const signal = element("span", "signal");
  signal.append(meter, db);
  const status = element("span", "status channel-state");
  button.append(name, signal, status);
  return {button, label, freq, bar, threshold, db, status};
}

function updateChannel(row, channel) {
  const hasSample = Number.isFinite(channel.last_sample_ms) && channel.last_sample_ms > 0;
  const stale = hasSample && Date.now() - channel.last_sample_ms > 5000;
  const active = hasSample && !stale && channel.active;
  setText(row.label, channel.label || channel.id);
  setText(row.freq, fmtFreq(channel.frequency_hz));
  row.button.setAttribute("aria-pressed", String(channel.id === selectedChannel));
  row.button.dataset.active = String(Boolean(active));
  setText(row.status, !hasSample ? "Waiting" : stale ? "Stale" : active ? "Active" : "Idle");
  row.status.classList.toggle("active", Boolean(active));
  row.status.classList.toggle("stale", stale);
  row.bar.style.width = (hasSample ? meterPercent(channel.level) : 0) + "%";
  row.threshold.style.left = meterPercent(channel.threshold) + "%";
  setText(row.db, hasSample ? dB(channel.level) + " dBFS" : "—");
}

function renderChannels() {
  if (!snapshot) return;
  const channels = snapshot.channels;
  const filtering = channels.length > 10;
  $("channel-filter-wrap").hidden = !filtering;
  const query = filtering ? $("channel-filter").value.trim().toLowerCase() : "";
  const visible = channels.filter(channel => !query || [channel.id, channel.label, fmtFreq(channel.frequency_hz)]
    .some(field => String(field).toLowerCase().includes(query)));
  const active = channels.filter(channel => channel.active && Date.now() - channel.last_sample_ms < 5000).length;
  setText($("channel-count"), active + " active / " + channels.length);
  updateRows($("channel-list"), channelNodes, visible, channelRow, updateChannel);
  note($("channel-empty"), visible.length ? "" : channels.length ? "No matching channels." : "No channels configured.");
  const channel = channels.find(item => item.id === selectedChannel);
  $("inspector").hidden = !channel;
  if (!channel) return;
  const ended = snapshot.receiver === "finished" || String(snapshot.receiver).startsWith("receiver error");
  $("listen").disabled = ended && liveChannel === null;
  $("listen").title = ended ? "Receiver has stopped delivering audio" : "";
  setText($("selected-name"), channel.label || channel.id);
  setText($("selected-level"), channel.last_sample_ms ? dB(channel.level) + " dBFS" : "—");
  setText($("selected-threshold"), dB(channel.threshold) + " dBFS");
  setText($("selected-last"), sampleAge(channel.last_sample_ms));
  setText($("selected-dropped"), Number(channel.dropped_samples || 0).toLocaleString());
}

function clipRow(id) {
  const button = element("button", "clip-row");
  button.type = "button";
  button.addEventListener("click", () => {
    selectedClip = id;
    renderClips();
  });
  const label = element("span", "clip-label");
  const time = element("span", "clip-time");
  const when = element("span");
  when.append(label, time);
  const duration = element("span", "clip-duration");
  button.append(when, duration);
  return {button, label, time, duration};
}

function clipName(clip) {
  const channel = snapshot.profile === clip.profile
    ? snapshot.channels.find(item => item.id === clip.channel) : null;
  return channel?.label || clip.channel;
}

function updateClip(row, clip) {
  setText(row.label, clipName(clip));
  const when = utcDate.format(clip.start_ms) + " · " + utcClock.format(clip.start_ms) + " UTC";
  setText(row.time, when + (clip.status === "expired" ? " · Audio expired" : ""));
  setText(row.duration, (clip.duration_ms / 1000).toFixed(1) + " s");
  row.button.setAttribute("aria-pressed", String(clip.id === selectedClip));
}

function renderClips() {
  if (!snapshot) return;
  const clips = snapshot.clips;
  updateRows($("clip-list"), clipNodes, clips, clipRow, updateClip);
  setText($("clip-count"), String(clips.length));
  note($("clip-empty"), clips.length ? "" : "No recordings yet.");
  const item = clips.find(clip => clip.id === selectedClip);
  const player = $("clip-audio");
  $("clip-detail").hidden = !item;
  if (!item) {
    if (player.hasAttribute("src")) {
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    return;
  }
  const path = "/api/clips/" + encodeURIComponent(item.id) + "/audio";
  const available = !["expiring", "expired", "incomplete", "recording"].includes(item.status);
  player.hidden = !available;
  if (!available && player.hasAttribute("src")) {
    player.pause();
    player.removeAttribute("src");
    player.load();
    note($("clip-message"), "");
  } else if (available && player.getAttribute("src") !== path) {
    player.src = path;
    note($("clip-message"), "");
  }
  const expired = ["expiring", "expired"].includes(item.status);
  note($("clip-info"), item.error || (expired ? "Audio expired under the storage budget." : ""));
  setText($("clip-title"), clipName(item) + " · " + utcClock.format(item.start_ms) + " UTC");
  setText($("clip-status"), item.status || "");
  setText($("clip-metadata"), [utcDate.format(item.start_ms), fmtFreq(item.frequency_hz), item.profile, item.source]
    .filter(Boolean).join(" · "));
  const transcription = {
    complete: "No speech transcribed.", disabled: "Transcription disabled for this recording.",
    pending: "Awaiting transcription.", sending: "Transcription in progress.",
    paused: "Transcription paused.", failed: "Transcription failed.", uncertain: "Transcription result unknown."
  };
  setText($("clip-text"), item.transcript || transcription[item.transcription_status] || "No transcript available.");
}

function stopListening(message = "") {
  liveChannel = null;
  if (liveAudio) {
    liveAudio.abort.abort();
    liveAudio.context.close().catch(() => {});
    liveAudio = null;
  }
  $("listen").setAttribute("aria-pressed", "false");
  setText($("listen"), "Listen live");
  note($("listen-message"), message);
}

// Read the receiver's fixed PCM WAV header once, then schedule the samples as
// they arrive. Waiting for a media element to buffer an unbounded WAV can delay
// playback beyond the length of a short transmission.
async function playMonitor(id, player) {
  const response = await fetch("/api/listen/" + encodeURIComponent(id), {signal: player.abort.signal});
  if (!response.ok || !response.body) throw Error("The receiver is not delivering audio.");
  const reader = response.body.getReader();
  let headerRead = false;
  let remainder = new Uint8Array();
  let nextTime = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done || player !== liveAudio) break;
    let chunk = value;
    if (remainder.length) {
      chunk = new Uint8Array(remainder.length + value.length);
      chunk.set(remainder);
      chunk.set(value, remainder.length);
      remainder = new Uint8Array();
    }
    if (!headerRead) {
      if (chunk.length < 44) {
        remainder = chunk;
        continue;
      }
      const header = new DataView(chunk.buffer, chunk.byteOffset, 44);
      if (header.getUint32(0) !== 0x52494646 || header.getUint32(8) !== 0x57415645 ||
          header.getUint32(36) !== 0x64617461 || header.getUint16(20, true) !== 1 ||
          header.getUint16(22, true) !== 1 || header.getUint32(24, true) !== 16000 ||
          header.getUint16(34, true) !== 16) throw Error("Unsupported monitor audio format.");
      headerRead = true;
      chunk = chunk.subarray(44);
    }
    if (chunk.length % 2) remainder = chunk.slice(-1);
    const samples = Math.floor(chunk.length / 2);
    if (!samples) continue;
    const context = player.context;
    // Discard playback backlog after a browser stall so monitoring stays live.
    if (nextTime > context.currentTime + 0.5) continue;
    const count = Math.min(samples, 8000);
    const bytes = new DataView(chunk.buffer, chunk.byteOffset + (samples - count) * 2, count * 2);
    const buffer = context.createBuffer(1, count, 16000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < count; i++) channel[i] = bytes.getInt16(2 * i, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => source.disconnect();
    const start = Math.max(nextTime, context.currentTime + 0.04);
    source.start(start);
    nextTime = start + buffer.duration;
    note($("listen-message"), "");
  }
  if (player === liveAudio) {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextTime - player.context.currentTime) * 1000));
    if (player === liveAudio) stopListening("The live audio stream ended.");
  }
}

async function listen() {
  if (liveChannel !== null) {
    stopListening();
    return;
  }
  const id = selectedChannel;
  if (id === null) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) { stopListening("This browser does not support live audio."); return; }
  let player;
  try {
    player = {context: new Context({latencyHint: "interactive"}), abort: new AbortController()};
    liveAudio = player;
    liveChannel = id;
    $("clip-audio").pause();
    note($("listen-message"), "Waiting for audio…");
    $("listen").setAttribute("aria-pressed", "true");
    setText($("listen"), "Stop listening");
    await player.context.resume();
    if (player === liveAudio) await playMonitor(id, player);
  } catch (error) {
    if (!player || liveAudio === player) stopListening("Live audio unavailable. " + error.message);
  }
}

function updateConnection() {
  const node = $("connection");
  const age = Date.now() - lastUpdate;
  let status = initialRequestFailed ? "Receiver unavailable" : "Connecting";
  if (snapshot) status = age > 10000 ? "Connection lost" : streamReady ? "Connected" : "Polling";
  setText(node, status);
  node.className = status === "Connected" || status === "Polling" ? "good" : "warn";
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  const before = revision;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 4000);
  try {
    const response = await fetch("/api/state", {cache: "no-store", signal: abort.signal});
    if (!response.ok) throw Error("Receiver unavailable");
    const state = await response.json();
    if (before === revision) applySnapshot(state);
  } catch {
    if (!snapshot) {
      initialRequestFailed = true;
      updateConnection();
      setText($("channel-empty"), "Receiver unavailable. Reconnecting…");
      setText($("clip-empty"), "Recording history unavailable.");
    }
  } finally {
    fetching = false;
    clearTimeout(timeout);
  }
}

function selectView() {
  timelineVisible = location.hash === "#timeline";
  document.body.classList.toggle("timeline-page", timelineVisible);
  const title = timelineVisible ? "Timeline" : "Watchboard";
  setText($("title"), title);
  document.title = "A16T · " + title;
  $("watchboard-view").hidden = timelineVisible;
  $("timeline-view").hidden = !timelineVisible;
  for (const name of ["Timeline", "Watchboard"]) {
    const link = $(name.toLowerCase() + "-link");
    if (name === title) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (timelineVisible) {
    stopListening();
    $("clip-audio").pause();
    window.a16tTimeline.show(snapshot);
  } else {
    window.a16tTimeline.hide();
    if (snapshot) {
      renderChannels();
      renderClips();
    }
  }
}
window.addEventListener("hashchange", selectView);
selectView();
$("channel-filter").addEventListener("input", renderChannels);
$("listen").addEventListener("click", listen);
$("clip-audio").addEventListener("error", () => {
  if ($("clip-audio").hasAttribute("src")) note($("clip-message"), "Recording audio unavailable.");
});
$("clip-audio").addEventListener("play", () => {
  note($("clip-message"), "");
  if (liveChannel !== null) stopListening();
});
if ("EventSource" in window) {
  const events = new EventSource("/events");
  const receive = event => {
    try {
      streamReady = true;
      applySnapshot(JSON.parse(event.data));
    } catch {
      streamReady = false;
      refresh();
    }
  };
  events.addEventListener("state", receive);
  events.onmessage = receive;
  events.onerror = () => { streamReady = false; updateConnection(); refresh(); };
}
function tick() {
  setText($("clock"), utcClock.format(Date.now()) + " UTC");
  updateConnection();
  if (!lastUpdate || Date.now() - lastUpdate > 4500) {
    streamReady = false;
    refresh();
  }
  if (snapshot && !timelineVisible) renderChannels();
}
tick();
setInterval(tick, 1000);
