# Watchboard

The local browser Watchboard displays the receiver profile, source and reported state, channel activity, and recent recordings. It fetches an initial snapshot from `/api/state`, listens to `/events`, and polls the state endpoint when the stream is unavailable. Recording continues in the receiver when the page closes. Times are UTC.

Choose **Timeline** in the header to see the last 60 minutes. Every channel in the running profile has a row, in profile order. East Bay Marine has four rows and Marine VHF has 48. The same time scale applies to every row so overlapping marks show simultaneous activity. Open `/#timeline` to go directly to this view.

A live mark appears when a signal meets the detector's minimum activity duration. It grows as audio arrives. Saved marks cover the recorded interval, including pre-roll and hang time. Select a mark to inspect its UTC time and duration or play the recording while audio is available. A blank interval means the archive has no detection there, which can also happen while the receiver was offline.

Select a channel to inspect its latest audio level, detection threshold, last sample and adapter gap sample count. The gap count measures missing samples between consecutive frame indices from the GNU Radio adapter. The adapter does not expose upstream USB overrun counts. The horizontal meter shows decoded audio on a scale of −80 to 0 dBFS. Its vertical marker is the threshold. A gap longer than five seconds changes the row to **Stale**. **Waiting** indicates that the channel has not delivered a sample. For profiles with more than ten channels, type a channel name, identifier or frequency in the search field.

**Listen live** reads the selected channel’s 16 kHz mono PCM stream. Web Audio schedules arriving samples for low-latency playback. The activity detector controls recording independently of listening. Playing a saved clip stops live listening, and selecting a different channel ends the previous stream. A clip retains the profile and acquisition source recorded at capture. The selected recording shows its UTC start time, frequency, source, transcript, and audio player.

The Watchboard header, browser tab, and repository README share the [A16T mark](../web/a16t-mark.svg). Its longer teal center bar represents an active channel. The SVG uses a 16-pixel grid and adapts to light and dark backgrounds.

The Rust executable serves embedded HTML, CSS, JavaScript, and the logo. System fonts and local assets keep the interface available offline.
