# Watchboard

The local browser Watchboard displays the receiver profile, source and reported state, channel activity, and recent recordings. It fetches an initial snapshot from `/api/state`, listens to `/events`, and polls the state endpoint when the stream is unavailable. Recording continues in the receiver when the page closes. Times are UTC.

Select a channel to inspect its latest audio level, detection threshold, last sample and adapter gap sample count. The gap count measures missing samples between consecutive frame indices from the GNU Radio adapter. The adapter does not expose upstream USB overrun counts. The horizontal meter shows decoded audio on a scale of −80 to 0 dBFS. Its vertical marker is the threshold. A gap longer than five seconds changes the row to **Stale**. **Waiting** indicates that the channel has not delivered a sample. For profiles with more than ten channels, type a channel name, identifier or frequency in the search field.

**Listen live** reads the selected channel’s 16 kHz mono PCM stream. Web Audio schedules arriving samples for low-latency playback. The activity detector controls recording independently of listening. Playing a saved clip stops live listening, and selecting a different channel ends the previous stream. A clip retains the profile and acquisition source recorded at capture. The selected recording shows its UTC start time, frequency, source, transcript, and audio player.

The Rust executable serves embedded HTML, CSS, and JavaScript. System fonts and local assets keep the interface available offline.
