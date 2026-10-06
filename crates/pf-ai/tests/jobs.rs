mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use pf_ai::{
    Capabilities, EditRequest, Error, GenerateRequest, ImageBytes, ImageProvider, ImageResult,
    JobConfig, JobEvent, JobEventKind, JobId, JobKind, JobManager, JobSpec, JobStatus, ProviderId,
};
use tokio::sync::broadcast;

/// Fake provider: sleeps `delay`, then succeeds or fails. Tracks peak concurrency.
struct Fake {
    delay: Duration,
    fail: Option<&'static str>,
    active: Arc<AtomicUsize>,
    peak: Arc<AtomicUsize>,
}

impl Fake {
    fn new(delay_ms: u64) -> (Arc<Self>, Arc<AtomicUsize>) {
        let peak = Arc::new(AtomicUsize::new(0));
        let f = Arc::new(Self {
            delay: Duration::from_millis(delay_ms),
            fail: None,
            active: Arc::new(AtomicUsize::new(0)),
            peak: Arc::clone(&peak),
        });
        (f, peak)
    }

    fn failing(code: &'static str) -> Arc<Self> {
        Arc::new(Self {
            delay: Duration::from_millis(5),
            fail: Some(code),
            active: Arc::new(AtomicUsize::new(0)),
            peak: Arc::new(AtomicUsize::new(0)),
        })
    }

    async fn run(&self) -> Result<Vec<ImageResult>, Error> {
        let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
        tokio::time::sleep(self.delay).await;
        self.active.fetch_sub(1, Ordering::SeqCst);
        match self.fail {
            Some("rate") => Err(Error::RateLimited {
                retry_after_secs: Some(1),
            }),
            Some(_) => Err(Error::Rejected("nope".into())),
            None => Ok(vec![ImageResult {
                image: ImageBytes::png(common::png(2, 2, [1, 2, 3, 255])),
                width: 2,
                height: 2,
                provider: ProviderId::XAi,
                model: "fake".into(),
                revised_prompt: None,
                cost_usd: Some(0.01),
            }]),
        }
    }
}

#[async_trait]
impl ImageProvider for Fake {
    fn id(&self) -> ProviderId {
        ProviderId::XAi
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            generate: true,
            instruct_edit: true,
            max_variants: 4,
            ..Capabilities::default()
        }
    }
    async fn generate(&self, _req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        self.run().await
    }
    async fn edit(&self, _req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        self.run().await
    }
    async fn test_key(&self) -> Result<(), Error> {
        Ok(())
    }
}

fn gen_spec(provider: Arc<Fake>, timeout: Option<Duration>) -> JobSpec {
    JobSpec {
        provider,
        kind: JobKind::Generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        }),
        timeout,
    }
}

/// Collect events for `id` until a terminal one arrives.
async fn wait_terminal(rx: &mut broadcast::Receiver<JobEvent>, id: &JobId) -> Vec<JobEventKind> {
    let mut seen = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let ev = tokio::time::timeout_at(deadline, rx.recv())
            .await
            .expect("event before deadline")
            .expect("channel open");
        if &ev.job != id {
            continue;
        }
        let terminal = matches!(
            ev.kind,
            JobEventKind::Completed { .. } | JobEventKind::Failed { .. } | JobEventKind::Cancelled
        );
        seen.push(ev.kind);
        if terminal {
            return seen;
        }
    }
}

#[tokio::test]
async fn submit_runs_emits_and_result_can_be_taken_once() {
    let mgr = JobManager::new(JobConfig::default());
    let mut rx = mgr.subscribe();
    let (fake, _) = Fake::new(10);
    let id = mgr.submit(gen_spec(fake, None));
    assert!(matches!(
        mgr.status(&id),
        Some(JobStatus::Queued | JobStatus::Running)
    ));

    let events = wait_terminal(&mut rx, &id).await;
    assert!(matches!(events[0], JobEventKind::Queued));
    assert!(matches!(events[1], JobEventKind::Started));
    assert!(matches!(events[2], JobEventKind::Progress { pct: None }));
    match events.last().expect("terminal") {
        JobEventKind::Completed { results, .. } => {
            assert_eq!(results.len(), 1);
            assert_eq!(results[0].width, 2);
            assert_eq!(results[0].mime, "image/png");
        }
        other => panic!("expected completed, got {other:?}"),
    }
    assert!(matches!(
        mgr.status(&id),
        Some(JobStatus::Completed {
            available: true,
            ..
        })
    ));
    let taken = mgr.take_result(&id).expect("first take");
    assert_eq!(taken.len(), 1);
    assert_eq!(taken[0].model, "fake");
    assert!(mgr.take_result(&id).is_none(), "bytes are handed out once");
    assert!(matches!(
        mgr.status(&id),
        Some(JobStatus::Completed {
            available: false,
            ..
        })
    ));
    assert_eq!(mgr.len(), 1);
    assert_eq!(mgr.prune(Duration::ZERO), 1);
    assert!(mgr.is_empty());
    assert!(mgr.status(&id).is_none());
}

#[tokio::test]
async fn failures_carry_error_code() {
    let mgr = JobManager::default();
    let mut rx = mgr.subscribe();
    let id = mgr.submit(gen_spec(Fake::failing("rate"), None));
    let events = wait_terminal(&mut rx, &id).await;
    match events.last().expect("terminal") {
        JobEventKind::Failed { code, .. } => assert_eq!(code, "ai_rate_limited"),
        other => panic!("{other:?}"),
    }
    assert!(
        matches!(mgr.status(&id), Some(JobStatus::Failed { ref code, .. }) if code == "ai_rate_limited")
    );
    assert!(mgr.take_result(&id).is_none());
}

#[tokio::test]
async fn cancel_running_job() {
    let mgr = JobManager::default();
    let mut rx = mgr.subscribe();
    let (fake, _) = Fake::new(5_000);
    let id = mgr.submit(gen_spec(fake, None));
    // Wait until it is actually running.
    loop {
        let ev = rx.recv().await.expect("event");
        if ev.job == id && matches!(ev.kind, JobEventKind::Started) {
            break;
        }
    }
    assert!(mgr.cancel(&id));
    let events = wait_terminal(&mut rx, &id).await;
    assert!(matches!(events.last(), Some(JobEventKind::Cancelled)));
    assert_eq!(mgr.status(&id), Some(JobStatus::Cancelled));
    assert!(!mgr.cancel(&id), "already terminal");
    assert!(!mgr.cancel(&JobId::from("nope".to_owned())));
}

#[tokio::test]
async fn cancel_queued_job_never_starts() {
    let mgr = JobManager::new(JobConfig {
        concurrency: 1,
        ..JobConfig::default()
    });
    let mut rx = mgr.subscribe();
    let (slow, _) = Fake::new(2_000);
    let (fast, _) = Fake::new(1);
    let _blocker = mgr.submit(gen_spec(slow, None));
    let queued = mgr.submit(gen_spec(fast, None));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(mgr.status(&queued), Some(JobStatus::Queued));
    assert!(mgr.cancel(&queued));
    let events = wait_terminal(&mut rx, &queued).await;
    assert!(
        !events.iter().any(|e| matches!(e, JobEventKind::Started)),
        "queued job must not start: {events:?}"
    );
    assert!(matches!(events.last(), Some(JobEventKind::Cancelled)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrency_is_bounded() {
    let mgr = JobManager::new(JobConfig {
        concurrency: 2,
        ..JobConfig::default()
    });
    let mut rx = mgr.subscribe();
    let (fake, peak) = Fake::new(150);
    let ids: Vec<JobId> = (0..5)
        .map(|_| mgr.submit(gen_spec(Arc::clone(&fake), None)))
        .collect();
    // One receiver sees every job's events, so collect terminals for all ids in one pass.
    let mut done = std::collections::HashSet::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while done.len() < ids.len() {
        let ev = tokio::time::timeout_at(deadline, rx.recv())
            .await
            .expect("all jobs finish in time")
            .expect("channel open");
        match ev.kind {
            JobEventKind::Completed { .. } => {
                done.insert(ev.job);
            }
            JobEventKind::Failed { .. } | JobEventKind::Cancelled => {
                panic!("job {} did not complete: {:?}", ev.job, ev.kind)
            }
            _ => {}
        }
    }
    assert!(ids.iter().all(|id| done.contains(id)));
    assert_eq!(
        peak.load(Ordering::SeqCst),
        2,
        "never more than 2 in flight"
    );
    assert_eq!(mgr.len(), 5);
    for id in &ids {
        assert_eq!(mgr.take_result(id).map(|r| r.len()), Some(1));
    }
}

#[tokio::test]
async fn per_job_timeout_fails_with_ai_timeout() {
    let mgr = JobManager::new(JobConfig {
        timeout: Duration::from_millis(60),
        ..JobConfig::default()
    });
    let mut rx = mgr.subscribe();
    let (slow, _) = Fake::new(5_000);
    let id = mgr.submit(gen_spec(slow, None));
    let events = wait_terminal(&mut rx, &id).await;
    match events.last().expect("terminal") {
        JobEventKind::Failed { code, message } => {
            assert_eq!(code, "ai_timeout");
            assert!(message.contains("timed out"));
        }
        other => panic!("{other:?}"),
    }

    // Per-job override beats the config.
    let (slow, _) = Fake::new(5_000);
    let id = mgr.submit(gen_spec(slow, Some(Duration::from_millis(20))));
    let events = wait_terminal(&mut rx, &id).await;
    assert!(
        matches!(events.last(), Some(JobEventKind::Failed { code, .. }) if code == "ai_timeout")
    );

    // And a generous override lets a slowish job finish.
    let (ok, _) = Fake::new(100);
    let id = mgr.submit(gen_spec(ok, Some(Duration::from_secs(5))));
    let events = wait_terminal(&mut rx, &id).await;
    assert!(matches!(
        events.last(),
        Some(JobEventKind::Completed { .. })
    ));
}

#[tokio::test]
async fn unknown_ids_are_none() {
    let mgr = JobManager::default();
    let id = JobId::from("does-not-exist".to_owned());
    assert!(mgr.status(&id).is_none());
    assert!(mgr.take_result(&id).is_none());
    assert!(!mgr.cancel(&id));
}
