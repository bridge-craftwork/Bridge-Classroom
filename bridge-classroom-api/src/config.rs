use std::env;

/// Application configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    /// Database URL (SQLite path)
    pub database_url: String,

    /// API key for authenticating requests
    pub api_key: String,

    /// Teacher's public key (base64-encoded SPKI)
    pub teacher_public_key: String,

    /// Teacher's password for dashboard access
    pub teacher_password: String,

    /// Comma-separated list of allowed CORS origins
    pub allowed_origins: Vec<String>,

    /// Server host
    pub host: String,

    /// Server port
    pub port: u16,

    /// Secret for encrypting recovery keys (optional)
    pub recovery_secret: Option<String>,

    /// Secret gating the dangerous ops-only admin endpoints (decrypt / active-time
    /// backfill). Unlike `api_key` this is NOT in the frontend bundle — it lives
    /// only in the launchd plist. When unset, those endpoints fail closed (503).
    pub admin_secret: Option<String>,

    /// Resend API key for sending emails (optional)
    pub resend_api_key: Option<String>,

    /// From email address for recovery emails
    pub from_email: String,

    /// Default GitHub token for "Report a Problem" issues (optional). Owned by
    /// the platform maintainer (Rick); files baker-bridge + default-repo reports,
    /// so those issues are authored by Rick. Scoped to Issues:write on those
    /// repos. When the selected token is unset, the endpoint degrades gracefully
    /// (503) so the UI can say so.
    pub github_issues_token: Option<String>,

    /// PBS-specific token (optional). Owned by David; files `pbs-coaching`
    /// reports so they're authored by *David* — which means GitHub doesn't email
    /// him a "new issue" notification for reports on his own content (his own
    /// action), matching the pre-multi-repo behavior. Falls back to
    /// `github_issues_token` when unset.
    pub github_issues_token_pbs: Option<String>,

    /// owner/repo that classroom-feedback issues are filed into when the
    /// collection is unknown/absent (the catch-all). Filed under the default
    /// token, so it should be a repo that token owns.
    pub github_issues_repo: String,

    /// HMAC secret for minting table-service join tickets (optional).
    /// Shared with bridge-table-service, which verifies tickets offline.
    /// When unset, POST /api/table-tickets degrades gracefully (503).
    /// Doubles as the X-Service-Secret for the table service's admin
    /// endpoints (session create/close).
    pub table_ticket_secret: Option<String>,

    /// Base URL of bridge-table-service, used for the session-create /
    /// session-close admin calls. The Mac↔droplet seam is deliberately
    /// thin: this plus the ticket mint are the only integration points.
    pub table_service_url: String,
}

impl Config {
    /// Load configuration from environment variables
    pub fn from_env() -> Result<Self, ConfigError> {
        // Load .env file if it exists (for development)
        let _ = dotenvy::dotenv();

        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite:./data/bridge_classroom.db".to_string());

        let api_key = env::var("API_KEY")
            .map_err(|_| ConfigError::MissingEnvVar("API_KEY"))?;

        let teacher_public_key = env::var("TEACHER_PUBLIC_KEY")
            .unwrap_or_default(); // Optional - can be empty initially

        let teacher_password = env::var("TEACHER_PASSWORD")
            .unwrap_or_else(|_| "changeme".to_string()); // Default for development

        let allowed_origins = env::var("ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:5173,http://localhost:4173".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

        let port = env::var("PORT")
            .unwrap_or_else(|_| "3000".to_string())
            .parse()
            .map_err(|_| ConfigError::InvalidPort)?;

        let recovery_secret = env::var("RECOVERY_SECRET").ok();
        // Treat empty ADMIN_SECRET the same as unset (fail closed downstream).
        let admin_secret = env::var("ADMIN_SECRET")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let resend_api_key = env::var("RESEND_API_KEY").ok();
        let from_email = env::var("FROM_EMAIL")
            .unwrap_or_else(|_| "Bridge Classroom <noreply@mail.bridge-classroom.org>".to_string());

        // Treat an empty GITHUB_ISSUES_TOKEN the same as unset.
        let github_issues_token = env::var("GITHUB_ISSUES_TOKEN")
            .ok()
            .filter(|s| !s.trim().is_empty());
        // Optional PBS-only token (David's PAT). Empty == unset == fall back to
        // the default token for PBS reports.
        let github_issues_token_pbs = env::var("GITHUB_ISSUES_TOKEN_PBS")
            .ok()
            .filter(|s| !s.trim().is_empty());
        // Catch-all repo for unknown/absent collections. Filed under the default
        // token, so it defaults to the app repo (Rick's), NOT David's PBS repo —
        // a mis-tagged report shouldn't land on David. Must be a repo the default
        // token can write to. GITHUB_ISSUES_REPO can override.
        let github_issues_repo = env::var("GITHUB_ISSUES_REPO")
            .unwrap_or_else(|_| "bridge-craftwork/Bridge-Classroom".to_string());

        // Treat an empty TABLE_TICKET_SECRET the same as unset.
        let table_ticket_secret = env::var("TABLE_TICKET_SECRET")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let table_service_url = env::var("TABLE_SERVICE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "https://tables.bridge-craftwork.com".to_string());

        Ok(Config {
            database_url,
            api_key,
            teacher_public_key,
            teacher_password,
            allowed_origins,
            host,
            port,
            recovery_secret,
            admin_secret,
            resend_api_key,
            from_email,
            github_issues_token,
            github_issues_token_pbs,
            github_issues_repo,
            table_ticket_secret,
            table_service_url,
        })
    }

    /// Get the server address as a string
    pub fn server_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Missing required environment variable: {0}")]
    MissingEnvVar(&'static str),

    #[error("Invalid port number")]
    InvalidPort,
}
