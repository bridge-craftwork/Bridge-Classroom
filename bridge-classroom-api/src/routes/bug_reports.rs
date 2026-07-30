//! In-app bug-report "beetle" — the *issue* sink (Slice 1).
//!
//! Distinct from the lesson-content "Report a Problem" pipeline (`reports.rs`):
//! that reports bad *content* into content repos; this reports *app* bugs into a
//! single private artifacts repo, `bridge-classroom-bug-artifacts`. A report
//! becomes a bundle (context.json / fixture.json / screenshot.jpg) committed to
//! that repo plus an issue filed **in the same repo** — colocated so the inline
//! screenshot renders off the viewer's session (a public repo can't render an
//! image from a private repo's raw URL).
//!
//! The local dev sink (writing to a gitignored folder) is entirely client-side
//! and never reaches this endpoint.
//!
//! Auth posture matches `reports.rs`: `x-api-key` gated (this is a public,
//! all-users feature); the GitHub PAT lives only in server config and is never
//! returned or logged. No token → 503 so the UI can degrade gracefully.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::AppState;

fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|k| k == expected_key)
        .unwrap_or(false)
}

/// A beetle bug report. `context` and `fixture` are committed verbatim as
/// `context.json` / `fixture.json`; the identity fields drive the issue body
/// (and, for the display name only, are expected to already be inside `context`).
#[derive(Debug, Deserialize)]
pub struct BugReportRequest {
    /// Free-text narrative (also present in `context.note`); drives title/slug/body.
    pub note: String,
    /// "bug" (default) or "feature" — reshapes the issue title + label. The
    /// capture (screenshot, env, layout) is identical either way.
    #[serde(default)]
    pub kind: Option<String>,
    /// The full context.json object (env block, note, tape, identity display name).
    /// Committed as-is — must NOT contain an email (kept out of the repo).
    pub context: Value,
    /// The fixture.json object (a stub until Slice 3/4). Committed as-is.
    #[serde(default)]
    pub fixture: Value,
    /// Screenshot as base64 (no `data:` prefix). Optional.
    pub screenshot_base64: Option<String>,
    /// Second screenshot with the bounding-box overlay on (grid layouts), base64,
    /// no `data:` prefix. Committed as `screenshot-boxes.jpg` and shown under its own
    /// heading. Absent for non-grid views (the beetle only captures it when a grid is
    /// on screen).
    #[serde(default)]
    pub screenshot_boxes_base64: Option<String>,
    /// Display name when the reporter chose to be named. None ⇒ anonymous.
    pub reporter_name: Option<String>,
    /// Contact email when the reporter opted to be contactable. Appears in the
    /// **issue body only** — never committed to a file or a commit message.
    pub contact_email: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BugReportResponse {
    pub success: bool,
    pub issue_url: String,
    pub issue_number: i64,
    pub bundle_path: String,
}

const BUG_LABEL: &str = "bug-report";
const FEATURE_LABEL: &str = "feature-request";
const UA: &str = "bridge-classroom-beetle";

/// POST /api/bug-report
pub async fn create_bug_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<BugReportRequest>,
) -> Result<Json<BugReportResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let note = req.note.trim();
    if note.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Report note is empty".to_string()));
    }

    // Fail closed when the beetle isn't configured, so the UI can say so.
    let token = match state.config.bug_artifacts_token.as_deref() {
        Some(t) => t,
        None => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Bug reporting is not configured on this server".to_string(),
            ));
        }
    };
    let repo = &state.config.bug_artifacts_repo;

    // Defensive scrub: never let an email reach a committed file even if the
    // client mistakenly embedded one. Email belongs in the issue body only.
    let mut context = req.context.clone();
    scrub_emails(&mut context);

    let env = context.get("env").cloned().unwrap_or(Value::Null);
    let layout = context.get("layout").cloned().unwrap_or(Value::Null);
    let now = chrono::Utc::now();
    let bundle_path = format!(
        "{}/{:02}/{}-{}",
        now.format("%Y"),
        now.format("%m").to_string().parse::<u32>().unwrap_or(1),
        slugify(note),
        now.format("%Y%m%d-%H%M%S"),
    );

    let client = Client::new();

    // ── Order: issue FIRST, files in the background (roadmap 2026-07-30 §3.4) ──
    //
    // This used to be 5-6 sequential awaited round trips to api.github.com — a
    // PUT per file (two ~90KB base64 screenshots, fixture, context), then the
    // issue, then a back-ref commit — ALL inside the request the reporter waits
    // on, behind client → tunnel → Mac. At ~1s per GitHub write that is the ~8s
    // David measured. Submit latency is a tax on the reporting habit, and this
    // cycle proved the habit works.
    //
    // The obvious fix — run the four PUTs concurrently — is WRONG here: each is a
    // commit to `main` via the Contents API, and concurrent commits to one branch
    // race on the parent sha and 409. They stay sequential; they just stop being
    // the reporter's problem.
    //
    // Nothing forced the old order. The issue body references raw file URLs, but
    // those URLs are COMPUTABLE from `repo` + `bundle_path` — they never depended
    // on the PUT responses. So: build the body, file the issue, hand the reporter
    // their issue number, and let the bundle land behind them. Folding the issue
    // link into `context.json` BEFORE its single write also deletes the sixth
    // call (the back-ref micro-commit) outright.
    let shot_url = req
        .screenshot_base64
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(|_| {
            format!("https://github.com/{repo}/blob/main/{bundle_path}/screenshot.jpg?raw=true")
        });
    let boxes_url = req
        .screenshot_boxes_base64
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(|_| {
            format!(
                "https://github.com/{repo}/blob/main/{bundle_path}/screenshot-boxes.jpg?raw=true"
            )
        });
    let is_feature = req.kind.as_deref() == Some("feature");
    let title = build_title(note, req.reporter_name.as_deref(), is_feature);
    let body = build_issue_body(&BugBody {
        note,
        env: &env,
        layout: &layout,
        reporter_name: req.reporter_name.as_deref(),
        contact_email: req.contact_email.as_deref(),
        repo,
        bundle_path: &bundle_path,
        screenshot_url: shot_url.as_deref(),
        screenshot_boxes_url: boxes_url.as_deref(),
    });
    let labels = build_labels(&env, is_feature);

    // The ONE call the reporter waits on. Still fails loudly: if the issue can't
    // be filed there is no report, and they should know now and retry.
    let issue = create_issue(&client, repo, token, &title, &body, labels).await?;

    // Back-reference goes in before the write, not after it.
    if let Value::Object(ref mut map) = context {
        map.insert(
            "issue".to_string(),
            json!({ "number": issue.number, "url": issue.html_url }),
        );
    }

    // Everything below is off the critical path. Owned clones so the task is
    // 'static; sequential inside, for the branch-race reason above.
    let files: Vec<(String, String, String)> = {
        let mut v = Vec::with_capacity(4);
        if let Some(shot) = req.screenshot_base64.as_deref().filter(|s| !s.is_empty()) {
            v.push((
                format!("{bundle_path}/screenshot.jpg"),
                format!("beetle: screenshot for {bundle_path}"),
                shot.to_string(),
            ));
        }
        if let Some(boxes) = req
            .screenshot_boxes_base64
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            v.push((
                format!("{bundle_path}/screenshot-boxes.jpg"),
                format!("beetle: bounding-box screenshot for {bundle_path}"),
                boxes.to_string(),
            ));
        }
        let fixture_str =
            serde_json::to_string_pretty(&req.fixture).unwrap_or_else(|_| "{}".into());
        v.push((
            format!("{bundle_path}/fixture.json"),
            format!("beetle: fixture for {bundle_path}"),
            BASE64.encode(fixture_str.as_bytes()),
        ));
        let context_str = serde_json::to_string_pretty(&context).unwrap_or_else(|_| "{}".into());
        v.push((
            format!("{bundle_path}/context.json"),
            format!("beetle: context for {bundle_path} (#{})", issue.number),
            BASE64.encode(context_str.as_bytes()),
        ));
        v
    };

    let repo_owned = repo.to_string();
    let token_owned = token.to_string();
    let bundle_for_log = bundle_path.clone();
    let issue_number = issue.number;
    tokio::spawn(async move {
        let client = Client::new();
        for (path, message, content_b64) in files {
            if let Err((status, err)) = put_file(
                &client,
                &repo_owned,
                &token_owned,
                &path,
                &message,
                &content_b64,
            )
            .await
            {
                // The issue already exists and links here, so a failure leaves a
                // dead link rather than losing the report. Say so loudly — a
                // silent partial bundle is the thing that wastes triage time.
                tracing::error!(
                    event = "beetle_bundle_write_failed",
                    issue = issue_number, path = %path, status = %status,
                    "{err}"
                );
            }
        }
        tracing::info!(
            event = "beetle_bundle_written",
            issue = issue_number, bundle = %bundle_for_log,
            "bundle committed"
        );
    });

    tracing::info!(
        event = "beetle_report_filed",
        issue = issue.number, bundle = %bundle_path,
        "{}", issue.html_url
    );
    Ok(Json(BugReportResponse {
        success: true,
        issue_url: issue.html_url,
        issue_number: issue.number,
        bundle_path,
    }))
}

// ── GitHub helpers ───────────────────────────────────────────────────────────

/// Create one file via the Contents API (one commit). `content` is already
/// base64. There is no update path: each bundle writes to a fresh timestamped
/// directory, and the back-ref commit that once needed a blob sha is gone —
/// the issue link is folded into context.json before its single write.
async fn put_file(
    client: &Client,
    repo: &str,
    token: &str,
    path: &str,
    message: &str,
    content_b64: &str,
) -> Result<(), (StatusCode, String)> {
    let body = json!({
        "message": message,
        "content": content_b64,
        "branch": "main",
    });
    let url = format!("https://api.github.com/repos/{repo}/contents/{path}");
    let resp = client
        .put(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", UA)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("GitHub contents request failed: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                "Could not reach the artifacts repo".to_string(),
            )
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("GitHub contents API error: {} - {}", status, text);
        return Err((
            StatusCode::BAD_GATEWAY,
            "The artifacts repo rejected the bundle".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct IssueResponse {
    html_url: String,
    number: i64,
}

async fn create_issue(
    client: &Client,
    repo: &str,
    token: &str,
    title: &str,
    body: &str,
    labels: Vec<String>,
) -> Result<IssueResponse, (StatusCode, String)> {
    let url = format!("https://api.github.com/repos/{repo}/issues");
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", UA)
        .json(&json!({ "title": title, "body": body, "labels": labels }))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("GitHub issue request failed: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                "Could not reach the issue tracker".to_string(),
            )
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("GitHub issue API error: {} - {}", status, text);
        return Err((
            StatusCode::BAD_GATEWAY,
            "The issue tracker rejected the report".to_string(),
        ));
    }
    resp.json::<IssueResponse>().await.map_err(|e| {
        tracing::error!("Could not parse GitHub issue response: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            "Unexpected response from the issue tracker".to_string(),
        )
    })
}

// ── body / title / labels ────────────────────────────────────────────────────

struct BugBody<'a> {
    note: &'a str,
    env: &'a Value,
    layout: &'a Value,
    reporter_name: Option<&'a str>,
    contact_email: Option<&'a str>,
    repo: &'a str,
    bundle_path: &'a str,
    screenshot_url: Option<&'a str>,
    screenshot_boxes_url: Option<&'a str>,
}

fn build_title(note: &str, reporter_name: Option<&str>, is_feature: bool) -> String {
    let prefix = if is_feature { "Feature" } else { "Bug" };
    let head = truncate(note.lines().next().unwrap_or(note).trim(), 80);
    match reporter_name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => format!("{prefix}: {head} (from {name})"),
        None => format!("{prefix}: {head}"),
    }
}

fn build_labels(env: &Value, is_feature: bool) -> Vec<String> {
    let mut labels = vec![if is_feature { FEATURE_LABEL } else { BUG_LABEL }.to_string()];
    if let Some(app) = env
        .get("app")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        labels.push(format!("app:{app}"));
    }
    if let Some(engine) = env
        .get("engine")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        labels.push(format!("engine:{engine}"));
    }
    if let Some(phase) = env
        .get("phase")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        labels.push(format!("phase:{phase}"));
    }
    labels
}

/// The top-of-issue reporter line. Explicit in every case: an anonymous report
/// (the beetle's default) says so, rather than silently omitting identity, so a
/// triager can't mistake it for a name that got lost. Rendered as a blockquote
/// to set it apart from the reporter's own narrative that follows.
fn reporter_banner(reporter_name: Option<&str>, contact_email: Option<&str>) -> String {
    let name = reporter_name.map(str::trim).filter(|n| !n.is_empty());
    let email = contact_email.map(str::trim).filter(|e| !e.is_empty());
    let line = match (name, email) {
        (Some(n), Some(e)) => format!("**Reported by:** {n} · {e}"),
        (Some(n), None) => format!("**Reported by:** {n} _(no contact provided)_"),
        // No opt-in name but a contact email (contactable without a display name).
        (None, Some(e)) => format!("**Reported by:** _(no name)_ · {e}"),
        (None, None) => "🕵️ **Anonymous report** — no name or contact provided.".to_string(),
    };
    format!("> {line}\n\n")
}

fn build_issue_body(b: &BugBody) -> String {
    let mut out = String::new();

    // Reporter banner — ALWAYS present, at the very top, so triage can tell an
    // anonymous report (the default) apart from one that merely lacks a name.
    // Email appears only when the reporter opted in to contact; it lives in the
    // issue body only, never in a committed file (scrubbed elsewhere).
    out.push_str(&reporter_banner(b.reporter_name, b.contact_email));

    out.push_str(b.note);
    out.push_str("\n\n---\n\n");

    // Environment table — every field a triage axis (searchable).
    out.push_str("\n| Field | Value |\n|---|---|\n");
    for (k, v) in env_rows(b.env) {
        out.push_str(&format!("| {k} | {v} |\n"));
    }

    if let Some(url) = b.screenshot_url {
        out.push_str(&format!(
            "\n**Screenshot** (approximate rendering):\n\n![screenshot]({url})\n"
        ));
    }

    // The layout X-ray: the same view re-captured with the arranger's bounding-box
    // overlay on, plus a dashed line marking the viewport fold — so what fell
    // off-screen (the reporter's actual complaint on a clipped layout) is visible on
    // an otherwise full-page render. Only present on grid layouts.
    if let Some(url) = b.screenshot_boxes_url {
        out.push_str(&format!(
            "\n**Screenshot — bounding boxes + viewport fold** (region outlines; dashed line = bottom of the reporter's screen, anything below it was off-screen):\n\n![screenshot-boxes]({url})\n"
        ));
    }

    // Layout forensics — the highest-signal geometry, collapsed. The full block
    // (all anchors) lives in context.json; here we surface the shrink-wrap/scope
    // story a triager needs at a glance.
    out.push_str(&build_layout_section(b.layout));

    let base = format!("https://github.com/{}/tree/main/{}", b.repo, b.bundle_path);
    out.push_str(&format!(
        "\n**Bundle:** [{path}]({base}) · \
         [context.json](https://github.com/{repo}/blob/main/{path}/context.json) · \
         [fixture.json](https://github.com/{repo}/blob/main/{path}/fixture.json)\n",
        path = b.bundle_path,
        repo = b.repo,
        base = base,
    ));
    out.push_str("\n_Filed from the in-app bug-report beetle._");
    out
}

/// Preferred display order for the well-known env fields.
const ENV_ORDER: &[&str] = &[
    "app",
    "route",
    "commit",
    "version",
    "engine",
    "phase",
    "arrangement",
    "tableScale",
    "browser",
    "platform",
    "platformVersion",
    "architecture",
    "model",
    "language",
    "timezone",
    "connection",
    "timestamp",
];

/// Flatten the env block into `(label, value)` rows for the issue table: the
/// known fields first (in ENV_ORDER), then any *other* scalar fields the client
/// sent — so new env fields show up automatically without a backend change.
fn env_rows(env: &Value) -> Vec<(String, String)> {
    let mut rows = Vec::new();
    for key in ENV_ORDER {
        push_scalar(&mut rows, key, env.get(*key));
    }
    // viewport is composite → render it explicitly.
    let dpr = env
        .get("viewport")
        .and_then(|v| v.get("dpr"))
        .and_then(Value::as_f64);
    if let Some(vp) = env.get("viewport") {
        let w = vp.get("w").and_then(Value::as_i64);
        let h = vp.get("h").and_then(Value::as_i64);
        if let (Some(w), Some(h)) = (w, h) {
            let dpr_s = dpr.map(|d| format!("@{d}")).unwrap_or_default();
            // Surface a non-100% browser zoom inline — it shrinks the effective
            // viewport and is a prime layout-clip cause, so make it jump out (100%
            // is the norm and stays silent to keep the row clean).
            let zoom_s = vp
                .get("zoom")
                .and_then(Value::as_i64)
                .filter(|z| *z != 100)
                .map(|z| format!(" · zoom {z}%"))
                .unwrap_or_default();
            rows.push(("viewport".to_string(), format!("{w}×{h}{dpr_s}{zoom_s}")));
        }
    }
    // screen/window is composite too → logical display size, physical resolution
    // (logical × dpr), OS work area, the browser window frame, and orientation. The
    // gap between screen.h and viewport.h is the "small window vs small display" tell.
    if let Some(sc) = env.get("screen") {
        let g = |k: &str| sc.get(k).and_then(Value::as_i64);
        if let (Some(w), Some(h)) = (g("w"), g("h")) {
            let mut parts = vec![format!("{w}×{h}")];
            if let Some(dpr) = dpr {
                let pw = (w as f64 * dpr).round() as i64;
                let ph = (h as f64 * dpr).round() as i64;
                parts.push(format!("{pw}×{ph} physical"));
            }
            if let (Some(aw), Some(ah)) = (g("availW"), g("availH")) {
                parts.push(format!("avail {aw}×{ah}"));
            }
            rows.push(("screen".to_string(), parts.join(" · ")));
        }
        if let (Some(ow), Some(oh)) = (g("outerW"), g("outerH")) {
            rows.push(("window".to_string(), format!("{ow}×{oh}")));
        }
        if let Some(o) = sc
            .get("orientation")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            rows.push(("orientation".to_string(), o.to_string()));
        }
    }
    // Catch-all: any remaining scalar fields not already shown (future-proofing).
    if let Value::Object(map) = env {
        for (k, v) in map {
            if k == "viewport" || k == "screen" || k == "ua" || ENV_ORDER.contains(&k.as_str()) {
                continue;
            }
            push_scalar(&mut rows, k, Some(v));
        }
    }
    rows
}

/// Max anchor rows rendered inline; the rest stay in context.json.
const LAYOUT_ANCHOR_CAP: usize = 10;

/// Render the highest-signal layout forensics as a collapsed `<details>`: the
/// primary hand-box ancestry (widths + min-width + Vue scope flag — the
/// shrink-wrap/dead-`:deep()` story) and a capped anchor table. Empty string
/// when there's no layout block (legacy a1, or no table on screen).
fn build_layout_section(layout: &Value) -> String {
    let anchors = layout.get("anchors").and_then(Value::as_array);
    let ancestry = layout.get("ancestry").and_then(Value::as_array);
    let has_anchors = anchors.is_some_and(|a| !a.is_empty());
    let has_ancestry = ancestry.is_some_and(|a| !a.is_empty());
    if !has_anchors && !has_ancestry {
        return String::new();
    }

    let n = anchors.map_or(0, |a| a.len());
    let mut s = format!("\n<details><summary>Layout — {n} anchors</summary>\n\n");

    if let Some(chain) = ancestry.filter(|c| !c.is_empty()) {
        s.push_str("**Primary hand-box ancestry** (scope = carries `data-v-*`):\n\n");
        s.push_str("| Element | width | min-width | scoped |\n|---|---|---|---|\n");
        for lvl in chain {
            s.push_str(&format!(
                "| `{}` | {} | {} | {} |\n",
                lvl.get("sel").and_then(Value::as_str).unwrap_or("?"),
                num_or_dash(lvl.get("w")),
                lvl.get("minW").and_then(Value::as_str).unwrap_or(""),
                lvl.get("scoped")
                    .and_then(Value::as_bool)
                    .map(|b| if b { "yes" } else { "**no**" })
                    .unwrap_or(""),
            ));
        }
        s.push('\n');
    }

    if let Some(list) = anchors.filter(|a| !a.is_empty()) {
        s.push_str("**Anchors:**\n\n| Selector | width | min-width | vars |\n|---|---|---|---|\n");
        for a in list.iter().take(LAYOUT_ANCHOR_CAP) {
            s.push_str(&format!(
                "| `{}` | {} | {} | {} |\n",
                a.get("sel").and_then(Value::as_str).unwrap_or("?"),
                num_or_dash(a.get("w")),
                a.get("minW").and_then(Value::as_str).unwrap_or(""),
                fmt_vars(a.get("vars")),
            ));
        }
        if list.len() > LAYOUT_ANCHOR_CAP {
            s.push_str(&format!(
                "\n_(+{} more in context.json)_\n",
                list.len() - LAYOUT_ANCHOR_CAP
            ));
        }
    }

    s.push_str("\n</details>\n");
    s
}

/// A JSON number as a compact string (integers without a trailing `.0`), or `–`.
fn num_or_dash(v: Option<&Value>) -> String {
    match v.and_then(Value::as_f64) {
        Some(n) if n.fract() == 0.0 => format!("{}", n as i64),
        Some(n) => format!("{n}"),
        None => "–".to_string(),
    }
}

/// The layout vars object (`{ts, ss, rs}`) as `ts=1.25 ss=0.65`, in a fixed
/// meaningful order (not serde's alphabetical), else empty.
fn fmt_vars(v: Option<&Value>) -> String {
    let m = match v.and_then(Value::as_object) {
        Some(m) if !m.is_empty() => m,
        _ => return String::new(),
    };
    let known = ["ts", "ss", "rs"];
    let mut parts: Vec<String> = known
        .iter()
        .filter_map(|k| {
            m.get(*k)
                .map(|val| format!("{k}={}", val.as_str().unwrap_or("")))
        })
        .collect();
    // Any unexpected keys, appended so nothing is silently dropped.
    for (k, val) in m {
        if !known.contains(&k.as_str()) {
            parts.push(format!("{k}={}", val.as_str().unwrap_or("")));
        }
    }
    parts.join(" ")
}

fn push_scalar(rows: &mut Vec<(String, String)>, key: &str, v: Option<&Value>) {
    if let Some(v) = v {
        let s = match v {
            Value::String(s) => s.clone(),
            Value::Null => return,
            other => other.to_string(),
        };
        if !s.is_empty() {
            rows.push((key.to_string(), s));
        }
    }
}

// ── sanitize / util ──────────────────────────────────────────────────────────

/// Recursively remove obvious email carriers so a committed file never holds
/// contact info even if the client embedded it. Belt-and-suspenders — the
/// frontend already keeps email out of `context`.
fn scrub_emails(v: &mut Value) {
    match v {
        Value::Object(map) => {
            map.remove("email");
            map.remove("contact_email");
            map.remove("contactEmail");
            for (_, val) in map.iter_mut() {
                scrub_emails(val);
            }
        }
        Value::Array(arr) => arr.iter_mut().for_each(scrub_emails),
        _ => {}
    }
}

fn slugify(s: &str) -> String {
    let slug: String = s
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    let mut out = String::new();
    let mut prev_dash = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_dash {
                out.push('-');
            }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
        if out.chars().count() >= 40 {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "report".to_string()
    } else {
        out
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn slugify_kebabs_and_bounds() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("   "), "report");
        assert!(slugify(&"x".repeat(100)).chars().count() <= 40);
        assert_eq!(slugify("a---b"), "a-b");
    }

    #[test]
    fn scrub_removes_emails_at_any_depth() {
        let mut v = json!({
            "email": "a@b.com",
            "env": { "contact_email": "c@d.com", "app": "a1" },
            "list": [{ "contactEmail": "e@f.com" }]
        });
        scrub_emails(&mut v);
        assert!(v.get("email").is_none());
        assert!(v["env"].get("contact_email").is_none());
        assert_eq!(v["env"]["app"], "a1");
        assert!(v["list"][0].get("contactEmail").is_none());
    }

    #[test]
    fn reporter_banner_is_explicit_in_every_case() {
        // Anonymous (the default) is stated outright, not silently omitted.
        let anon = reporter_banner(None, None);
        assert!(anon.starts_with("> "));
        assert!(anon.contains("Anonymous report"));

        // Name only.
        let named = reporter_banner(Some("Terry Lee"), None);
        assert!(named.contains("**Reported by:** Terry Lee"));
        assert!(named.contains("no contact provided"));

        // Name + contact email.
        let full = reporter_banner(Some("Terry Lee"), Some("t@example.com"));
        assert!(full.contains("**Reported by:** Terry Lee · t@example.com"));

        // Contactable without a display name.
        let email_only = reporter_banner(None, Some("t@example.com"));
        assert!(email_only.contains("**Reported by:**"));
        assert!(email_only.contains("t@example.com"));
        assert!(!email_only.contains("Anonymous"));

        // Blank/whitespace is treated as absent.
        assert!(reporter_banner(Some("   "), Some("  ")).contains("Anonymous report"));
    }

    #[test]
    fn body_leads_with_reporter_banner_then_note() {
        let env = json!({ "app": "a1" });
        let anon = BugBody {
            note: "hand overlaps",
            env: &env,
            layout: &Value::Null,
            screenshot_url: None,
            screenshot_boxes_url: None,
            reporter_name: None,
            contact_email: None,
            repo: "o/r",
            bundle_path: "2026/07/x",
        };
        let out = build_issue_body(&anon);
        assert!(
            out.starts_with("> 🕵️ **Anonymous report**"),
            "got: {}",
            &out[..out.len().min(60)]
        );
        // Banner precedes the reporter's narrative.
        assert!(out.find("Anonymous report").unwrap() < out.find("hand overlaps").unwrap());
    }

    #[test]
    fn title_includes_name_and_kind() {
        assert_eq!(
            build_title("hand overlaps", Some("Rick W"), false),
            "Bug: hand overlaps (from Rick W)"
        );
        assert_eq!(
            build_title("hand overlaps", None, false),
            "Bug: hand overlaps"
        );
        assert_eq!(
            build_title("hand overlaps", Some("  "), false),
            "Bug: hand overlaps"
        );
        assert_eq!(
            build_title("dark mode please", None, true),
            "Feature: dark mode please"
        );
        assert_eq!(
            build_title("dark mode", Some("Rick W"), true),
            "Feature: dark mode (from Rick W)"
        );
    }

    #[test]
    fn labels_derive_from_env_and_kind() {
        let env = json!({ "app": "a1", "engine": "local", "phase": "play" });
        assert_eq!(
            build_labels(&env, false),
            vec!["bug-report", "app:a1", "engine:local", "phase:play"]
        );
        assert_eq!(build_labels(&json!({}), false), vec!["bug-report"]);
        assert_eq!(
            build_labels(&json!({ "app": "a1" }), true),
            vec!["feature-request", "app:a1"]
        );
    }

    #[test]
    fn env_rows_render_viewport() {
        let env =
            json!({ "app": "a1", "viewport": { "w": 800, "h": 600, "dpr": 2.0, "zoom": 100 } });
        let rows = env_rows(&env);
        // 100% zoom stays silent (the norm).
        assert!(rows
            .iter()
            .any(|(k, v)| k == "viewport" && v == "800×600@2"));
        assert!(rows.iter().any(|(k, v)| k == "app" && v == "a1"));
    }

    #[test]
    fn env_rows_surface_non_default_zoom() {
        let env = json!({ "viewport": { "w": 800, "h": 600, "dpr": 1.6, "zoom": 80 } });
        let rows = env_rows(&env);
        assert!(rows
            .iter()
            .any(|(k, v)| k == "viewport" && v == "800×600@1.6 · zoom 80%"));
    }

    #[test]
    fn env_rows_render_screen_and_window() {
        let env = json!({
            "viewport": { "w": 1672, "h": 859, "dpr": 2.0 },
            "screen": {
                "w": 1920, "h": 1080, "availW": 1920, "availH": 1055,
                "outerW": 1680, "outerH": 1010, "orientation": "landscape-primary"
            }
        });
        let rows = env_rows(&env);
        let val = |k: &str| rows.iter().find(|(rk, _)| rk == k).map(|(_, v)| v.as_str());
        // Logical size · physical (logical × dpr) · work area, all on one row.
        assert_eq!(
            val("screen"),
            Some("1920×1080 · 3840×2160 physical · avail 1920×1055")
        );
        // The browser window frame is its own row (small window on a big display).
        assert_eq!(val("window"), Some("1680×1010"));
        assert_eq!(val("orientation"), Some("landscape-primary"));
        // Not leaked through the scalar catch-all as raw JSON.
        assert!(!rows.iter().any(|(_, v)| v.contains('{')));
    }

    #[test]
    fn env_rows_screen_survives_missing_fields() {
        // A runtime that exposes only logical size (no avail/outer/orientation).
        let env = json!({ "viewport": { "w": 800, "h": 600 }, "screen": { "w": 1280, "h": 800 } });
        let rows = env_rows(&env);
        let val = |k: &str| rows.iter().find(|(rk, _)| rk == k).map(|(_, v)| v.as_str());
        assert_eq!(val("screen"), Some("1280×800")); // no dpr → no physical; no avail
        assert!(val("window").is_none());
    }

    #[test]
    fn layout_section_renders_ancestry_and_capped_anchors() {
        let layout = json!({
            "anchors": (0..14).map(|i| json!({ "sel": format!("div.a{i}"), "w": 119.0, "minW": "240px" })).collect::<Vec<_>>(),
            "ancestry": [
                { "sel": "div.holding", "w": 119.0, "minW": "none", "scoped": true },
                { "sel": "div.practice-left", "w": 119.0, "minW": "240px", "scoped": false }
            ],
            "truncated": false
        });
        let s = build_layout_section(&layout);
        assert!(s.contains("<details><summary>Layout — 14 anchors</summary>"));
        assert!(s.contains("div.holding"));
        assert!(s.contains("| 119 | 240px | **no** |")); // dead min-width + unscoped container = the tell
        assert!(s.contains("(+4 more in context.json)")); // 14 anchors, cap 10
        assert!(s.contains("</details>"));
    }

    #[test]
    fn layout_section_empty_without_layout() {
        assert_eq!(build_layout_section(&Value::Null), "");
        assert_eq!(build_layout_section(&json!({ "anchors": [] })), "");
    }

    #[test]
    fn fmt_vars_and_num_or_dash() {
        assert_eq!(
            fmt_vars(Some(&json!({ "ts": "1.25", "ss": "0.65" }))),
            "ts=1.25 ss=0.65"
        );
        assert_eq!(fmt_vars(Some(&json!({}))), "");
        assert_eq!(fmt_vars(None), "");
        assert_eq!(num_or_dash(Some(&json!(119.0))), "119");
        assert_eq!(num_or_dash(Some(&json!(119.5))), "119.5");
        assert_eq!(num_or_dash(None), "–");
    }

    #[test]
    fn env_rows_render_new_fields_and_catch_all() {
        let env = json!({
            "app": "a1", "browser": "Chrome 150", "platform": "macOS",
            "architecture": "arm/64", "language": "en-US", "timezone": "America/Los_Angeles",
            "ua": "Mozilla/5.0 ...long...", "somethingNew": "future"
        });
        let rows = env_rows(&env);
        let has = |k: &str, v: &str| rows.iter().any(|(rk, rv)| rk == k && rv == v);
        assert!(has("browser", "Chrome 150"));
        assert!(has("platform", "macOS"));
        assert!(has("architecture", "arm/64"));
        assert!(has("language", "en-US"));
        assert!(has("timezone", "America/Los_Angeles"));
        // Unknown field rendered via catch-all; raw `ua` deliberately omitted.
        assert!(has("somethingNew", "future"));
        assert!(!rows.iter().any(|(k, _)| k == "ua"));
    }
}
