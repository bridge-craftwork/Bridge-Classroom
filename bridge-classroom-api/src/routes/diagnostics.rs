use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use tracing::warn;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct DiagnosticEvent {
    pub event: String,
    pub context: String,
    pub error: Option<String>,
    pub user_agent: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DiagnosticPayload {
    pub events: Vec<DiagnosticEvent>,
}

/// Query params for GET /api/diagnostics
#[derive(Debug, Deserialize)]
pub struct DiagnosticQuery {
    pub event: String,
    pub context: Option<String>,
    pub error: Option<String>,
    pub browser: Option<String>,
    pub timestamp: Option<String>,
}

/// POST /api/diagnostics — log client-side errors (batch)
/// No auth required so errors can be logged even when registration fails
pub async fn log_diagnostics(
    State(_state): State<AppState>,
    Json(body): Json<DiagnosticPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    for event in &body.events {
        warn!(
            event = %event.event,
            context = %event.context,
            error = event.error.as_deref().unwrap_or("none"),
            user_agent = event.user_agent.as_deref().unwrap_or("unknown"),
            timestamp = event.timestamp.as_deref().unwrap_or("unknown"),
            "CLIENT DIAGNOSTIC"
        );
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

/// GET /api/diagnostics — log a single client-side error via query params
/// No CORS preflight needed (simple GET request), so this works even when
/// POST requests are blocked by CORS/preflight issues.
pub async fn log_diagnostic_get(Query(params): Query<DiagnosticQuery>) -> Json<serde_json::Value> {
    warn!(
        event = %params.event,
        context = params.context.as_deref().unwrap_or("none"),
        error = params.error.as_deref().unwrap_or("none"),
        browser = params.browser.as_deref().unwrap_or("unknown"),
        timestamp = params.timestamp.as_deref().unwrap_or("unknown"),
        "CLIENT DIAGNOSTIC (GET)"
    );

    Json(serde_json::json!({ "ok": true }))
}
