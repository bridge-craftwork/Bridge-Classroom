use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::AppState;

/// Validate API key from the `x-api-key` header.
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

/// A learner-filed "Report a Problem" submission from a coached lesson.
///
/// The frontend captures the board state it already has while rendering, plus
/// the learner's free-text note. Everything is optional except `note` so the
/// endpoint stays forgiving as the lesson view evolves.
#[derive(Debug, Deserialize)]
pub struct ReportRequest {
    /// The learner's free-text description of the problem.
    pub note: String,

    // --- Lesson / board identity ---
    pub collection: Option<String>,
    pub lesson_id: Option<String>,
    pub lesson_name: Option<String>,
    /// The PBN [Event] tag (usually equal to lesson_id).
    pub scenario: Option<String>,
    /// The deal as a PBN string — the stable key (board numbers drift on re-curation).
    pub deal_pbn: Option<String>,
    /// 1-based position in the loaded lesson (what the UI labels "Deal N").
    pub display_number: Option<i64>,
    /// The PBN [Board] tag value.
    pub board_tag: Option<String>,
    /// The PBN [OriginalBoard] tag value.
    pub original_board: Option<String>,
    /// Opaque, rotation-independent board-version token from the PBN
    /// (ADR-0001, Contract C6). Bridge Classroom never computes or compares it;
    /// it is passed through so the producer can locate the reported deal across
    /// its rotational variants and other files. Optional — null until the PBNs
    /// carry the token.
    pub board_version_token: Option<String>,

    // --- Auction / play context ---
    pub student_seat: Option<String>,
    #[serde(default)]
    pub auction: Vec<String>,
    pub contract: Option<String>,
    pub step_index: Option<i64>,
    pub prompt: Option<String>,

    // --- Provenance ---
    /// learner | reviewer (defaults to learner).
    pub reporter_tier: Option<String>,
    /// The name the reporter chose to attach — defaults to their registration
    /// first name but may be a self-chosen alias. Sent only when the learner
    /// opts OUT of anonymity. Never an email or last name — contact details are
    /// kept out of the public content repo. Absent ⇒ anonymous report.
    pub reporter_name: Option<String>,
    pub source_url: Option<String>,
    pub source_commit: Option<String>,
    pub app_version: Option<String>,
    pub app_commit: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReportResponse {
    pub success: bool,
    pub issue_url: String,
    pub issue_number: i64,
}

/// Body for the GitHub "create an issue" call.
#[derive(Debug, Serialize)]
struct GitHubIssueRequest {
    title: String,
    body: String,
    labels: Vec<String>,
}

/// The slice of GitHub's create-issue response we care about.
#[derive(Debug, Deserialize)]
struct GitHubIssueResponse {
    html_url: String,
    number: i64,
}

const FEEDBACK_LABEL: &str = "classroom-feedback";

/// Map a lesson collection to the GitHub repo that owns its content, so a report
/// files an issue where the maintainer will see it. The client sends an opaque
/// collection id (never a repo slug), so this mapping is the only authority on
/// where issues land — a caller can't redirect them. All targets are in the same
/// org, reachable by the single org-scoped token. Unknown/absent → default repo.
fn repo_for_collection<'a>(collection: Option<&str>, default_repo: &'a str) -> &'a str {
    match collection {
        Some("baker-bridge") => "bridge-craftwork/Baker-Bridge",
        Some("pbs-coaching") => "bridge-craftwork/Practice-Bidding-Scenarios",
        _ => default_repo,
    }
}

/// POST /api/report
///
/// Files a `classroom-feedback` GitHub issue in the content repo on behalf of a
/// learner. The GitHub token lives only in server config and is never returned
/// or logged. When no token is configured the endpoint returns 503 so the UI
/// can show "reporting isn't set up".
pub async fn create_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ReportRequest>,
) -> Result<Json<ReportResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let note = req.note.trim();
    if note.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Report note is empty".to_string()));
    }

    let token = match state.config.github_issues_token.as_deref() {
        Some(t) => t,
        None => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Reporting is not configured on this server".to_string(),
            ));
        }
    };
    // Route to the content repo that owns this collection. All target repos live
    // in the same org, so the one shared org-scoped token can file into any of
    // them. Unknown/absent collection falls back to the configured default repo.
    let repo = repo_for_collection(req.collection.as_deref(), &state.config.github_issues_repo);

    let scenario = req
        .scenario
        .as_deref()
        .or(req.lesson_id.as_deref())
        .unwrap_or("Unknown scenario");
    let deal_label = req
        .display_number
        .map(|n| n.to_string())
        .or_else(|| req.board_tag.clone())
        .unwrap_or_else(|| "?".to_string());

    // Append the reporter's chosen name/alias to the title when they opted out
    // of anonymity, so maintainers can see who reported at a glance. Never an
    // email — only the name attached to the report.
    let reporter_suffix = req
        .reporter_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| format!(" (from {})", n))
        .unwrap_or_default();

    let title = format!(
        "Classroom report: {} · Deal {}{}",
        scenario, deal_label, reporter_suffix
    );
    let body = build_issue_body(&req, note);

    let issue_req = GitHubIssueRequest {
        title,
        body,
        labels: vec![FEEDBACK_LABEL.to_string()],
    };

    let client = Client::new();
    let url = format!("https://api.github.com/repos/{}/issues", repo);
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        // GitHub requires a User-Agent on every REST request.
        .header("User-Agent", "bridge-classroom-report")
        .json(&issue_req)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("GitHub issue request failed: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                "Could not reach the issue tracker".to_string(),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        // Log the GitHub error but never the token.
        tracing::error!("GitHub issue API error: {} - {}", status, error_text);
        return Err((
            StatusCode::BAD_GATEWAY,
            "The issue tracker rejected the report".to_string(),
        ));
    }

    let issue: GitHubIssueResponse = response.json().await.map_err(|e| {
        tracing::error!("Could not parse GitHub issue response: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            "Unexpected response from the issue tracker".to_string(),
        )
    })?;

    tracing::info!(
        "Filed classroom-feedback issue #{} ({})",
        issue.number,
        issue.html_url
    );

    Ok(Json(ReportResponse {
        success: true,
        issue_url: issue.html_url,
        issue_number: issue.number,
    }))
}

/// Render the captured state into a readable Markdown body: the learner's note
/// first, then a context block, then the deal PBN as a code block.
fn build_issue_body(req: &ReportRequest, note: &str) -> String {
    let mut ctx: Vec<String> = Vec::new();

    let tier = req.reporter_tier.as_deref().unwrap_or("learner");
    ctx.push(format!("- **Reporter:** {}", tier));

    // First name / alias, only when the reporter opted out of anonymity. Never
    // their email — contact info is intentionally absent from the public repo.
    if let Some(name) = req
        .reporter_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        ctx.push(format!("- **Reported by:** {}", name));
    }

    if let Some(scenario) = req.scenario.as_deref().or(req.lesson_id.as_deref()) {
        let pretty = req
            .lesson_name
            .as_deref()
            .filter(|n| !n.is_empty() && *n != scenario)
            .map(|n| format!(" ({})", n))
            .unwrap_or_default();
        ctx.push(format!("- **Scenario:** {}{}", scenario, pretty));
    }
    if let Some(collection) = &req.collection {
        ctx.push(format!("- **Collection:** {}", collection));
    }

    // Deal identity: display number + the two board tags that pin it down.
    let mut deal_bits: Vec<String> = Vec::new();
    if let Some(n) = req.display_number {
        deal_bits.push(format!("display #{}", n));
    }
    if let Some(b) = &req.board_tag {
        deal_bits.push(format!("[Board] {}", b));
    }
    if let Some(ob) = &req.original_board {
        deal_bits.push(format!("[OriginalBoard] {}", ob));
    }
    if !deal_bits.is_empty() {
        ctx.push(format!("- **Deal:** {}", deal_bits.join(" · ")));
    }

    // Rotation-independent board-version token (ADR-0001 C6): a quick equality
    // check for "is the reported deal still the one in the repo" and the search
    // key when position has shifted or the deal appears in other rotations.
    if let Some(token) = req.board_version_token.as_deref().filter(|t| !t.is_empty()) {
        ctx.push(format!("- **Board-version token:** `{}`", token));
    }

    if let Some(seat) = &req.student_seat {
        ctx.push(format!("- **Student seat:** {}", seat));
    }
    if let Some(contract) = &req.contract {
        if !contract.is_empty() {
            ctx.push(format!("- **Contract:** {}", contract));
        }
    }
    if !req.auction.is_empty() {
        ctx.push(format!("- **Auction so far:** {}", req.auction.join(" – ")));
    }
    if let Some(idx) = req.step_index {
        let prompt = req
            .prompt
            .as_deref()
            .map(|p| format!(" — “{}”", truncate(p, 280)))
            .unwrap_or_default();
        ctx.push(format!("- **Step:** index {}{}", idx, prompt));
    }
    if let Some(src) = &req.source_url {
        ctx.push(format!("- **Source:** {}", src));
    }
    if let Some(sc) = &req.source_commit {
        ctx.push(format!("- **Source commit:** {}", sc));
    }
    if req.app_version.is_some() || req.app_commit.is_some() {
        let v = req.app_version.as_deref().unwrap_or("?");
        let c = req
            .app_commit
            .as_deref()
            .map(|c| format!(" (commit {})", c))
            .unwrap_or_default();
        ctx.push(format!("- **App:** v{}{}", v, c));
    }

    let deal_block = req
        .deal_pbn
        .as_deref()
        .filter(|p| !p.is_empty())
        .map(|p| format!("\n\n**Deal (PBN):**\n```\n{}\n```", p))
        .unwrap_or_default();

    format!(
        "{note}\n\n---\n\n{context}{deal}\n\n_Filed automatically from the Bridge Classroom “Report a Problem” button._",
        note = note,
        context = ctx.join("\n"),
        deal = deal_block,
    )
}

/// Truncate a string to at most `max` chars, appending an ellipsis when cut.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}
