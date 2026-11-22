use anyhow::{Context, Result, ensure};
use std::{
    fs::{self, File},
    io::{BufWriter, ErrorKind, Read, Write},
    path::Path,
    process::{Command, Stdio},
};

const RATE: u32 = 16_000;

fn header(samples: u64) -> Result<[u8; 44]> {
    let data = u32::try_from(samples.checked_mul(2).context("WAV too long")?)?;
    let riff = data.checked_add(36).context("WAV too long")?;
    let mut h = [0; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&riff.to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16_u32.to_le_bytes());
    h[20..22].copy_from_slice(&1_u16.to_le_bytes());
    h[22..24].copy_from_slice(&1_u16.to_le_bytes());
    h[24..28].copy_from_slice(&RATE.to_le_bytes());
    h[28..32].copy_from_slice(&(RATE * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2_u16.to_le_bytes());
    h[34..36].copy_from_slice(&16_u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data.to_le_bytes());
    Ok(h)
}

pub(super) fn write_wav(path: &Path, samples: &[i16]) -> Result<()> {
    let mut file = BufWriter::new(File::create_new(path)?);
    file.write_all(&header(samples.len() as u64)?)?;
    for sample in samples {
        file.write_all(&sample.to_le_bytes())?;
    }
    file.flush()?;
    file.get_ref().sync_all()?;
    Ok(())
}

pub(super) fn complete_wav(path: &Path, samples: u64) -> Result<bool> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    if file.metadata()?.len() != 44 + samples * 2 {
        return Ok(false);
    }
    let mut actual = [0; 44];
    file.read_exact(&mut actual)?;
    Ok(actual == header(samples)?)
}

pub(super) fn publish(part: &Path, final_path: &Path) -> Result<()> {
    fs::rename(part, final_path)?;
    #[cfg(unix)]
    File::open(final_path.parent().context("invalid clip directory")?)?.sync_all()?;
    Ok(())
}

pub(super) fn remove(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub(super) fn size(path: &Path) -> Result<u64> {
    match fs::metadata(path) {
        Ok(m) => Ok(m.len()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(0),
        Err(e) => Err(e.into()),
    }
}

pub(super) fn encode(wav: &Path, part: &Path) -> Result<()> {
    let status = Command::new("ffmpeg")
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(wav)
        .args([
            "-map",
            "0:a:0",
            "-c:a",
            "libopus",
            "-application",
            "voip",
            "-b:a",
            "20k",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-f",
            "ogg",
        ])
        .arg(part)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .status()
        .context("start ffmpeg with libopus support")?;
    ensure!(status.success(), "Opus encoding failed ({status})");
    File::open(part)?.sync_all()?;
    Ok(())
}
