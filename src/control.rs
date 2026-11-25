use crate::monitor::Profile;
use axum::{
    Json, Router,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, put},
};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{self, Write},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

#[derive(Serialize)]
struct ProfileEntry {
    id: String,
    label: String,
}

#[derive(Deserialize)]
struct CatalogProfile {
    label: Option<String>,
    #[serde(flatten)]
    profile: Profile,
}

#[derive(Serialize)]
struct Server {
    hostname: Option<String>,
    address: Option<IpAddr>,
    device: Option<String>,
    bind: SocketAddr,
}

#[derive(Serialize)]
struct Config {
    profiles: Vec<ProfileEntry>,
    profile_switching: bool,
    server: Server,
}

struct Control {
    config: Config,
    selection: Option<PathBuf>,
}

#[derive(Deserialize)]
struct ProfileChoice {
    id: String,
}

pub fn router(profile: &Path, selection: Option<PathBuf>, bind: SocketAddr) -> Router {
    let profiles = profile_catalog(parent_dir(profile));
    let profile_switching = selection.is_some() && !profiles.is_empty();
    let control = Control {
        config: Config {
            profiles,
            profile_switching,
            server: Server {
                hostname: metadata("A16T_SERVER_HOST").or_else(hostname),
                address: metadata("A16T_SERVER_ADDRESS").and_then(|value| value.parse().ok()),
                device: metadata("A16T_RADIO_DEVICE"),
                bind,
            },
        },
        selection,
    };
    Router::new()
        .route("/api/config", get(config))
        .route("/api/profile", put(select_profile))
        .with_state(Arc::new(control))
}

fn parent_dir(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn profile_catalog(directory: &Path) -> Vec<ProfileEntry> {
    let Ok(files) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut profiles: Vec<_> = files
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|ty| ty.is_file()))
        .filter_map(|entry| catalog_entry(&entry.path()))
        .collect();
    profiles.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    profiles
}

fn catalog_entry(path: &Path) -> Option<ProfileEntry> {
    let id = path.file_stem()?.to_str()?;
    if path.extension()?.to_str()? != "json"
        || id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return None;
    }
    let CatalogProfile { label, profile } = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if profile.id != id
        || !profile.detection.valid()
        || !(1..=u16::MAX as usize).contains(&profile.channels.len())
    {
        return None;
    }
    let label = label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .unwrap_or(id)
        .to_owned();
    Some(ProfileEntry {
        id: profile.id,
        label,
    })
}

fn metadata(name: &str) -> Option<String> {
    let value = env::var(name).ok()?;
    nonempty(&value)
}

fn hostname() -> Option<String> {
    let result = Command::new("hostname").output().ok()?;
    if !result.status.success() {
        return None;
    }
    nonempty(std::str::from_utf8(&result.stdout).ok()?)
}

fn nonempty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

async fn config(State(control): State<Arc<Control>>) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(&control.config)).into_response()
}

async fn select_profile(
    State(control): State<Arc<Control>>,
    Json(choice): Json<ProfileChoice>,
) -> StatusCode {
    let Some(selection) = control
        .selection
        .as_ref()
        .filter(|_| control.config.profile_switching)
        .cloned()
    else {
        return StatusCode::CONFLICT;
    };
    if !control
        .config
        .profiles
        .iter()
        .any(|profile| profile.id == choice.id)
    {
        return StatusCode::NOT_FOUND;
    }

    match tokio::task::spawn_blocking(move || write_selection(&selection, &choice.id)).await {
        Ok(Ok(())) => StatusCode::ACCEPTED,
        Ok(Err(error)) => {
            eprintln!("Profile selection write failed: {error}");
            StatusCode::SERVICE_UNAVAILABLE
        }
        Err(error) => {
            eprintln!("Profile selection worker failed: {error}");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

fn write_selection(path: &Path, id: &str) -> io::Result<()> {
    let mut pending = tempfile::NamedTempFile::new_in(parent_dir(path))?;
    writeln!(pending, "{id}")?;
    pending.as_file().sync_all()?;
    pending.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lists_only_matching_safe_profiles_in_id_order() {
        let directory = tempfile::tempdir().unwrap();
        for (filename, id) in [
            ("z-airband.json", "z-airband"),
            ("a-marine.json", "a-marine"),
            ("alias.json", "z-airband"),
            ("a.unsafe.json", "a.unsafe"),
            ("unrelated.txt", "unrelated"),
        ] {
            let profile = json!({
                "id": id,
                "label": "Receiver profile",
                "channels": [{"id": "test", "label": "Test", "frequency_hz": 156_800_000}],
            });
            fs::write(directory.path().join(filename), profile.to_string()).unwrap();
        }
        fs::write(directory.path().join("broken.json"), "{").unwrap();
        let profiles = profile_catalog(directory.path());
        assert_eq!(
            profiles
                .iter()
                .map(|profile| (profile.id.as_str(), profile.label.as_str()))
                .collect::<Vec<_>>(),
            [
                ("a-marine", "Receiver profile"),
                ("z-airband", "Receiver profile")
            ]
        );
    }

    #[test]
    fn replaces_the_requested_id() {
        let directory = tempfile::tempdir().unwrap();
        let selection = directory.path().join("active-profile");
        write_selection(&selection, "marine-vhf").unwrap();
        write_selection(&selection, "eastbay-marine").unwrap();
        assert_eq!(fs::read_to_string(selection).unwrap(), "eastbay-marine\n");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
