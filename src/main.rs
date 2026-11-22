mod monitor;
mod web;

use a16t::archive::Archive;
use anyhow::{Context, Result, bail, ensure};
use clap::{Parser, ValueEnum};
use monitor::{App, Profile, Recording};
use std::{
    io::BufReader,
    net::SocketAddr,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq)]
enum Mode {
    Replay,
    Live,
    Iq,
}
impl Mode {
    fn name(self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Replay => "replay",
            Self::Iq => "iq",
        }
    }
}
#[derive(Parser)]
#[command(version, about = "A16T receive-only radio watchboard")]
struct Args {
    /// Receiver input. Replay works with standard Python and no dongle.
    #[arg(long, value_enum, default_value = "replay")]
    mode: Mode,
    /// Profile JSON file.
    #[arg(long, default_value = "profiles/eastbay-marine.json")]
    profile: PathBuf,
    #[arg(long)]
    iq_file: Option<PathBuf>,
    /// GNU Radio interpreter for live and IQ. Replay supports plain Python 3.
    #[arg(long, default_value = "python3")]
    python: PathBuf,
    #[arg(long, default_value = "receiver/receiver.py")]
    receiver: PathBuf,
    #[arg(long, default_value = "runtime_data")]
    data_dir: PathBuf,
    #[arg(long, default_value = "127.0.0.1:8787")]
    bind: SocketAddr,
    /// Finish after receiver EOF and drain the archive without opening a web port.
    #[arg(long)]
    once: bool,
    /// Stop live input after this many seconds of radio samples.
    #[arg(long)]
    duration: Option<f64>,
    #[arg(long, allow_hyphen_values = true)]
    squelch_db: Option<f64>,
    #[arg(long, allow_hyphen_values = true)]
    gain_db: Option<f64>,
    /// Override profile audio RMS threshold (0 < value <= 1).
    #[arg(long)]
    threshold: Option<f32>,
    /// Retain original PCM WAV alongside Opus.
    #[arg(long)]
    keep_wav: bool,
    /// Maximum total retained audio bytes in MiB; pending jobs are protected.
    #[arg(long, default_value_t = 512)]
    budget_mib: u64,
}
fn receiver_command(args: &Args) -> Command {
    let mut cmd = Command::new(&args.python);
    cmd.arg(&args.receiver)
        .args(["--mode", args.mode.name(), "--profile"])
        .arg(&args.profile)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Some(file) = &args.iq_file {
        cmd.arg("--iq-file").arg(file);
    }
    for (key, value) in [
        ("--duration", args.duration),
        ("--gain-db", args.gain_db),
        ("--squelch-db", args.squelch_db),
    ] {
        if let Some(v) = value {
            cmd.arg(key).arg(v.to_string());
        }
    }
    if args.once && args.mode == Mode::Replay {
        cmd.arg("--fast");
    }
    cmd
}
async fn interrupt() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => (), _ = term.recv() => () }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        (args.mode == Mode::Iq) == args.iq_file.is_some(),
        "supply --iq-file only with --mode iq"
    );
    ensure!(
        args.duration
            .is_none_or(|v| args.mode == Mode::Live && v.is_finite() && v > 0.0),
        "--duration requires live mode and a positive finite duration"
    );
    let mut profile: Profile =
        serde_json::from_slice(&std::fs::read(&args.profile).context("read profile")?)?;
    if let Some(v) = args.threshold {
        profile.detection.activity_threshold = v;
    }
    ensure!(profile.detection.valid(), "invalid detector settings");
    ensure!(
        !profile.channels.is_empty() && profile.channels.len() <= u16::MAX as usize,
        "profile must have 1 to 65535 channels"
    );
    let budget = args
        .budget_mib
        .checked_mul(1024 * 1024)
        .context("invalid disk budget")?;
    let listener = if args.once {
        None
    } else {
        Some(
            tokio::net::TcpListener::bind(args.bind)
                .await
                .context("bind Watchboard")?,
        )
    };
    let archive = Archive::open(args.data_dir.clone(), args.keep_wav, budget)?;
    let session = archive.start_session(&profile.id, args.mode.name())?;
    let app = App::new(&profile, args.mode.name().into(), archive.clone());
    let mut child = receiver_command(&args)
        .spawn()
        .context("launch Python receiver")?;
    let pipe = child.stdout.take().context("open receiver pipe")?;
    let child = Arc::new(Mutex::new(child));
    let (tx, rx) = mpsc::sync_channel::<Recording>(32);
    let writer_app = app.clone();
    let writer = thread::spawn(move || {
        let mut errors = 0usize;
        for rec in rx {
            if let Err(e) = writer_app.archive.save(
                session,
                &rec.channel,
                rec.frequency_hz,
                rec.start_ms,
                &rec.audio,
            ) {
                errors += 1;
                eprintln!("Recording failed: {e:#}");
                writer_app.health.lock().unwrap().archive_error =
                    Some(format!("Recording failed: {e}"));
            }
        }
        errors
    });
    let done = Arc::new(AtomicBool::new(false));
    let done_worker = done.clone();
    let worker_app = app.clone();
    let worker = thread::spawn(move || -> Result<()> {
        while !done_worker.load(Ordering::Acquire) {
            if let Err(e) = worker_app.archive.process_pending() {
                eprintln!("Archive worker: {e:#}");
                worker_app.health.lock().unwrap().archive_error =
                    Some(format!("Archive worker: {e}"));
            }
            thread::sleep(Duration::from_millis(200));
        }
        worker_app.archive.process_pending()
    });
    let reader_app = app.clone();
    let receiver_child = child.clone();
    let mut reader = tokio::task::spawn_blocking(move || -> Result<()> {
        let result = monitor::receive(&mut BufReader::new(pipe), &profile, &reader_app, tx);
        let mut handle = receiver_child.lock().unwrap();
        if result.is_err() {
            let _ = handle.kill();
        }
        let exit = handle.wait()?;
        drop(handle);
        let result = result.and_then(|()| {
            if exit.success() {
                Ok(())
            } else {
                Err(anyhow::anyhow!("receiver exited with {exit}"))
            }
        });
        let status = match &result {
            Ok(_) => "finished".to_string(),
            Err(e) => format!("receiver error: {e}"),
        };
        eprintln!("{status}");
        reader_app.receiver_status(&status);
        result
    });
    let mut checked = false;
    let mut stopping = false;
    let mut reader_error = None;
    if let Some(listener) = listener {
        eprintln!("Watchboard http://{}", listener.local_addr()?);
        let server_app = app.clone();
        let server = axum::serve(listener, web::router(server_app)).into_future();
        tokio::pin!(server);
        tokio::select! {
            result = &mut server => { reader_error = result.err().map(anyhow::Error::from); }
            _ = interrupt() => {}
        }
        stopping = true;
    } else {
        tokio::select! {
            result = &mut reader => { checked = true; reader_error = result?.err(); }
            _ = interrupt() => { stopping = true; }
        }
    }
    if stopping {
        let mut handle = child.lock().unwrap();
        if handle.try_wait()?.is_none() {
            let _ = handle.kill();
        }
    }
    if !checked {
        let result = reader.await?;
        if !stopping {
            result?;
        }
    }
    let write_errors = writer
        .join()
        .map_err(|_| anyhow::anyhow!("recording writer panicked"))?;
    done.store(true, Ordering::Release);
    worker
        .join()
        .map_err(|_| anyhow::anyhow!("archive worker panicked"))??;
    if let Some(e) = reader_error {
        return Err(e);
    }
    if write_errors > 0 || app.health.lock().unwrap().dropped_clips > 0 {
        bail!("one or more recordings could not be archived");
    }
    if let Some(failure) = archive.session_failure(session)? {
        bail!("{failure}");
    }
    Ok(())
}
