//! Tokio job queue for provider calls.
//!
//! [`JobManager::submit`] spawns a task per job; a semaphore bounds how many run at
//! once (default 2), every job gets a deadline (default 180 s) and can be cancelled.
//! Progress is broadcast as [`JobEvent`]s; completed image bytes stay in memory until
//! [`JobManager::take_result`] hands them to the caller exactly once, so the Tauri layer
//! can stream them as raw bytes without a second copy.
//!
//! `submit` must be called from inside a Tokio runtime (Tauri commands are).

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, oneshot, Semaphore};

use crate::error::Error;
use crate::providers::SharedProvider;
use crate::types::{EditRequest, GenerateRequest, ImageResult, ImageResultMeta, ProviderId};

/// Opaque job identifier (UUID v4, simple form).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct JobId(String);

impl JobId {
    fn fresh() -> Self {
        Self(uuid::Uuid::new_v4().simple().to_string())
    }

    /// Borrow the string form.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for JobId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for JobId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

/// What a job does.
#[derive(Debug, Clone)]
pub enum JobKind {
    /// Text -> image.
    Generate(GenerateRequest),
    /// Image (+ mask) + prompt -> image.
    Edit(EditRequest),
}

impl JobKind {
    /// `"generate"` / `"edit"`.
    pub fn label(&self) -> &'static str {
        match self {
            JobKind::Generate(_) => "generate",
            JobKind::Edit(_) => "edit",
        }
    }

    /// The prompt text.
    pub fn prompt(&self) -> &str {
        match self {
            JobKind::Generate(r) => &r.prompt,
            JobKind::Edit(r) => &r.prompt,
        }
    }
}

/// A unit of work for the queue.
pub struct JobSpec {
    /// Provider to call (already authenticated).
    pub provider: SharedProvider,
    /// The request.
    pub kind: JobKind,
    /// Per-job deadline override.
    pub timeout: Option<Duration>,
}

impl fmt::Debug for JobSpec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("JobSpec")
            .field("provider", &self.provider.id())
            .field("kind", &self.kind.label())
            .field("timeout", &self.timeout)
            .finish()
    }
}

/// Queue configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobConfig {
    /// Jobs allowed to run concurrently.
    pub concurrency: usize,
    /// Default per-job deadline (queue wait excluded).
    pub timeout: Duration,
    /// Broadcast channel capacity for events.
    pub event_capacity: usize,
}

impl Default for JobConfig {
    fn default() -> Self {
        Self {
            concurrency: 2,
            timeout: Duration::from_secs(180),
            event_capacity: 256,
        }
    }
}

/// Lifecycle state of a job.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum JobStatus {
    /// Waiting for a concurrency slot.
    Queued,
    /// Provider call in flight.
    Running,
    /// Finished; results available until taken.
    Completed {
        /// Metadata of each result (bytes are fetched separately).
        results: Vec<ImageResultMeta>,
        /// `false` once [`JobManager::take_result`] has drained the bytes.
        available: bool,
    },
    /// Finished with an error.
    Failed {
        /// Stable error code (`ai_rate_limited`, ...).
        code: String,
        /// Human message.
        message: String,
    },
    /// Cancelled by the user.
    Cancelled,
}

impl JobStatus {
    /// `true` once the job will not change state again.
    pub fn is_terminal(&self) -> bool {
        !matches!(self, JobStatus::Queued | JobStatus::Running)
    }
}

/// Event payload emitted to the UI (`ai://job/<id>` in Tauri).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    /// Which job.
    pub job: JobId,
    /// Provider running it.
    pub provider: ProviderId,
    /// What happened.
    #[serde(flatten)]
    pub kind: JobEventKind,
}

/// Lifecycle transitions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JobEventKind {
    /// Accepted and waiting.
    Queued,
    /// Provider call started.
    Started,
    /// Progress hint (`pct` is `None` when the provider gives no signal).
    Progress {
        /// 0-100.
        pct: Option<u8>,
    },
    /// Success; bytes are waiting in the manager.
    Completed {
        /// One entry per image.
        results: Vec<ImageResultMeta>,
        /// Wall time of the provider call.
        duration_ms: u64,
    },
    /// Failure.
    Failed {
        /// Stable error code.
        code: String,
        /// Human message.
        message: String,
    },
    /// Cancelled.
    Cancelled,
}

struct Entry {
    status: JobStatus,
    results: Option<Vec<ImageResult>>,
    cancel: Option<oneshot::Sender<()>>,
    created: Instant,
}

struct Inner {
    config: JobConfig,
    semaphore: Arc<Semaphore>,
    jobs: Mutex<HashMap<JobId, Entry>>,
    events: broadcast::Sender<JobEvent>,
}

/// Handle to the queue (cheap to clone).
#[derive(Clone)]
pub struct JobManager {
    inner: Arc<Inner>,
}

impl fmt::Debug for JobManager {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("JobManager")
            .field("config", &self.inner.config)
            .field("jobs", &self.len())
            .finish()
    }
}

impl Default for JobManager {
    fn default() -> Self {
        Self::new(JobConfig::default())
    }
}

impl JobManager {
    /// Create a queue. Nothing runs until [`JobManager::submit`].
    pub fn new(config: JobConfig) -> Self {
        let (events, _) = broadcast::channel(config.event_capacity.max(1));
        Self {
            inner: Arc::new(Inner {
                config,
                semaphore: Arc::new(Semaphore::new(config.concurrency.max(1))),
                jobs: Mutex::new(HashMap::new()),
                events,
            }),
        }
    }

    /// The configuration in use.
    pub fn config(&self) -> JobConfig {
        self.inner.config
    }

    /// Subscribe to lifecycle events (all jobs).
    pub fn subscribe(&self) -> broadcast::Receiver<JobEvent> {
        self.inner.events.subscribe()
    }

    /// Number of jobs the manager knows about (any state).
    pub fn len(&self) -> usize {
        self.inner.jobs.lock().map(|j| j.len()).unwrap_or(0)
    }

    /// `true` when no jobs are tracked.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Enqueue a job. Must be called within a Tokio runtime.
    pub fn submit(&self, spec: JobSpec) -> JobId {
        let id = JobId::fresh();
        let provider_id = spec.provider.id();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        {
            let mut jobs = self.inner.jobs.lock().unwrap_or_else(|p| p.into_inner());
            jobs.insert(
                id.clone(),
                Entry {
                    status: JobStatus::Queued,
                    results: None,
                    cancel: Some(cancel_tx),
                    created: Instant::now(),
                },
            );
        }
        self.emit(&id, provider_id, JobEventKind::Queued);

        let inner = Arc::clone(&self.inner);
        let job_id = id.clone();
        tokio::spawn(async move {
            run_job(inner, job_id, spec, cancel_rx).await;
        });
        id
    }

    /// Ask a job to stop. Returns `false` when it is unknown or already finished.
    pub fn cancel(&self, id: &JobId) -> bool {
        let mut jobs = self.inner.jobs.lock().unwrap_or_else(|p| p.into_inner());
        match jobs.get_mut(id) {
            Some(entry) if !entry.status.is_terminal() => {
                if let Some(tx) = entry.cancel.take() {
                    let _ = tx.send(());
                }
                true
            }
            _ => false,
        }
    }

    /// Current status, or `None` for an unknown id.
    pub fn status(&self, id: &JobId) -> Option<JobStatus> {
        let jobs = self.inner.jobs.lock().unwrap_or_else(|p| p.into_inner());
        jobs.get(id).map(|e| e.status.clone())
    }

    /// Move the result bytes out of the manager. Returns `None` if the job is unknown,
    /// not finished, failed, or the result was already taken.
    pub fn take_result(&self, id: &JobId) -> Option<Vec<ImageResult>> {
        let mut jobs = self.inner.jobs.lock().unwrap_or_else(|p| p.into_inner());
        let entry = jobs.get_mut(id)?;
        let results = entry.results.take()?;
        if let JobStatus::Completed { available, .. } = &mut entry.status {
            *available = false;
        }
        Some(results)
    }

    /// Forget finished jobs older than `max_age` (results included). Returns how many.
    pub fn prune(&self, max_age: Duration) -> usize {
        let mut jobs = self.inner.jobs.lock().unwrap_or_else(|p| p.into_inner());
        let before = jobs.len();
        jobs.retain(|_, e| !(e.status.is_terminal() && e.created.elapsed() > max_age));
        before - jobs.len()
    }

    fn emit(&self, id: &JobId, provider: ProviderId, kind: JobEventKind) {
        Inner::emit(&self.inner, id, provider, kind);
    }
}

impl Inner {
    fn emit(inner: &Arc<Inner>, id: &JobId, provider: ProviderId, kind: JobEventKind) {
        // A send error only means nobody is listening.
        let _ = inner.events.send(JobEvent {
            job: id.clone(),
            provider,
            kind,
        });
    }

    fn set_status(
        inner: &Arc<Inner>,
        id: &JobId,
        status: JobStatus,
        results: Option<Vec<ImageResult>>,
    ) {
        let mut jobs = inner.jobs.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(entry) = jobs.get_mut(id) {
            entry.status = status;
            entry.results = results;
            if entry.status.is_terminal() {
                entry.cancel = None;
            }
        }
    }
}

async fn run_job(
    inner: Arc<Inner>,
    id: JobId,
    spec: JobSpec,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    let provider_id = spec.provider.id();
    let semaphore = Arc::clone(&inner.semaphore);

    // Wait for a slot, unless cancelled first.
    let permit = tokio::select! {
        biased;
        _ = &mut cancel_rx => {
            Inner::set_status(&inner, &id, JobStatus::Cancelled, None);
            Inner::emit(&inner, &id, provider_id, JobEventKind::Cancelled);
            return;
        }
        p = semaphore.acquire_owned() => p,
    };
    let Ok(_permit) = permit else {
        // Semaphore closed: manager torn down.
        let err = Error::Cancelled;
        Inner::set_status(
            &inner,
            &id,
            JobStatus::Failed {
                code: err.code().to_owned(),
                message: err.to_string(),
            },
            None,
        );
        return;
    };

    Inner::set_status(&inner, &id, JobStatus::Running, None);
    Inner::emit(&inner, &id, provider_id, JobEventKind::Started);
    Inner::emit(
        &inner,
        &id,
        provider_id,
        JobEventKind::Progress { pct: None },
    );

    let deadline = spec.timeout.unwrap_or(inner.config.timeout);
    let started = Instant::now();
    let provider = spec.provider;
    let work = async move {
        match spec.kind {
            JobKind::Generate(req) => provider.generate(req).await,
            JobKind::Edit(req) => provider.edit(req).await,
        }
    };

    let outcome: Result<Vec<ImageResult>, Error> = tokio::select! {
        biased;
        _ = &mut cancel_rx => Err(Error::Cancelled),
        r = tokio::time::timeout(deadline, work) => match r {
            Ok(inner_result) => inner_result,
            Err(_) => Err(Error::Timeout { secs: deadline.as_secs() }),
        },
    };
    let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    match outcome {
        Ok(results) => {
            let metas: Vec<ImageResultMeta> = results.iter().map(ImageResult::meta).collect();
            Inner::set_status(
                &inner,
                &id,
                JobStatus::Completed {
                    results: metas.clone(),
                    available: true,
                },
                Some(results),
            );
            Inner::emit(
                &inner,
                &id,
                provider_id,
                JobEventKind::Completed {
                    results: metas,
                    duration_ms,
                },
            );
        }
        Err(Error::Cancelled) => {
            Inner::set_status(&inner, &id, JobStatus::Cancelled, None);
            Inner::emit(&inner, &id, provider_id, JobEventKind::Cancelled);
        }
        Err(err) => {
            let (code, message) = (err.code().to_owned(), err.to_string());
            tracing::warn!(job = %id, provider = %provider_id, code, "AI job failed: {message}");
            Inner::set_status(
                &inner,
                &id,
                JobStatus::Failed {
                    code: code.clone(),
                    message: message.clone(),
                },
                None,
            );
            Inner::emit(
                &inner,
                &id,
                provider_id,
                JobEventKind::Failed { code, message },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_id_serializes_transparently() {
        let id = JobId::fresh();
        let json = serde_json::to_string(&id).expect("ser");
        assert_eq!(json, format!("\"{}\"", id.as_str()));
        let back: JobId = serde_json::from_str(&json).expect("de");
        assert_eq!(back, id);
        assert_eq!(id.as_str().len(), 32);
    }

    #[test]
    fn event_json_shape_is_tagged() {
        let ev = JobEvent {
            job: JobId("abc".into()),
            provider: ProviderId::XAi,
            kind: JobEventKind::Failed {
                code: "ai_http".into(),
                message: "boom".into(),
            },
        };
        let v = serde_json::to_value(&ev).expect("ser");
        assert_eq!(v["job"], "abc");
        assert_eq!(v["provider"], "x_ai");
        assert_eq!(v["type"], "failed");
        assert_eq!(v["code"], "ai_http");
        let st = serde_json::to_value(JobStatus::Queued).expect("ser");
        assert_eq!(st["state"], "queued");
    }
}
