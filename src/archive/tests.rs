use super::*;
use tempfile::TempDir;

fn store(root: &TempDir, budget: u64) -> Archive {
    Archive::open_with(
        root.path().to_owned(),
        false,
        budget,
        Speech {
            provider: "none".into(),
            model: String::new(),
            whisper_bin: "whisper-cli".into(),
        },
    )
    .unwrap()
}

#[test]
fn timeline_intersects_the_requested_window_across_sessions_of_one_source() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let old = archive.start_session("four", "live")?;
    let current = archive.start_session("forty-eight", "live")?;
    let replay = archive.start_session("forty-eight", "replay")?;
    archive.save(old, "one", 100, 900, &[0; 1600])?; // ends exactly at the left edge
    let crossing = archive.save(old, "one", 100, 900, &[0; 1601])?;
    let at_start = archive.save(current, "two", 200, 1000, &[0; 16])?;
    let at_end = archive.save(current, "three", 300, 1999, &[0; 32])?;
    archive.save(current, "three", 300, 2000, &[0; 16])?;
    archive.save(replay, "two", 200, 1000, &[0; 16])?;
    let partial = archive.save(current, "two", 200, 1200, &[0; 100])?;
    let writing = archive.save(current, "two", 200, 1300, &[0; 100])?;
    archive.expire(crossing)?;
    archive.db()?.execute(
        "UPDATE clips SET status='incomplete' WHERE id=?1",
        [partial],
    )?;
    archive
        .db()?
        .execute("UPDATE clips SET status='recording' WHERE id=?1", [writing])?;
    let found = archive.transmissions("live", 1000, 2000)?;
    assert_eq!(
        found.iter().map(|r| r.id).collect::<Vec<_>>(),
        [crossing, at_start, at_end]
    );
    let first = &found[0];
    assert_eq!((first.start_ms, first.end_ms), (900, 1001));
    assert_eq!(
        (
            first.channel.as_str(),
            first.frequency_hz,
            first.status.as_str()
        ),
        ("one", 100, "expired")
    );
    assert_eq!(found[1].status, "queued");
    assert_eq!((found[2].start_ms, found[2].end_ms), (1999, 2001));
    assert!(archive.transmissions("live", 1000, 1000)?.is_empty());
    Ok(())
}

#[test]
fn busy_timelines_cover_more_than_the_recent_recording_list() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let session = archive.start_session("test", "live")?;
    archive.db()?.execute(
        "WITH RECURSIVE ticks(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ticks WHERE n < 250)
         INSERT INTO clips(session_id, channel, frequency_hz, start_ms, samples, status,
                           keep_wav, provider, model, transcription_status)
         SELECT ?1, 'one', 100, n, 16, 'expired', 0, 'none', '', 'disabled' FROM ticks",
        [session],
    )?;
    assert_eq!(archive.recent()?.len(), 200);
    assert_eq!(archive.transmissions("live", 0, 1000)?.len(), 250);
    Ok(())
}

#[test]
fn channel_history_crosses_hours_and_sessions_in_stable_capture_order() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let earlier_profile = archive.start_session("four", "live")?;
    let current = archive.start_session("forty-eight", "live")?;
    let replay = archive.start_session("forty-eight", "replay")?;
    let latest = archive.save(current, "one", 100, 9_000_000, &[0; 16])?;
    let first_tie = archive.save(earlier_profile, "one", 100, 8_000_000, &[0; 16])?;
    let old = archive.save(earlier_profile, "one", 100, 1_000, &[0; 1601])?;
    let second_tie = archive.save(current, "one", 100, 8_000_000, &[0; 16])?;
    let wrong_source = archive.save(replay, "one", 100, 10_000_000, &[0; 16])?;
    let wrong_frequency = archive.save(current, "one", 101, 9_000_001, &[0; 16])?;
    let wrong_channel = archive.save(current, "two", 100, 9_000_001, &[0; 16])?;
    let incomplete = archive.save(current, "one", 100, 8_500_000, &[0; 16])?;

    archive.expire(old)?;
    archive.db()?.execute(
        "UPDATE clips SET transcription_status='complete', transcript='Example full transcript' WHERE id=?1",
        [old],
    )?;
    archive.db()?.execute(
        "UPDATE clips SET status='incomplete' WHERE id=?1",
        [incomplete],
    )?;

    let selected = archive.channel_history("live", "one", 100, None)?.unwrap();
    assert_eq!(
        (
            selected.recording.id,
            selected.previous_id,
            selected.next_id
        ),
        (latest, Some(second_tie), None)
    );
    let selected = archive
        .channel_history("live", "one", 100, Some(second_tie))?
        .unwrap();
    assert_eq!(
        (selected.previous_id, selected.next_id),
        (Some(first_tie), Some(latest))
    );
    let selected = archive
        .channel_history("live", "one", 100, Some(first_tie))?
        .unwrap();
    assert_eq!(
        (selected.previous_id, selected.next_id),
        (Some(old), Some(second_tie))
    );
    let selected = archive
        .channel_history("live", "one", 100, Some(old))?
        .unwrap();
    assert_eq!(
        (selected.previous_id, selected.next_id),
        (None, Some(first_tie))
    );
    assert_eq!(selected.recording.status, "expired");
    assert_eq!(selected.recording.end_ms, 1101);
    assert_eq!(selected.recording.transcription_status, "complete");
    assert_eq!(
        selected.recording.transcript.as_deref(),
        Some("Example full transcript")
    );

    for id in [wrong_source, wrong_frequency, wrong_channel, incomplete] {
        assert!(
            archive
                .channel_history("live", "one", 100, Some(id))?
                .is_none()
        );
    }
    assert!(
        archive
            .channel_history("live", "three", 100, None)?
            .is_none()
    );
    Ok(())
}

#[test]
fn interruption_after_wav_write_recovers_one_playable_clip() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let session = archive.start_session("test-profile", "replay")?;
    let id = archive.save(session, "one", 100, 250, &[123; 16_000])?;
    let wav = archive.file(id, "wav");
    // Simulate a stop after the complete temporary file reaches disk and before publication.
    fs::rename(&wav, archive.file(id, "wav.part"))?;
    archive
        .db()?
        .execute("UPDATE clips SET status='recording' WHERE id=?1", [id])?;
    drop(archive);
    let archive = store(&root, u64::MAX);
    assert_eq!(archive.recent()?[0].status, "queued");
    assert_eq!(archive.audio(id)?.unwrap().1, "audio/wav");
    archive.process_pending()?;
    archive.process_pending()?;
    let clips = archive.recent()?;
    assert_eq!(clips.len(), 1);
    let clip = &clips[0];
    assert_eq!(
        (
            &clip.profile[..],
            &clip.source[..],
            clip.duration_ms,
            clip.session_id
        ),
        ("test-profile", "replay", 1000, session)
    );
    assert_eq!(clip.status, "ready");
    assert_eq!(clip.transcription_status, "disabled");
    assert!(!wav.exists());
    let (path, mime) = archive.audio(id)?.unwrap();
    assert_eq!(mime, "audio/ogg");
    assert!(fs::read(&path)?.windows(8).any(|s| s == b"OpusHead"));
    Ok(())
}

#[test]
fn truncated_recording_is_never_encoded_or_served() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let session = archive.start_session("test", "live")?;
    let id = archive.save(session, "one", 200, 500, &[200; 100])?;
    fs::write(archive.file(id, "wav"), b"broken")?;
    archive
        .db()?
        .execute("UPDATE clips SET status='recording' WHERE id=?1", [id])?;
    drop(archive);
    let archive = store(&root, u64::MAX);
    archive.process_pending()?;
    assert_eq!(archive.recent()?[0].status, "incomplete");
    assert!(archive.audio(id)?.is_none());
    Ok(())
}

#[test]
fn retention_expires_oldest_audio_and_keeps_history() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let session = archive.start_session("test", "live")?;
    let older = archive.save(session, "one", 200, 10, &[123; 8_000])?;
    let newer = archive.save(session, "one", 200, 20, &[123; 8_000])?;
    archive.process_pending()?;
    let budget = fs::metadata(archive.audio(newer)?.unwrap().0)?.len();
    drop(archive);
    let archive = store(&root, budget);
    assert!(archive.audio(older)?.is_none());
    assert!(archive.audio(newer)?.is_some());
    assert_eq!(archive.recent()?[1].status, "expired");
    Ok(())
}

#[test]
fn interrupted_cloud_request_is_never_resubmitted() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let session = archive.start_session("test", "live")?;
    let id = archive.save(session, "one", 200, 20, &[123; 8_000])?;
    archive.db()?.execute(
        "UPDATE clips SET provider='openai',transcription_status='sending' WHERE id=?1",
        [id],
    )?;
    drop(archive);
    let archive = store(&root, u64::MAX);
    archive.process_pending()?;
    let clip = &archive.recent()?[0];
    assert_eq!(clip.transcription_status, "uncertain");
    assert_eq!(clip.status, "ready");
    assert!(archive.file(id, "wav").is_file());
    Ok(())
}

#[cfg(unix)]
#[test]
fn local_transcription_gets_original_wav_before_archival() -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let root = TempDir::new()?;
    let fake_whisper = root.path().join("test-whisper");
    // This fixture checks the whisper-cli arguments and writes the documented text sidecar.
    fs::write(
        &fake_whisper,
        r#"#!/bin/sh
set -eu
while test "$#" -gt 0; do
    case "$1" in
        -f) shift; input="$1";;
        -of) shift; output="$1";;
    esac
    shift
done
test "$(head -c 4 "$input")" = RIFF
printf 'Synthetic test audio\n' > "$output.txt"
"#,
    )?;
    fs::set_permissions(&fake_whisper, fs::Permissions::from_mode(0o700))?;
    let archive = Archive::open_with(
        root.path().to_owned(),
        false,
        u64::MAX,
        Speech {
            provider: "local".into(),
            model: "synthetic-model".into(),
            whisper_bin: fake_whisper,
        },
    )?;
    let session = archive.start_session("test", "replay")?;
    let id = archive.save(session, "one", 200, 20, &[123; 8000])?;
    archive.process_pending()?;
    let clip = &archive.recent()?[0];
    assert_eq!(clip.transcript.as_deref(), Some("Synthetic test audio"));
    assert_eq!(clip.transcription_status, "complete");
    assert!(!archive.file(id, "wav").exists());
    assert!(!archive.file(id, "transcript.txt").exists());
    Ok(())
}

#[test]
fn archives_full_backlog_and_remembers_completed_submissions() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let session = archive.start_session("test", "replay")?;
    let seed = archive.save(session, "one", 200, 1, &[100; 640])?;
    archive.process_pending()?;
    let opus = archive.audio(seed)?.unwrap().0;
    for tick in 1..=33 {
        let id = archive.save(session, "one", 200, tick + 1, &[100; 640])?;
        // The request result and encoded file reached disk before the job was finalized.
        archive.db()?.execute("UPDATE clips SET provider='openai',transcription_status='complete',transcript='synthetic' WHERE id=?1",[id])?;
        fs::copy(&opus, archive.file(id, "opus"))?;
    }
    drop(archive);
    let archive = store(&root, u64::MAX);
    archive.process_pending()?;
    assert!(archive.recent()?.iter().all(|clip| clip.status == "ready"));
    assert_eq!(
        archive
            .recent()?
            .iter()
            .filter(|clip| clip.transcript.as_deref() == Some("synthetic"))
            .count(),
        33
    );
    Ok(())
}

#[test]
fn original_audio_follows_retention_until_paused_or_uncertain_clips_expire() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, u64::MAX);
    let session = archive.start_session("test", "replay")?;
    let paused = archive.save(session, "one", 200, 1, &[200; 16_000])?;
    let uncertain = archive.save(session, "two", 300, 2, &[300; 16_000])?;
    archive.db()?.execute(
        "UPDATE clips SET provider='openai',transcription_status='pending' WHERE id=?1",
        [paused],
    )?;
    archive.db()?.execute(
        "UPDATE clips SET provider='openai',transcription_status='sending' WHERE id=?1",
        [uncertain],
    )?;
    drop(archive);
    let archive = store(&root, u64::MAX);
    archive.process_pending()?;
    let clips = archive.recent()?;
    assert_eq!(clips[0].transcription_status, "uncertain");
    assert_eq!(clips[1].transcription_status, "paused");
    for id in [paused, uncertain] {
        assert!(archive.file(id, "wav").is_file());
        assert!(archive.file(id, "opus").is_file());
    }
    drop(archive);
    let archive = store(&root, 0);
    let clips = archive.recent()?;
    assert!(clips.iter().all(|c| c.status == "expired"));
    assert_eq!(clips[0].transcription_status, "uncertain");
    assert_eq!(clips[1].transcription_status, "paused");
    for id in [paused, uncertain] {
        assert!(!archive.file(id, "wav").exists());
        assert!(archive.audio(id)?.is_none());
    }
    Ok(())
}

#[test]
fn headless_results_scope_errors_to_the_session_after_retention() -> Result<()> {
    let root = TempDir::new()?;
    let archive = store(&root, 0);
    let first = archive.start_session("test", "replay")?;
    let second = archive.start_session("test", "live")?;
    let id = archive.save(first, "one", 200, 1, &[200; 16_000])?;
    archive.save(second, "one", 200, 2, &[100; 16_000])?;
    // Simulate an unreadable recording while leaving the durable job queued for the encoder.
    fs::write(archive.file(id, "wav"), b"invalid audio")?;
    archive.process_pending()?;
    assert!(archive.recent()?.iter().all(|c| c.status == "expired"));
    let error = archive.session_failure(first)?.unwrap();
    assert!(error.contains(&format!("clip {id}")));
    assert!(error.contains("Opus encoding failed"));
    assert!(archive.session_failure(second)?.is_none());
    Ok(())
}
