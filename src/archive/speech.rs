use anyhow::{Context, Result, bail, ensure};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub(super) struct Speech {
    pub(super) provider: String,
    pub(super) model: String,
    pub(super) whisper_bin: PathBuf,
}

impl Speech {
    pub(super) fn from_env() -> Result<Self> {
        let local_model = env::var("A16T_WHISPER_MODEL")
            .ok()
            .filter(|m| !m.is_empty());
        let provider = env::var("A16T_TRANSCRIPTION_PROVIDER").unwrap_or_else(|_| {
            if local_model.is_some() {
                "local"
            } else {
                "none"
            }
            .to_owned()
        });
        let model = match provider.as_str() {
            "none" => String::new(),
            "local" => {
                let path = local_model.context("local transcription needs A16T_WHISPER_MODEL")?;
                env::current_dir()?
                    .join(path)
                    .to_string_lossy()
                    .into_owned()
            }
            "openai" => {
                env::var("A16T_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-transcribe".into())
            }
            _ => bail!("A16T_TRANSCRIPTION_PROVIDER must be none, local, or openai"),
        };
        Ok(Self {
            provider,
            model,
            whisper_bin: env::var_os("A16T_WHISPER_BIN")
                .unwrap_or_else(|| "whisper-cli".into())
                .into(),
        })
    }

    pub(super) fn local(&self, wav: &Path, model: &str) -> Result<String> {
        let base = wav.with_extension("transcript");
        let text_path = wav.with_extension("transcript.txt");
        super::media::remove(&text_path)?;
        let status = Command::new(&self.whisper_bin)
            .arg("-m")
            .arg(model)
            .arg("-f")
            .arg(wav)
            .args(["-l", "en", "-nt", "-otxt", "-of"])
            .arg(&base)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .context("start local whisper-cli")?;
        let result = if status.success() {
            fs::read_to_string(&text_path).context("read whisper-cli transcript")
        } else {
            Err(anyhow::anyhow!("whisper-cli failed ({status})"))
        };
        super::media::remove(&text_path)?;
        Ok(result?.trim().to_owned())
    }

    pub(super) fn cloud_request<'a>(
        &self,
        wav: &'a Path,
        model: &'a str,
    ) -> Result<CloudRequest<'a>> {
        ensure!(
            fs::metadata(wav)?.len() <= 25_000_000,
            "clip exceeds the configured cloud upload limit (25 MB)"
        );
        let key = env::var("A16T_OPENAI_API_KEY")
            .or_else(|_| env::var("OPENAI_API_KEY"))
            .ok()
            .filter(|s| !s.is_empty())
            .context("OpenAI transcription needs A16T_OPENAI_API_KEY or OPENAI_API_KEY")?;
        ensure!(
            key.bytes().all(|c| c.is_ascii_graphic()),
            "invalid API key characters"
        );
        Ok(CloudRequest { wav, model, key })
    }
}

pub(super) struct CloudRequest<'a> {
    wav: &'a Path,
    model: &'a str,
    key: String,
}

impl CloudRequest<'_> {
    pub(super) fn send(self) -> Result<String> {
        let filename = self
            .wav
            .file_name()
            .and_then(|s| s.to_str())
            .context("invalid WAV filename")?;
        let mut child = Command::new("curl")
            .current_dir(self.wav.parent().context("invalid WAV directory")?)
            .args([
                "--disable",
                "--silent",
                "--fail",
                "--max-time",
                "120",
                "--proto",
                "=https",
                "--header",
                "@-",
                "--form",
            ])
            .arg(format!("file=@{filename};type=audio/wav"))
            .arg("--form-string")
            .arg(format!("model={}", self.model))
            .args([
                "--form-string",
                "response_format=json",
                "https://api.openai.com/v1/audio/transcriptions",
            ])
            .env_remove("A16T_OPENAI_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .context("start curl")?;
        let sent = writeln!(
            child.stdin.take().context("curl stdin unavailable")?,
            "Authorization: Bearer {}",
            self.key
        );
        let output = child.wait_with_output()?;
        sent.context("send authorization header to curl")?;
        ensure!(
            output.status.success(),
            "cloud request did not return success; review before retrying"
        );
        #[derive(serde::Deserialize)]
        struct Response {
            text: String,
        }
        Ok(serde_json::from_slice::<Response>(&output.stdout)
            .context("read cloud transcription response")?
            .text)
    }
}
