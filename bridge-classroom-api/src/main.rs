use axum::{
    http::{header, Method},
    routing::{delete, get, patch, post, put},
    Router,
};
use sqlx::{Pool, Sqlite};
use std::sync::Arc;
use std::time::Instant;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod db;
mod models;
mod obs_crypto;
mod routes;
mod student_summary;

use config::Config;

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub db: Pool<Sqlite>,
    pub config: Arc<Config>,
    pub started_at: Instant,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "bridge_classroom_api=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration
    let config = Config::from_env()?;
    tracing::info!("Loaded configuration");

    // Initialize database. The v2 backfill (CORRECTNESS_AND_MASTERY.md
    // §16) runs inside run_migrations and handles populating
    // board_status and student_summary from existing observations.
    let db = db::init_db(&config.database_url).await?;
    tracing::info!("Database initialized");

    // Build CORS layer
    let cors = build_cors_layer(&config);

    // Create application state
    let state = AppState {
        db,
        config: Arc::new(config.clone()),
        started_at: Instant::now(),
    };

    // Build router
    let app = Router::new()
        // Root and health check
        .route("/", get(root))
        .route("/health", get(health_check))
        // Auth routes
        .route("/api/auth/teacher", post(routes::authenticate_teacher))
        // Keys routes
        .route("/api/keys/admin", get(routes::get_admin_key))
        // User routes
        .route("/api/users", post(routes::create_user))
        .route("/api/users", get(routes::get_users))
        .route("/api/users/:user_id", get(routes::get_user))
        .route("/api/users/me", patch(routes::upgrade_role))
        // Viewer routes (teachers, partners, admin)
        .route("/api/viewers", post(routes::create_viewer))
        .route("/api/viewers", get(routes::get_viewers))
        .route(
            "/api/viewers/:viewer_id/public-key",
            get(routes::get_viewer_public_key),
        )
        // Sharing grant routes
        .route("/api/grants", post(routes::create_grant))
        .route("/api/grants", get(routes::get_grants))
        .route("/api/grants/:grant_id", delete(routes::revoke_grant))
        // Observation routes
        .route("/api/observations", post(routes::submit_observations))
        .route("/api/observations", get(routes::get_observations))
        .route(
            "/api/observations/metadata",
            get(routes::get_observations_metadata),
        )
        // Report-a-Problem route (files a classroom-feedback GitHub issue)
        .route("/api/report", post(routes::create_report))
        // Recovery routes
        .route("/api/recovery/request", post(routes::request_recovery))
        .route("/api/recovery/claim", post(routes::claim_recovery))
        .route("/api/recovery/claim-code", post(routes::claim_by_code))
        // Convention card routes
        .route("/api/cards", get(routes::list_cards))
        .route("/api/cards", post(routes::create_card))
        .route("/api/cards/:card_id", get(routes::get_card))
        .route("/api/cards/:card_id", put(routes::update_card))
        .route("/api/cards/:card_id", delete(routes::delete_card))
        .route("/api/users/:user_id/cards", get(routes::get_user_cards))
        .route("/api/users/:user_id/cards", post(routes::link_card_to_user))
        .route(
            "/api/users/:user_id/cards/:card_id",
            delete(routes::unlink_card_from_user),
        )
        // Classroom routes
        .route("/api/classrooms", post(routes::create_classroom))
        .route("/api/classrooms", get(routes::list_classrooms))
        .route("/api/classrooms/:id", get(routes::get_classroom))
        .route("/api/join/:join_code", get(routes::get_join_info))
        .route("/api/join/:join_code", post(routes::join_classroom))
        .route(
            "/api/classrooms/:id/members/:uid",
            delete(routes::remove_member),
        )
        .route(
            "/api/classrooms/:id/members/leave",
            post(routes::leave_classroom),
        )
        // Exercise routes
        .route("/api/exercises", post(routes::create_exercise).get(routes::list_exercises))
        .route(
            "/api/exercises/:id",
            get(routes::get_exercise)
                .put(routes::update_exercise)
                .delete(routes::delete_exercise),
        )
        // Assignment routes
        .route("/api/assignments", post(routes::create_assignment).get(routes::list_assignments))
        .route(
            "/api/assignments/:id",
            get(routes::get_assignment).delete(routes::delete_assignment),
        )
        // Board status routes
        .route("/api/board-status", get(routes::get_board_status))
        .route("/api/assignment-status", get(routes::get_assignment_status))
        .route("/api/student-summaries", get(routes::get_student_summaries))
        .route("/api/lesson-mastery", get(routes::get_lesson_mastery))
        // Teacher dashboard routes
        .route("/api/teacher/dashboard", get(routes::teacher_dashboard))
        .route("/api/teacher/dashboard/clear", post(routes::clear_dashboard_panel))
        // Announcement routes
        .route("/api/announcements/active", get(routes::get_active_announcement))
        .route("/api/admin/announcement", post(routes::set_announcement).delete(routes::clear_announcement))
        // Diagnostics routes
        .route("/api/diagnostics", post(routes::log_diagnostics).get(routes::log_diagnostic_get))
        // Admin routes
        .route("/api/admin/stats", get(routes::admin_stats))
        .route("/api/admin/health", get(routes::admin_health))
        .route("/api/admin/merge-dryrun", get(routes::merge_dry_run))
        .route("/api/admin/merge-accounts", post(routes::merge_accounts))
        .route("/api/account-handoff", get(routes::get_account_handoff))
        .route("/api/account-handoff/consume", post(routes::consume_account_handoff))
        .route("/api/admin/users/search", get(routes::admin_search_user))
        .route("/api/admin/users/:id", patch(routes::admin_correct_name))
        .route("/api/admin/decrypt-observations", post(routes::admin_decrypt_observations))
        .layer(cors)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &axum::http::Request<_>| {
                    let ua = request.headers()
                        .get(header::USER_AGENT)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("-");
                    tracing::info_span!(
                        "request",
                        method = %request.method(),
                        uri = %request.uri(),
                        version = ?request.version(),
                        user_agent = %ua,
                    )
                }),
        )
        .with_state(state);

    // Start server
    let addr = config.server_addr();
    tracing::info!("Starting server on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Build CORS layer from configuration
fn build_cors_layer(config: &Config) -> CorsLayer {
    let origins = config.allowed_origins.clone();

    if origins.is_empty() || origins.iter().any(|o| o == "*") {
        // Allow any origin (for development)
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE, Method::OPTIONS])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, "x-api-key".parse().unwrap()])
    } else {
        // Specific origins
        let allowed: Vec<_> = origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();

        CorsLayer::new()
            .allow_origin(allowed)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE, Method::OPTIONS])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, "x-api-key".parse().unwrap()])
    }
}

/// Health check endpoint
async fn root() -> &'static str {
    "Bridge Classroom API — an educational platform for learning the card game of bridge."
}

async fn health_check() -> &'static str {
    "OK"
}
