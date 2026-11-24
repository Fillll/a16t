# Watchboard

The Watchboard and Timeline share a compact header with the active profile and connection status. The status also shows when the receiver is starting, stopped, or reporting an error. The receiver selects its profile at startup. The browser fetches an initial snapshot from `/api/state`, listens to `/events`, and polls the state endpoint when the stream is unavailable. Recording continues in the receiver when the page closes. Times are UTC.

Choose **Timeline** in the header to see the last 60 minutes. Every channel in the running profile has a row. The 48-channel Marine VHF profile appears in channel-number order in both views. Channel 16's label is red. Other profiles follow their configured order. The same time scale applies to every timeline row so overlapping marks show simultaneous activity. Open `/#timeline` to go directly to this view.

Each channel has a thin line. A colored drop marks a transmission, with a minimum visible width for short calls. Hover over a drop or focus it with the keyboard for its type, channel, UTC time, duration and a short transcript excerpt when available.

Select a drop to see its audio and full transcript in the transmission panel alongside the plot. On a narrow screen the panel appears below the plot. Selecting a channel number opens that channel's newest recording, and **Previous** and **Next** step through its archive even outside the hour plotted. Expired recordings keep their time and transcript. A selected live drop shows its receiving status until the recording is saved.

The legend identifies distress (MAYDAY), urgency (PAN-PAN), safety (SÉCURITÉ), port communications and other traffic. A completed transcript can identify an explicit priority call or port communication. When the words do not identify a type, the view uses the channel's configured purpose where available. The details show which source supplied the label. Mixed-use channels such as 16 stay unclassified without supporting words.

A live drop appears once the detector confirms activity. Its extent grows with received audio. A saved interval includes the recording's pre-roll and hang time. An empty line means the archive has no detection in the displayed hour, which can also happen while the receiver was offline.

Select a channel to inspect its latest audio level, detection threshold, last sample and adapter gap sample count. The gap count measures missing samples between consecutive frame indices from the GNU Radio adapter. The adapter does not expose upstream USB overrun counts. The horizontal meter shows decoded audio on a scale of −80 to 0 dBFS. Its vertical marker is the threshold. A gap longer than five seconds changes the row to **Stale**. **Waiting** indicates that the channel has not delivered a sample. For profiles with more than ten channels, type a channel name, identifier or frequency in the search field.

**Listen live** reads the selected channel’s 16 kHz mono PCM stream. Web Audio schedules arriving samples for low-latency playback. The activity detector controls recording independently of listening. Playing a saved clip stops live listening, and selecting a different channel ends the previous stream. A clip retains the profile and acquisition source recorded at capture. The selected recording shows its UTC start time, frequency, source, transcript, and audio player.

The Watchboard header, browser tab, and repository README share the [A16T mark](../web/a16t-mark.svg). Its longer teal center bar represents an active channel. The SVG uses a 16-pixel grid and adapts to light and dark backgrounds.

The Rust executable serves embedded HTML, CSS, JavaScript, and the logo. System fonts and local assets keep the interface available offline.
