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

    // 1) Commit screenshot + fixture + context (raw URLs are stable once the
    //    files exist on `main`, so the issue body can reference them).
    if let Some(shot) = req.screenshot_base64.as_deref().filter(|s| !s.is_empty()) {
        put_file(
            &client,
            repo,
            token,
            &format!("{bundle_path}/screenshot.jpg"),
            &format!("beetle: screenshot for {bundle_path}"),
            shot, // already base64
            None,
        )
        .await?;
    }
    let fixture_str = serde_json::to_string_pretty(&req.fixture).unwrap_or_else(|_| "{}".into());
    put_file(
        &client,
        repo,
        token,
        &format!("{bundle_path}/fixture.json"),
        &format!("beetle: fixture for {bundle_path}"),
        &BASE64.encode(fixture_str.as_bytes()),
        None,
    )
    .await?;
    let context_str = serde_json::to_string_pretty(&context).unwrap_or_else(|_| "{}".into());
    let context_put = put_file(
        &client,
        repo,
        token,
        &format!("{bundle_path}/context.json"),
        &format!("beetle: context for {bundle_path}"),
        &BASE64.encode(context_str.as_bytes()),
        None,
    )
    .await?;

    // 2) File the issue in the SAME repo (inline screenshot renders off session).
    let shot_url = req
        .screenshot_base64
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(|_| {
            format!("https://github.com/{repo}/blob/main/{bundle_path}/screenshot.jpg?raw=true")
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
    });
    let labels = build_labels(&env, is_feature);

    let issue = create_issue(&client, repo, token, &title, &body, labels).await?;

    // 3) Back-reference: write the issue number into context.json (micro-commit).
    if let Value::Object(ref mut map) = context {
        map.insert(
            "issue".to_string(),
            json!({ "number": issue.number, "url": issue.html_url }),
        );
    }
    let updated = serde_json::to_string_pretty(&context).unwrap_or(context_str);
    let _ = put_file(
        &client,
        repo,
        token,
        &format!("{bundle_path}/context.json"),
        &format!("beetle: link context to #{}", issue.number),
        &BASE64.encode(updated.as_bytes()),
        context_put.content.sha.as_deref(),
    )
    .await; // best-effort: the report already succeeded; a failed back-ref isn't fatal

    tracing::info!(
        "Filed beetle bug report #{} ({})",
        issue.number,
        issue.html_url
    );
    Ok(Json(BugReportResponse {
        success: true,
        issue_url: issue.html_url,
        issue_number: issue.number,
        bundle_path,
    }))
}

// ── GitHub helpers ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct PutContent {
    sha: Option<String>,
}
#[derive(Debug, Deserialize)]
struct PutResponse {
    content: PutContent,
}

/// Create/update one file via the Contents API (one commit). `content` is
/// already base64. Pass `sha` to update an existing file.
async fn put_file(
    client: &Client,
    repo: &str,
    token: &str,
    path: &str,
    message: &str,
    content_b64: &str,
    sha: Option<&str>,
) -> Result<PutResponse, (StatusCode, String)> {
    let mut body = json!({
        "message": message,
        "content": content_b64,
        "branch": "main",
    });
    if let Some(sha) = sha {
        body["sha"] = json!(sha);
    }
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
    resp.json::<PutResponse>().await.map_err(|e| {
        tracing::error!("Could not parse GitHub contents response: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            "Unexpected response from the artifacts repo".to_string(),
        )
    })
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

fn build_issue_body(b: &BugBody) -> String {
    let mut out = String::new();
    out.push_str(b.note);
    out.push_str("\n\n---\n\n");

    // Identity (name and — only if contactable — email; email never committed).
    if let Some(name) = b.reporter_name.map(str::trim).filter(|n| !n.is_empty()) {
        out.push_str(&format!("**Reported by:** {name}\n"));
    }
    if let Some(email) = b.contact_email.map(str::trim).filter(|e| !e.is_empty()) {
        out.push_str(&format!("**Contact:** {email}\n"));
    }

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
    if let Some(vp) = env.get("viewport") {
        let w = vp.get("w").and_then(Value::as_i64);
        let h = vp.get("h").and_then(Value::as_i64);
        let dpr = vp.get("dpr").and_then(Value::as_f64);
        if let (Some(w), Some(h)) = (w, h) {
            let dpr = dpr.map(|d| format!("@{d}")).unwrap_or_default();
            rows.push(("viewport".to_string(), format!("{w}×{h}{dpr}")));
        }
    }
    // Catch-all: any remaining scalar fields not already shown (future-proofing).
    if let Value::Object(map) = env {
        for (k, v) in map {
            if k == "viewport" || k == "ua" || ENV_ORDER.contains(&k.as_str()) {
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
        let env = json!({ "app": "a1", "viewport": { "w": 800, "h": 600, "dpr": 2.0 } });
        let rows = env_rows(&env);
        assert!(rows
            .iter()
            .any(|(k, v)| k == "viewport" && v == "800×600@2"));
        assert!(rows.iter().any(|(k, v)| k == "app" && v == "a1"));
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
