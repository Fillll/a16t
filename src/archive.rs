mod media;
mod speech;

use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use std::{
    fs::{self, File},
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

use speech::Speech;

#[derive(Clone)]
pub struct Archive(Arc<Inner>);

struct Inner {
    db: Mutex<Connection>,
    dir: PathBuf,
    keep_wav: bool,
    budget: u64,
    speech: Speech,
    worker: Mutex<()>,
    _lock: ArchiveLock,
}

struct ArchiveLock(File);

impl Drop for ArchiveLock {
    fn drop(&mut self) {
        // A concurrently spawned helper can briefly inherit the open file description
        // between fork and exec. Release its advisory lock explicitly at shutdown.
        let _ = self.0.unlock();
    }
}

#[derive(Debug, Serialize)]
pub struct Clip {
    pub id: i64,
    pub session_id: i64,
    pub profile: String,
    pub source: String,
    pub channel: String,
    pub frequency_hz: u64,
    pub start_ms: i64,
    pub duration_ms: u64,
    pub status: String,
    pub provider: String,
    pub transcription_status: String,
    pub transcript: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Transmission {
    pub id: i64,
    pub channel: String,
    pub frequency_hz: u64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub status: String,
    #[serde(skip)]
    pub transcript: Option<String>,
    #[serde(skip)]
    pub transcription_status: String,
}

const TRANSMISSION_COLUMNS: &str = "c.id, c.channel, c.frequency_hz, c.start_ms,
    c.start_ms + (c.samples + 15) / 16 AS end_ms, c.status,
    CASE WHEN c.transcription_status = 'complete' THEN c.transcript END, c.transcription_status";
const TRANSMISSION_FILTER: &str = "c.samples > 0 AND c.status NOT IN ('recording', 'incomplete')";
const CHANNEL_HISTORY_WINDOW_RADIUS: usize = 12;

impl Transmission {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            channel: row.get(1)?,
            frequency_hz: row.get(2)?,
            start_ms: row.get(3)?,
            end_ms: row.get(4)?,
            status: row.get(5)?,
            transcript: row.get(6)?,
            transcription_status: row.get(7)?,
        })
    }
}

pub struct ChannelHistory {
    pub recording: Transmission,
    pub previous_id: Option<i64>,
    pub next_id: Option<i64>,
    pub window: Option<ChannelHistoryWindow>,
}

pub struct ChannelHistoryWindow {
    pub items: Vec<Transmission>,
    pub older_id: Option<i64>,
    pub newer_id: Option<i64>,
}

impl Archive {
    pub fn open(root: PathBuf, keep_wav: bool, budget_bytes: u64) -> Result<Self> {
        let speech = Speech::from_env()?;
        Self::open_with(root, keep_wav, budget_bytes, speech)
    }

    fn open_with(root: PathBuf, keep_wav: bool, budget: u64, speech: Speech) -> Result<Self> {
        let mut directories = fs::DirBuilder::new();
        directories.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directories.mode(0o700);
        }
        directories
            .create(&root)
            .context("create archive directory")?;
        let root = root.canonicalize()?;
        let lock = File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(root.join("archive.lock"))?;
        lock.try_lock()
            .context("lock archive (another A16T process may already be using it)")?;
        let dir = root.join("clips");
        directories.create(&dir)?;
        let db_path = root.join("archive.sqlite3");
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            File::options()
                .create(true)
                .write(true)
                .truncate(false)
                .mode(0o600)
                .open(&db_path)?;
        }
        let db = Connection::open(db_path)?;
        db.execute_batch(
            "
            PRAGMA foreign_keys=ON;
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS sessions(
                id INTEGER PRIMARY KEY, profile TEXT NOT NULL, source TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS clips(
                id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id),
                channel TEXT NOT NULL, frequency_hz INTEGER NOT NULL, start_ms INTEGER NOT NULL,
                samples INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'recording',
                keep_wav INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
                transcription_status TEXT NOT NULL, transcript TEXT, error TEXT,
                retained_bytes INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS clips_time ON clips(start_ms DESC, id DESC);
            CREATE INDEX IF NOT EXISTS clips_end_time ON clips(start_ms + (samples + 15) / 16);
            CREATE INDEX IF NOT EXISTS clips_status ON clips(status, id);
            CREATE INDEX IF NOT EXISTS clips_channel_time ON clips(channel, frequency_hz, start_ms, id)
                WHERE samples > 0 AND status NOT IN ('recording', 'incomplete');
        ",
        )?;
        let store = Self(Arc::new(Inner {
            db: Mutex::new(db),
            dir,
            keep_wav,
            budget,
            speech,
            worker: Mutex::new(()),
            _lock: ArchiveLock(lock),
        }));
        store.recover()?;
        store.prune()?;
        Ok(store)
    }

    fn db(&self) -> Result<MutexGuard<'_, Connection>> {
        self.0
            .db
            .lock()
            .map_err(|_| anyhow::anyhow!("archive database lock poisoned"))
    }

    fn file(&self, id: i64, extension: &str) -> PathBuf {
        self.0.dir.join(format!("{id}.{extension}"))
    }

    pub fn start_session(&self, profile: &str, source: &str) -> Result<i64> {
        let db = self.db()?;
        db.execute(
            "INSERT INTO sessions(profile,source) VALUES(?1,?2)",
            (profile, source),
        )?;
        Ok(db.last_insert_rowid())
    }

    pub fn save(
        &self,
        session: i64,
        channel: &str,
        frequency_hz: u64,
        start_ms: i64,
        samples: &[i16],
    ) -> Result<i64> {
        ensure!(!samples.is_empty(), "cannot save an empty clip");
        let id = {
            let db = self.db()?;
            let speech = &self.0.speech;
            db.execute("INSERT INTO clips(session_id,channel,frequency_hz,start_ms,samples,keep_wav,provider,model,transcription_status)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![session,channel,frequency_hz,start_ms,samples.len(),self.0.keep_wav,speech.provider,speech.model,
                    if speech.provider == "none" { "disabled" } else { "pending" }])?;
            db.last_insert_rowid()
        };
        let part = self.file(id, "wav.part");
        let wav = self.file(id, "wav");
        if let Err(error) = media::write_wav(&part, samples) {
            self.db()?.execute(
                "UPDATE clips SET status='incomplete',error='WAV write failed' WHERE id=?1",
                [id],
            )?;
            media::remove(&part)?;
            return Err(error.context("write clip WAV"));
        }
        // A completed temporary file can be recovered even if rename or directory sync fails.
        media::publish(&part, &wav)?;
        self.db()?
            .execute("UPDATE clips SET status='queued' WHERE id=?1", [id])?;
        Ok(id)
    }

    fn recover(&self) -> Result<()> {
        let recording = {
            let db = self.db()?;
            let mut stmt = db.prepare("SELECT id,samples FROM clips WHERE status='recording'")?;
            stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, u64>(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (id, count) in recording {
            let wav = self.file(id, "wav");
            let part = self.file(id, "wav.part");
            if !wav.exists() && media::complete_wav(&part, count)? {
                media::publish(&part, &wav)?;
            }
            let (status, error) = if media::complete_wav(&wav, count)? {
                ("queued", None)
            } else {
                media::remove(&part)?;
                media::remove(&wav)?;
                (
                    "incomplete",
                    Some("Recording was interrupted before the complete WAV reached disk"),
                )
            };
            self.db()?.execute(
                "UPDATE clips SET status=?2,error=?3 WHERE id=?1",
                (id, status, error),
            )?;
        }
        let db = self.db()?;
        db.execute("UPDATE clips SET transcription_status='uncertain',error='Cloud request interrupted; completion unknown' WHERE transcription_status='sending'", [])?;
        db.execute("UPDATE clips SET transcription_status='pending',status='queued',error=NULL WHERE transcription_status='paused' AND provider=?1 AND status='ready'", [&self.0.speech.provider])?;
        // Encoding is local and can be replayed. A completed or uncertain cloud request stays untouched.
        db.execute("UPDATE clips SET status='queued' WHERE status='failed'", [])?;
        drop(db);
        for id in self.ids("SELECT id FROM clips WHERE status='expiring'")? {
            self.expire(id)?;
        }
        for id in self.ids("SELECT id FROM clips WHERE status='ready' AND keep_wav=0 AND transcription_status IN ('disabled','complete')")? {
            media::remove(&self.file(id,"wav"))?;
        }
        Ok(())
    }

    fn ids(&self, sql: &str) -> Result<Vec<i64>> {
        let db = self.db()?;
        let mut stmt = db.prepare(sql)?;
        Ok(stmt
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub fn process_pending(&self) -> Result<()> {
        let _worker = self
            .0
            .worker
            .lock()
            .map_err(|_| anyhow::anyhow!("archive worker lock poisoned"))?;
        // Snapshot the backlog so shutdown drains every already-saved clip.
        for id in self.ids("SELECT id FROM clips WHERE status='queued' ORDER BY id")? {
            self.process_one(id)?;
            self.prune()?;
        }
        Ok(())
    }

    fn process_one(&self, id: i64) -> Result<()> {
        let wav = self.file(id, "wav");
        let opus = self.file(id, "opus");
        let (provider, model, state, keep_wav): (String, String, String, bool) =
            self.db()?.query_row(
                "SELECT provider,model,transcription_status,keep_wav FROM clips WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;
        let state = if state == "pending" {
            self.transcribe(id, &provider, &model)?
        } else {
            state
        };
        if !opus.is_file() {
            let part = self.file(id, "opus.part");
            if let Err(error) =
                media::encode(&wav, &part).and_then(|()| media::publish(&part, &opus))
            {
                media::remove(&part)?;
                let size = media::size(&wav)?;
                self.db()?.execute(
                    "UPDATE clips SET status='failed',error=?2,retained_bytes=?3 WHERE id=?1",
                    (id, format!("{error:#}"), size),
                )?;
                return Ok(());
            }
        }
        let remove_wav = !keep_wav && matches!(state.as_str(), "complete" | "disabled");
        let bytes = media::size(&opus)? + if remove_wav { 0 } else { media::size(&wav)? };
        self.db()?.execute(
            "UPDATE clips SET status='ready',retained_bytes=?2,
             error=CASE WHEN transcription_status IN ('complete','disabled') THEN NULL ELSE error END
             WHERE id=?1",
            (id, bytes),
        )?;
        if remove_wav {
            media::remove(&wav)?;
        }
        Ok(())
    }

    fn transcribe(&self, id: i64, provider: &str, model: &str) -> Result<String> {
        let wav = self.file(id, "wav");
        let (state, result, error) = if provider != self.0.speech.provider {
            (
                "paused",
                None,
                Some("Enable the original provider to resume this job".into()),
            )
        } else if provider == "local" {
            match self.0.speech.local(&wav, model) {
                Ok(text) => ("complete", Some(text), None),
                Err(e) => ("failed", None, Some(format!("{e:#}"))),
            }
        } else {
            match self.0.speech.cloud_request(&wav, model) {
                Err(e) => ("failed", None, Some(format!("{e:#}"))),
                Ok(request) => {
                    self.db()?.execute(
                        "UPDATE clips SET transcription_status='sending' WHERE id=?1",
                        [id],
                    )?;
                    match request.send() {
                        Ok(text) => ("complete", Some(text), None),
                        Err(e) => ("uncertain", None, Some(format!("{e:#}"))),
                    }
                }
            }
        };
        self.db()?.execute(
            "UPDATE clips SET transcription_status=?2,transcript=?3,error=?4 WHERE id=?1",
            params![id, state, result, error],
        )?;
        Ok(state.to_owned())
    }

    fn prune(&self) -> Result<()> {
        let mut bytes: u64 = self.db()?.query_row(
            "SELECT COALESCE(SUM(retained_bytes),0) FROM clips WHERE status IN ('ready','failed')",
            [],
            |r| r.get(0),
        )?;
        if bytes <= self.0.budget {
            return Ok(());
        }
        for id in self
            .ids("SELECT id FROM clips WHERE status IN ('ready','failed') ORDER BY start_ms,id")?
        {
            let size: u64 = self.db()?.query_row(
                "SELECT retained_bytes FROM clips WHERE id=?1",
                [id],
                |r| r.get(0),
            )?;
            self.db()?
                .execute("UPDATE clips SET status='expiring' WHERE id=?1", [id])?;
            self.expire(id)?;
            bytes = bytes.saturating_sub(size);
            if bytes <= self.0.budget {
                break;
            }
        }
        Ok(())
    }

    fn expire(&self, id: i64) -> Result<()> {
        for extension in ["wav", "opus", "wav.part", "opus.part", "transcript.txt"] {
            media::remove(&self.file(id, extension))?;
        }
        self.db()?.execute(
            "UPDATE clips SET status='expired',retained_bytes=0 WHERE id=?1",
            [id],
        )?;
        Ok(())
    }

    pub fn recent(&self) -> Result<Vec<Clip>> {
        let db = self.db()?;
        let mut stmt = db.prepare("SELECT c.id,s.id,s.profile,s.source,c.channel,c.frequency_hz,c.start_ms,c.samples,
            c.status,c.provider,c.transcription_status,c.transcript,c.error
            FROM clips c JOIN sessions s ON c.session_id=s.id ORDER BY c.start_ms DESC,c.id DESC LIMIT 200")?;
        Ok(stmt
            .query_map([], |r| {
                Ok(Clip {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    profile: r.get(2)?,
                    source: r.get(3)?,
                    channel: r.get(4)?,
                    frequency_hz: r.get(5)?,
                    start_ms: r.get(6)?,
                    duration_ms: r.get::<_, u64>(7)? * 1000 / 16_000,
                    status: r.get(8)?,
                    provider: r.get(9)?,
                    transcription_status: r.get(10)?,
                    transcript: r.get(11)?,
                    error: r.get(12)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    /// Captures from this source intersecting [start_ms, end_ms), including expired audio.
    pub fn transmissions(
        &self,
        source: &str,
        start_ms: i64,
        end_ms: i64,
    ) -> Result<Vec<Transmission>> {
        if start_ms >= end_ms {
            return Ok(Vec::new());
        }
        let db = self.db()?;
        // 16 samples per millisecond. Round the exclusive endpoint up for a partial millisecond.
        // Ordering by this indexed endpoint also skips old clips in long-running archives.
        let mut stmt = db.prepare(&format!(
            "SELECT {TRANSMISSION_COLUMNS}
             FROM clips c JOIN sessions s ON s.id = c.session_id
             WHERE end_ms > ?2 AND c.start_ms < ?3 AND s.source = ?1
               AND {TRANSMISSION_FILTER}
             ORDER BY end_ms, c.id",
        ))?;
        Ok(stmt
            .query_map((source, start_ms, end_ms), Transmission::from_row)?
            .collect::<rusqlite::Result<_>>()?)
    }

    /// The oldest archived mark on any configured channel and frequency of this source.
    pub fn earliest_transmission<'a>(
        &self,
        source: &str,
        channels: impl IntoIterator<Item = (&'a str, u64)>,
    ) -> Result<Option<i64>> {
        let db = self.db()?;
        let mut stmt = db.prepare_cached(&format!(
            "SELECT c.start_ms FROM clips c JOIN sessions s ON s.id = c.session_id
             WHERE c.channel = ?1 AND c.frequency_hz = ?2 AND s.source = ?3
               AND {TRANSMISSION_FILTER}
             ORDER BY c.start_ms LIMIT 1"
        ))?;
        let mut earliest: Option<i64> = None;
        for (channel, frequency_hz) in channels {
            if let Some(start_ms) = stmt
                .query_row((channel, frequency_hz, source), |row| row.get(0))
                .optional()?
            {
                earliest = Some(earliest.map_or(start_ms, |time| time.min(start_ms)));
            }
        }
        Ok(earliest)
    }

    /// Read a selected or latest transmission, and its immediate chronological neighbors.
    pub fn channel_history(
        &self,
        source: &str,
        channel: &str,
        frequency_hz: u64,
        id: Option<i64>,
    ) -> Result<Option<ChannelHistory>> {
        self.read_channel_history(source, channel, frequency_hz, id, false)
    }

    /// Include a bounded window and continuation IDs around the selected transmission.
    pub fn channel_history_window(
        &self,
        source: &str,
        channel: &str,
        frequency_hz: u64,
        id: Option<i64>,
    ) -> Result<Option<ChannelHistory>> {
        self.read_channel_history(source, channel, frequency_hz, id, true)
    }

    fn read_channel_history(
        &self,
        source: &str,
        channel: &str,
        frequency_hz: u64,
        id: Option<i64>,
        include_window: bool,
    ) -> Result<Option<ChannelHistory>> {
        let db = self.db()?;
        let scope = format!(
            "FROM clips c JOIN sessions s ON s.id = c.session_id
             WHERE c.channel = ?1 AND c.frequency_hz = ?2 AND s.source = ?3
               AND {TRANSMISSION_FILTER}"
        );
        let recording = match id {
            Some(id) => db.query_row(
                &format!("SELECT {TRANSMISSION_COLUMNS} {scope} AND c.id = ?4"),
                (channel, frequency_hz, source, id),
                Transmission::from_row,
            ),
            None => db.query_row(
                &format!(
                    "SELECT {TRANSMISSION_COLUMNS} {scope}
                     ORDER BY c.start_ms DESC, c.id DESC LIMIT 1"
                ),
                (channel, frequency_hz, source),
                Transmission::from_row,
            ),
        }
        .optional()?;
        let Some(recording) = recording else {
            return Ok(None);
        };

        let neighbor_sql = |columns, comparison, order| {
            format!(
                "SELECT {columns} {scope} AND (c.start_ms, c.id) {comparison} (?4, ?5)
                 ORDER BY c.start_ms {order}, c.id {order} LIMIT ?6"
            )
        };
        let neighbor_params = |limit| {
            (
                channel,
                frequency_hz,
                source,
                recording.start_ms,
                recording.id,
                limit,
            )
        };
        let (previous_id, next_id, window) = if include_window {
            let page = |comparison, order| -> Result<Vec<Transmission>> {
                let mut stmt =
                    db.prepare(&neighbor_sql(TRANSMISSION_COLUMNS, comparison, order))?;
                Ok(stmt
                    .query_map(
                        neighbor_params(CHANNEL_HISTORY_WINDOW_RADIUS + 1),
                        Transmission::from_row,
                    )?
                    .collect::<rusqlite::Result<_>>()?)
            };
            let mut older = page("<", "DESC")?;
            let mut newer = page(">", "ASC")?;
            let previous_id = older.first().map(|item| item.id);
            let next_id = newer.first().map(|item| item.id);
            // Request one extra row on each side so clients can scroll past this page.
            let older_id = older.get(CHANNEL_HISTORY_WINDOW_RADIUS).map(|item| item.id);
            let newer_id = newer.get(CHANNEL_HISTORY_WINDOW_RADIUS).map(|item| item.id);
            older.truncate(CHANNEL_HISTORY_WINDOW_RADIUS);
            newer.truncate(CHANNEL_HISTORY_WINDOW_RADIUS);
            older.reverse();
            older.push(recording.clone());
            older.extend(newer);
            (
                previous_id,
                next_id,
                Some(ChannelHistoryWindow {
                    items: older,
                    older_id,
                    newer_id,
                }),
            )
        } else {
            let neighbor = |comparison, order| {
                db.query_row(
                    &neighbor_sql("c.id", comparison, order),
                    neighbor_params(1),
                    |row| row.get(0),
                )
                .optional()
            };
            (neighbor("<", "DESC")?, neighbor(">", "ASC")?, None)
        };
        Ok(Some(ChannelHistory {
            recording,
            previous_id,
            next_id,
            window,
        }))
    }

    /// Summarize permanent failures after this session's archive queue has drained.
    pub fn session_failure(&self, session: i64) -> Result<Option<String>> {
        Ok(self
            .db()?
            .query_row(
                "SELECT id, COALESCE(error, status), COUNT(*) OVER() FROM clips
             WHERE session_id=?1 AND (
                status IN ('incomplete','failed') OR transcription_status IN ('failed','uncertain')
                OR (status='expired' AND error IS NOT NULL AND transcription_status!='paused')
             ) ORDER BY id LIMIT 1",
                [session],
                |row| {
                    let id: i64 = row.get(0)?;
                    let error: String = row.get(1)?;
                    let count: u64 = row.get(2)?;
                    Ok(format!(
                        "{count} recording job(s) failed; clip {id}: {error}"
                    ))
                },
            )
            .optional()?)
    }

    pub fn audio(&self, id: i64) -> Result<Option<(PathBuf, &'static str)>> {
        let exists = self
            .db()?
            .query_row(
                "SELECT 1 FROM clips WHERE id=?1 AND status IN ('queued','ready','failed')",
                [id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if exists {
            for (ext, mime) in [("opus", "audio/ogg"), ("wav", "audio/wav")] {
                let path = self.file(id, ext);
                if path.is_file() {
                    return Ok(Some((path, mime)));
                }
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests;
