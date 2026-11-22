use a16t::archive::Archive;
use a16t::detection::{Detector, RATE, Settings};
use anyhow::{Context, Result, bail, ensure};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::sync::{Arc, Mutex, mpsc::SyncSender};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn sample_time_ms(origin_ms: i64, sample: u64) -> i64 {
    origin_ms + (sample * 1000 / RATE as u64) as i64
}
#[derive(Deserialize)]
pub struct Profile {
    pub id: String,
    pub channels: Vec<Channel>,
    #[serde(default)]
    pub detection: Settings,
}
#[derive(Deserialize)]
pub struct Channel {
    pub id: String,
    pub label: String,
    pub frequency_hz: u64,
}
#[derive(Clone, Serialize)]
pub struct ChannelState {
    pub id: String,
    pub label: String,
    pub frequency_hz: u64,
    pub level: f32,
    pub threshold: f32,
    pub active: bool,
    pub active_since_ms: Option<i64>,
    pub active_until_ms: Option<i64>,
    pub last_sample_ms: Option<i64>,
    pub dropped_samples: u64,
}
pub struct Health {
    pub channels: Vec<ChannelState>,
    pub receiver: String,
    pub archive_error: Option<String>,
    pub dropped_clips: usize,
}
#[derive(Clone)]
pub struct App {
    pub health: Arc<Mutex<Health>>,
    pub profile: String,
    pub source: String,
    pub audio: Arc<Vec<broadcast::Sender<Bytes>>>,
    pub archive: Archive,
}
impl App {
    pub fn stream_finished(&self) -> bool {
        let state = self.health.lock().unwrap();
        !matches!(state.receiver.as_str(), "starting" | "receiving")
    }
    pub fn new(profile: &Profile, source: String, archive: Archive) -> Self {
        let mut channels = Vec::new();
        let mut audio = Vec::new();
        for ch in &profile.channels {
            channels.push(ChannelState {
                id: ch.id.clone(),
                label: ch.label.clone(),
                frequency_hz: ch.frequency_hz,
                level: 0.0,
                threshold: profile.detection.activity_threshold,
                active: false,
                active_since_ms: None,
                active_until_ms: None,
                last_sample_ms: None,
                dropped_samples: 0,
            });
            audio.push(broadcast::channel(64).0);
        }
        Self {
            profile: profile.id.clone(),
            source,
            archive,
            audio: Arc::new(audio),
            health: Arc::new(Mutex::new(Health {
                channels,
                receiver: "starting".into(),
                archive_error: None,
                dropped_clips: 0,
            })),
        }
    }
    pub fn receiver_status(&self, status: &str) {
        self.health.lock().unwrap().receiver = status.to_owned();
    }
}

pub struct Recording {
    pub channel: String,
    pub frequency_hz: u64,
    pub start_ms: i64,
    pub audio: Vec<i16>,
}
struct Frame {
    channel: usize,
    first: u64,
    pcm: Vec<u8>,
}
fn read_frame(reader: &mut impl Read) -> Result<Option<Frame>> {
    let mut header = [0u8; 18];
    match reader.read_exact(&mut header[..1]) {
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        result => result?,
    }
    reader
        .read_exact(&mut header[1..])
        .context("truncated radio header")?;
    ensure!(&header[..4] == b"A16F", "invalid receiver frame signature");
    let channel = u16::from_le_bytes(header[4..6].try_into()?) as usize;
    let n = u32::from_le_bytes(header[6..10].try_into()?) as usize;
    ensure!((1..=65_536).contains(&n), "invalid audio frame size {n}");
    let first = u64::from_le_bytes(header[10..18].try_into()?);
    ensure!(first <= i64::MAX as u64 / 1000, "invalid sample timestamp");
    let mut pcm = vec![0; n * 2];
    reader
        .read_exact(&mut pcm)
        .context("truncated radio audio")?;
    Ok(Some(Frame {
        channel,
        first,
        pcm,
    }))
}

pub fn receive(
    reader: &mut impl Read,
    profile: &Profile,
    app: &App,
    writer: SyncSender<Recording>,
) -> Result<()> {
    let mut detectors: Vec<_> = profile
        .channels
        .iter()
        .map(|_| Detector::new(profile.detection.clone()))
        .collect();
    let mut next = vec![0u64; detectors.len()];
    let mut epoch = None;
    let send = |index: usize, base: i64, segment: a16t::detection::Segment| {
        let ch = &profile.channels[index];
        let rec = Recording {
            channel: ch.id.clone(),
            frequency_hz: ch.frequency_hz,
            start_ms: sample_time_ms(base, segment.start),
            audio: segment.audio,
        };
        if let Err(e) = writer.try_send(rec) {
            let mut h = app.health.lock().unwrap();
            h.dropped_clips += 1;
            h.archive_error = Some(format!("Recording handoff failed: {e}"));
            eprintln!("Recording handoff failed for {}: {e}", ch.id);
        }
    };
    let result: Result<()> = (|| {
        while let Some(frame) = read_frame(reader)? {
            let i = frame.channel;
            let Some(detector) = detectors.get_mut(i) else {
                bail!("unknown receiver channel index {i}")
            };
            ensure!(
                frame.first >= next[i],
                "receiver sample counter moved backwards on channel {i}"
            );
            let base = *epoch.get_or_insert_with(now_ms);
            let gap = frame.first - next[i];
            if gap > 0
                && let Some(segment) = detector.flush()
            {
                send(i, base, segment);
            }
            let audio: Vec<_> = frame
                .pcm
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&v| i16::from_le_bytes(v))
                .collect();
            next[i] = frame.first + audio.len() as u64;
            if app.audio[i].receiver_count() > 0 {
                let _ = app.audio[i].send(Bytes::from(frame.pcm));
            }
            for clip in detector.feed(frame.first, &audio) {
                send(i, base, clip);
            }
            let mut h = app.health.lock().unwrap();
            if h.receiver == "starting" {
                h.receiver = "receiving".to_owned();
            }
            let state = &mut h.channels[i];
            state.level = detector.level;
            state.active = detector.active();
            (state.active_since_ms, state.active_until_ms) = detector
                .recording_interval()
                .map(|r| {
                    let start_ms = sample_time_ms(base, r.start);
                    let duration_ms = ((r.end - r.start) * 1000).div_ceil(RATE as u64);
                    (start_ms, start_ms + duration_ms as i64)
                })
                .unzip();
            state.last_sample_ms = Some(now_ms());
            state.dropped_samples += gap;
        }
        Ok(())
    })();
    for (i, detector) in detectors.iter_mut().enumerate() {
        if let Some(segment) = detector.flush() {
            send(i, epoch.unwrap_or_else(now_ms), segment);
        }
    }
    for channel in &mut app.health.lock().unwrap().channels {
        channel.active = false;
        channel.active_since_ms = None;
        channel.active_until_ms = None;
        channel.level = 0.0;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn end_of_stream_hands_off_and_clears_a_live_interval() {
        struct SnapshotAtEof<'a>(&'a App, &'a mut Option<ChannelState>);
        impl Read for SnapshotAtEof<'_> {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                *self.1 = Some(self.0.health.lock().unwrap().channels[0].clone());
                Ok(0)
            }
        }
        let profile: Profile = serde_json::from_str(
            r#"{"id":"test","channels":[{"id":"a","label":"A","frequency_hz":156800000}],
            "detection":{"warmup_sec":0,"min_duration_sec":0.01}}"#,
        )
        .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let archive = Archive::open(dir.path().to_owned(), false, 0).unwrap();
        let app = App::new(&profile, "replay".into(), archive);
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let mut frame = b"A16F".to_vec();
        frame.extend(0u16.to_le_bytes());
        frame.extend(320u32.to_le_bytes());
        frame.extend(0u64.to_le_bytes());
        frame.extend(4096i16.to_le_bytes().repeat(320));
        let mut observed = None;
        let mut stream = frame.as_slice().chain(SnapshotAtEof(&app, &mut observed));
        receive(&mut stream, &profile, &app, tx).unwrap();
        let live = observed.unwrap();
        let recording = rx.try_recv().unwrap();
        assert_eq!(live.active_since_ms, Some(recording.start_ms));
        assert_eq!(live.active_until_ms, Some(recording.start_ms + 20));
        assert_eq!(recording.audio.len(), 320);
        let state = &app.health.lock().unwrap().channels[0];
        assert!(!state.active);
        assert_eq!(state.active_since_ms, None);
        assert_eq!(state.active_until_ms, None);
    }

    #[test]
    fn distinguish_eof_and_partial_frames() {
        assert!(read_frame(&mut b"".as_slice()).unwrap().is_none());
        assert!(read_frame(&mut b"A16F".as_slice()).is_err());
        let mut h = b"A16F".to_vec();
        h.extend(0u16.to_le_bytes());
        h.extend(u32::MAX.to_le_bytes());
        h.extend(0u64.to_le_bytes());
        assert!(read_frame(&mut h.as_slice()).is_err());
    }
}
