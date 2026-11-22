//! Segment 16 kHz demodulated audio in ten-millisecond windows, independently of transport framing.
use serde::Deserialize;
use std::collections::VecDeque;

pub const RATE: usize = 16_000;
const WINDOW: usize = RATE / 100;

#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub activity_threshold: f32,
    pub pre_roll_sec: f32,
    pub min_duration_sec: f32,
    pub hang_sec: f32,
    pub max_duration_sec: f32,
    pub warmup_sec: f32,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            activity_threshold: 0.0025,
            pre_roll_sec: 0.75,
            min_duration_sec: 0.35,
            hang_sec: 0.8,
            max_duration_sec: 45.0,
            warmup_sec: 2.0,
        }
    }
}
impl Settings {
    pub fn valid(&self) -> bool {
        (0.0..=1.0).contains(&self.activity_threshold)
            && self.activity_threshold > 0.0
            && (0.0..=5.0).contains(&self.pre_roll_sec)
            && (0.01..=10.0).contains(&self.min_duration_sec)
            && (0.01..=10.0).contains(&self.hang_sec)
            && (self.min_duration_sec + self.pre_roll_sec..=300.0).contains(&self.max_duration_sec)
            && (0.0..=30.0).contains(&self.warmup_sec)
    }
}
pub struct Segment {
    pub start: u64,
    pub audio: Vec<i16>,
}
struct Candidate {
    clip: Segment,
    voiced: usize,
    tail: usize,
}
pub struct Detector {
    settings: Settings,
    pending: Vec<i16>,
    offset: u64,
    history: VecDeque<i16>,
    current: Option<Candidate>,
    pub level: f32,
}
fn count(seconds: f32) -> usize {
    (seconds * RATE as f32).round() as usize
}

impl Detector {
    pub fn new(settings: Settings) -> Self {
        Self {
            settings,
            pending: Vec::with_capacity(WINDOW),
            offset: 0,
            history: VecDeque::new(),
            current: None,
            level: 0.0,
        }
    }
    pub fn active(&self) -> bool {
        self.current.is_some()
    }
    /// Sample range of the open recording once it qualifies for archiving.
    pub fn recording_interval(&self) -> Option<std::ops::Range<u64>> {
        let candidate = self.current.as_ref()?;
        if candidate.voiced < count(self.settings.min_duration_sec) {
            return None;
        }
        let clip = &candidate.clip;
        Some(clip.start..clip.start + clip.audio.len() as u64)
    }
    pub fn feed(&mut self, first: u64, mut samples: &[i16]) -> Vec<Segment> {
        let mut clips = Vec::new();
        let mut next = first;
        if !self.pending.is_empty() && self.offset + self.pending.len() as u64 != first {
            self.pending.clear();
        }
        while !samples.is_empty() {
            if self.pending.is_empty() {
                self.offset = next;
            }
            let n = samples.len().min(WINDOW - self.pending.len());
            self.pending.extend_from_slice(&samples[..n]);
            next += n as u64;
            samples = &samples[n..];
            if self.pending.len() == WINDOW {
                if let Some(clip) = self.process_window() {
                    clips.push(clip);
                }
                self.pending.clear();
            }
        }
        clips
    }
    fn process_window(&mut self) -> Option<Segment> {
        let n = self.pending.len();
        let energy: f64 = self
            .pending
            .iter()
            .map(|&v| (v as f64 / 32768.0).powi(2))
            .sum();
        self.level = (energy / n as f64).sqrt() as f32;
        if self.offset < count(self.settings.warmup_sec) as u64 {
            return None;
        }
        let voiced = self.level >= self.settings.activity_threshold;
        if voiced && self.current.is_none() {
            let start = self.offset.saturating_sub(self.history.len() as u64);
            self.current = Some(Candidate {
                clip: Segment {
                    start,
                    audio: self.history.drain(..).collect(),
                },
                voiced: 0,
                tail: 0,
            });
        }
        if let Some(candidate) = self.current.as_mut() {
            candidate.clip.audio.extend_from_slice(&self.pending);
            if voiced {
                candidate.voiced += n;
                candidate.tail = 0;
            } else {
                candidate.tail += n;
            }
            if candidate.tail >= count(self.settings.hang_sec)
                || candidate.clip.audio.len() >= count(self.settings.max_duration_sec)
            {
                return self.finish_candidate();
            }
        } else {
            self.history.extend(&self.pending);
            let excess = self
                .history
                .len()
                .saturating_sub(count(self.settings.pre_roll_sec));
            self.history.drain(..excess);
        }
        None
    }
    fn finish_candidate(&mut self) -> Option<Segment> {
        let candidate = self.current.take()?;
        (candidate.voiced >= count(self.settings.min_duration_sec)).then_some(candidate.clip)
    }
    pub fn flush(&mut self) -> Option<Segment> {
        let result = if self.pending.is_empty() {
            None
        } else {
            self.process_window()
        };
        self.pending.clear();
        self.history.clear();
        result.or_else(|| self.finish_candidate())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_interval_tracks_only_confirmed_recordings_and_matches_the_saved_clip() {
        let mut detector = Detector::new(Settings {
            warmup_sec: 0.0,
            min_duration_sec: 0.03,
            pre_roll_sec: 0.02,
            hang_sec: 0.02,
            ..Settings::default()
        });
        let quiet = [0; 3 * WINDOW];
        detector.feed(0, &quiet);
        let mut offset = quiet.len() as u64;
        for _ in 0..2 {
            detector.feed(offset, &[4096; WINDOW]);
            offset += WINDOW as u64;
            assert!(detector.active());
            assert_eq!(detector.recording_interval(), None);
        }
        detector.feed(offset, &[4096; WINDOW]);
        offset += WINDOW as u64;
        let start = WINDOW as u64;
        assert_eq!(detector.recording_interval(), Some(start..offset));
        detector.feed(offset, &[0; WINDOW]);
        offset += WINDOW as u64;
        assert_eq!(detector.recording_interval(), Some(start..offset));
        let recording = detector.flush().unwrap();
        assert_eq!(recording.start, start);
        assert_eq!(recording.audio.len() as u64, offset - start);
        assert_eq!(detector.recording_interval(), None);
    }
    #[test]
    fn pre_roll_and_tail_do_not_turn_a_click_into_a_call() {
        let mut detector = Detector::new(Settings::default());
        let mut samples = vec![0; 5 * RATE];
        samples[3 * RATE] = i16::MAX;
        assert!(detector.feed(0, &samples).is_empty());
        assert!(detector.flush().is_none());
    }
    #[test]
    fn callback_boundaries_preserve_pre_roll_and_timestamp() {
        let mut samples = vec![0; 6 * RATE];
        samples[3 * RATE..4 * RATE].fill(4096);
        let mut detector = Detector::new(Settings::default());
        let mut clips = Vec::new();
        for (index, chunk) in samples.chunks(237).enumerate() {
            clips.extend(detector.feed((index * 237) as u64, chunk));
        }
        assert_eq!(clips.len(), 1);
        let clip = &clips[0];
        assert_eq!(clip.start, (3 * RATE - 12_000) as u64);
        assert_eq!(clip.audio[12_000], 4096);
        assert_eq!(clip.audio.len(), 12_000 + RATE + 12_800);
    }
}
