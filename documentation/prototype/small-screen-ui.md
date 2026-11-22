# Small-Screen UI Strategy

> **Prototype archive.** This page describes the earlier Python prototype. Its commands, paths, release numbers, and plans apply to that implementation. For the Rust application, see the [current documentation](../README.md).

## Premise

A16T should be designed for a small laptop first, then adapted down to tablet and phone. This is an operator UI, not a marketing page and not a classic dashboard. The most important state is live radio activity, so the interface must keep current activity visible even while the user reviews older transcripts.

Primary design target:

- Small laptop: roughly `1280x720`, `1280x800`, or `1366x768`.

Secondary targets:

- Tablet landscape and portrait.
- Phone portrait.
- Phone landscape only as a supported fallback, not the main design.

## Visual Thesis

Compact radio instrument: dense, calm, high-contrast, and scan-first, with active transmissions expanding naturally instead of forcing the user to hunt through cards.

## Interaction Thesis

- Live activity rises to the top automatically.
- Active or urgent events can open a detail sheet without replacing the whole monitoring view.
- The same data supports several modes, but small screens show one mode at a time.

## Information Priority

Every viewport should preserve this order:

1. Emergency or distress alert.
2. Currently active frequency or frequencies.
3. Current participant and message type, when known.
4. Live or latest transcript text.
5. Recent history.
6. Setup controls.

Setup should never compete with live monitoring. It can live behind a separate view or sheet.

## Core Layout Model

Use three zones:

- Live rail: persistent compact list of monitored channels and alert state.
- Work area: selected mode, such as Watchboard, Timeline, or Transcript Review.
- Detail sheet: selected transmission, audio, transcript, metadata, and corrections.

On wide screens these zones can sit side by side. On small screens the live rail stays visible and the work area/detail sheet become switchable layers.

## Small Laptop Layout

Recommended structure:

```text
+-------------------------------------------------------------+
| Profile, SDR state, transcription budget, clock, alert       |
+--------------+----------------------------------------------+
| Live rail    | Work area                                    |
| channels     | Watchboard / timeline / transcript feed      |
| active first |                                              |
|              |                                              |
+--------------+----------------------------------------------+
| Selected transmission sheet: audio, transcript, metadata     |
+-------------------------------------------------------------+
```

Behavior:

- The live rail is narrow and always visible.
- Active channels move to the top or receive a strong active treatment.
- The work area shows only one primary mode at a time.
- The selected transmission sheet is docked at the bottom by default and can collapse to a one-line summary.
- Timeline density should be high, but row height must stay stable so activity does not move the layout.

Recommended dimensions:

- Top bar: `36-44px`.
- Live rail: `220-280px`.
- Channel row: `52-64px`.
- Bottom detail sheet collapsed: `44-56px`.
- Bottom detail sheet expanded: up to `35-45%` of viewport height.

## Tablet Layout

Landscape:

- Similar to small laptop.
- Live rail can remain left.
- Detail sheet can dock right or bottom depending on width.

Portrait:

- Top compact status bar.
- Live rail becomes a horizontal active strip or a collapsible drawer.
- Work area takes the full width.
- Detail opens as a bottom sheet.

Touch targets should be at least `44px` high.

## Phone Layout

Phone should not try to show the full desktop console. It should become a focused monitor.

Recommended structure:

```text
+----------------------------+
| Alert / active summary     |
+----------------------------+
| Active channel cards       |
| Review or setup when open  |
|                            |
+----------------------------+
| Compact tools in header    |
+----------------------------+
```

Compact tools:

- Monitoring is the implicit default surface.
- Review and Setup should sit behind compact header controls or a small menu.
- Setup can become more visible later if diagnostics have warnings or errors.

Behavior:

- Monitoring is the default state and does not need its own persistent button.
- Active transmissions appear first.
- Idle channels collapse to compact rows.
- Tapping a channel opens a bottom sheet with audio, transcript, and metadata.
- Emergency or distress messages override the current tool view and show a clear alert banner.

## Watchboard On Small Screens

The Watchboard should not be a grid of equal cards on small screens. It should be a prioritized list:

- Active channels first.
- Recently active channels next.
- Idle channels last.

Each channel row should show:

- Frequency.
- Short label.
- Activity state.
- Tiny signal meter.
- Timer when active.
- Participant badge when known.
- Message type badge when known.

When a channel becomes active, it can expand vertically to show a live transcript preview. Idle rows should remain compact.

## Timeline On Small Screens

The timeline needs two representations:

- Compact activity lanes for laptop and tablet landscape.
- Event list for phone and tablet portrait.

On phone, horizontal multi-hour lanes are usually less useful than a chronological list grouped by channel and time. Keep the timeline lane view available, but do not make it the only way to review history.

## Transcript Review On Small Screens

Transcript Review should become a conversation feed:

- One transmission per block.
- Participant label at the top.
- Message type and confidence beside it.
- Transcript text below.
- Audio player collapsed behind a play button.
- Correction actions inside a secondary menu.

Long metadata should stay hidden until requested.

## Alerts

Distress and emergency alerts override the selected color mode and layout mode.

Use:

- Red alert bar.
- Strong border around the active item.
- Distinct icon or text label.
- Optional pulse only when reduced-motion settings allow it.

Do not rely on color alone. Include text such as `Distress`, `Mayday`, or `Possible emergency`.

## Responsive Implementation Rules

- Use CSS grid and container queries where possible.
- Avoid viewport-scaled font sizes.
- Use `svh` units for mobile viewport height behavior.
- Keep row heights stable so active states do not shift nearby controls unpredictably.
- Virtualize long transcript/history lists once needed.
- Keep keyboard access for laptop use and touch targets for phone/tablet use.
- Prefer bottom sheets and drawers over modal dialogs on small screens.
- Do not show dense setup forms in the same view as live monitoring.

## Implemented UI Milestones

The `0.7.0` UI milestone implements the first small-screen Watchboard:

1. Top status bar.
2. Prioritized channel rows with active channels first.
3. Recent transmission list.
4. Selected transmission detail with audio and transcript text.
5. Event-driven browser updates through `GET /events`.

The `0.8.0` UI milestone adds participant/message badges, emergency and urgent alert treatment, priority sorting, and confidence/evidence in the selected transmission detail. The selected detail should keep transcript text prominent: use a fixed, non-scrollable transcript box in the bottom-right inspector, place frequency/time/duration/provider/participant/message metadata beside it, and expose confidence/evidence through small `i` hints next to participant and message instead of full metadata rows.

The `0.9.0` UI milestone adds Review filters and a compact timeline list for recent transmissions while keeping the Watchboard visible above the workspace. Monitoring remains the implicit default, while Review is opened from a compact secondary header control.

The `0.11.0` UI milestone adds a Setup surface for runtime mode, capture settings, paths, diagnostic checks, and recent app events. Setup is opened from a compact secondary header control and should stay calm unless warnings or errors need stronger attention.

The `0.12.0` UI milestone adds compact Review edit controls to the selected transmission detail. The controls reuse the existing detail surface so small screens do not need a separate correction workflow.

The `0.17.0` UI milestone adds dense Watchboard band mode for larger profile channel sets. Dense mode keeps every configured channel visible as a sparse horizontal time lane with the channel number pinned at the left. Marine lanes are ordered by visible channel number from 1A through 88, not by RF frequency. The X axis is time; each transmission appears as a segment on its channel lane, multiple transmissions can share one lane, and channel spacing stays constant whether a channel is idle or active. Short 15-minute and 1-hour scales keep recent traffic legible on a small screen while longer windows remain available for review. Dotted vertical markers provide scale context: 3-hour marks on the 24-hour window, hours on mid-range windows, 15-minute marks on the 1-hour window, and 5-minute marks on the 15-minute window when there is enough horizontal space. On narrow browser widths, the grid should automatically choose a sparser marker interval so top and bottom time labels do not overlap. Marker times are shown at the top and bottom next to the dotted lines, replacing separate start/middle/now axis captions. Transmission segment hover text should appear in one custom tooltip, use 24-hour time, and stay to three compact lines: start time, speaker/participant, and message classification.

The first versions keep the app as one responsive surface with light mode navigation. Later tablet and phone work should adapt these same pieces into tabs, sheets, and drawers instead of designing a separate mobile app.
