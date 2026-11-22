use crate::monitor::App;
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{
        Html, IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::get,
};
use bytes::Bytes;
use serde_json::{Value, json};
use std::{convert::Infallible, time::Duration};
use tokio::sync::broadcast::error::RecvError;

async fn snapshot(app: &App) -> Result<Value, String> {
    let archive = app.archive.clone();
    let clips = tokio::task::spawn_blocking(move || archive.recent())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let h = app.health.lock().unwrap();
    Ok(
        json!({"profile":app.profile,"source":app.source,"receiver":h.receiver,"channels":h.channels,
        "clips":clips,"archive_error":h.archive_error,"dropped_clips":h.dropped_clips}),
    )
}
async fn state(State(app): State<App>) -> Response {
    match snapshot(&app).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => {
            eprintln!("State read failed: {error}");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}
async fn events(State(app): State<App>) -> impl IntoResponse {
    Sse::new(async_stream::stream! {
        let mut tick = tokio::time::interval(Duration::from_millis(350));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            match snapshot(&app).await {
                Ok(value) => yield Ok::<_, Infallible>(Event::default().event("state").data(value.to_string())),
                Err(e) => { eprintln!("Event stream state read failed: {e}"); break; }
            }
        }
    }).keep_alive(KeepAlive::default())
}
async fn clip(State(app): State<App>, Path(id): Path<i64>) -> Response {
    let resource = tokio::task::spawn_blocking(move || app.archive.audio(id)).await;
    match resource {
        Ok(Ok(Some((path, mime)))) => match tokio::fs::read(path).await {
            Ok(bytes) => ([(header::CONTENT_TYPE, mime)], bytes).into_response(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                StatusCode::NOT_FOUND.into_response()
            }
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        Ok(Ok(None)) => StatusCode::NOT_FOUND.into_response(),
        _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
async fn listen(State(app): State<App>, Path(channel): Path<String>) -> Response {
    let i = app
        .health
        .lock()
        .unwrap()
        .channels
        .iter()
        .position(|ch| ch.id == channel);
    let Some(i) = i else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if app.stream_finished() {
        return StatusCode::GONE.into_response();
    }
    let mut audio = app.audio[i].subscribe();
    let body = async_stream::stream! {
        // RIFF unknown-length PCM stream, mono, 16000 Hz, signed little-endian 16 bit.
        yield Ok::<_, Infallible>(Bytes::from_static(b"RIFF\xff\xff\xff\xffWAVEfmt \x10\0\0\0\x01\0\x01\0\x80\x3e\0\0\0\x7d\0\0\x02\0\x10\0data\xff\xff\xff\xff"));
        loop {
            match tokio::time::timeout(Duration::from_secs(1), audio.recv()).await {
                Ok(Ok(chunk)) => yield Ok(chunk),
                Ok(Err(RecvError::Lagged(_))) => continue,
                Ok(Err(RecvError::Closed)) => break,
                Err(_) if app.stream_finished() => break,
                Err(_) => continue,
            }
        }
    };
    (
        [
            (header::CONTENT_TYPE, "audio/wav"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        Body::from_stream(body),
    )
        .into_response()
}
pub fn router(app: App) -> Router {
    Router::new()
        .route(
            "/",
            get(|| async { Html(include_str!("../web/index.html")) }),
        )
        .route(
            "/app.js",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/javascript")],
                    include_str!("../web/app.js"),
                )
            }),
        )
        .route(
            "/styles.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css")],
                    include_str!("../web/styles.css"),
                )
            }),
        )
        .route("/api/state", get(state))
        .route("/events", get(events))
        .route("/api/clips/{id}/audio", get(clip))
        .route("/api/listen/{channel}", get(listen))
        .with_state(app)
}
