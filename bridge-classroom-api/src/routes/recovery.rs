use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use ring::aead::{self, LessSafeKey, UnboundKey, AES_256_GCM, Nonce, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use reqwest::Client;

use crate::AppState;

/// Rate limiting for code claims: max attempts per email within a window
const MAX_CODE_ATTEMPTS: u32 = 5;
const CODE_RATE_LIMIT_SECS: u64 = 900; // 15 minutes

/// In-memory rate limiter for recovery code attempts
/// Key: email (lowercase), Value: (window_start, attempt_count)
static CODE_RATE_LIMITER: std::sync::LazyLock<Mutex<HashMap<String, (Instant, u32)>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// §S4: throttle recovery-email SENDS so a registered address can't be bombed
/// (paid Resend quota / annoyance) and bulk enumeration is slowed. Kept
/// deliberately lenient so a real user requesting recovery — or the
/// registration flow's "is this email already registered?" check, which hits
/// the same endpoint — never trips it. Per-email and per-client-IP.
const REQUEST_MAX_PER_EMAIL: u32 = 3;
const REQUEST_EMAIL_WINDOW_SECS: u64 = 900; // 15 minutes
const REQUEST_MAX_PER_IP: u32 = 10;
const REQUEST_IP_WINDOW_SECS: u64 = 3600; // 1 hour

static REQUEST_EMAIL_LIMITER: std::sync::LazyLock<Mutex<HashMap<String, (Instant, u32)>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
static REQUEST_IP_LIMITER: std::sync::LazyLock<Mutex<HashMap<String, (Instant, u32)>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Record one hit for `key` and report whether it's within `max` per
/// `window_secs`. Expired windows are dropped. Tolerates a poisoned mutex
/// instead of panicking (§C12).
fn rate_limit_allow(
    limiter: &Mutex<HashMap<String, (Instant, u32)>>,
    key: &str,
    max: u32,
    window_secs: u64,
) -> bool {
    let now = Instant::now();
    let mut map = match limiter.lock() {
        Ok(m) => m,
        Err(poisoned) => poisoned.into_inner(),
    };
    map.retain(|_, (start, _)| now.duration_since(*start).as_secs() < window_secs);
    let entry = map.entry(key.to_string()).or_insert((now, 0));
    if entry.1 >= max {
        return false;
    }
    entry.1 += 1;
    true
}

/// Best-effort client IP. The API sits behind the Cloudflare Tunnel, so the
/// socket peer is always localhost — the real caller is in `CF-Connecting-IP`
/// (or the first `X-Forwarded-For` hop). Falls back to a constant so a missing
/// header degrades to per-email-only limiting rather than bypassing it.
fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Request to initiate account recovery
#[derive(Debug, Deserialize)]
pub struct RecoveryRequest {
    pub email: String,
}

/// Response for recovery request
#[derive(Debug, Serialize)]
pub struct RecoveryRequestResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
}

/// Request to claim recovery (from magic link)
#[derive(Debug, Deserialize)]
pub struct RecoveryClaimRequest {
    pub user_id: String,
    pub token: String,
}

/// Request to claim recovery by numeric code
#[derive(Debug, Deserialize)]
pub struct RecoveryClaimByCodeRequest {
    pub email: String,
    pub code: String,
}

/// User data returned on successful recovery
#[derive(Debug, Serialize)]
pub struct RecoveredUserData {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub secret_key: String,
    pub classroom: Option<String>,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_private_key: Option<String>,
}

/// Response for recovery claim
#[derive(Debug, Serialize)]
pub struct RecoveryClaimResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<RecoveredUserData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Encrypt the user's secret key with the server's RECOVERY_SECRET
pub fn encrypt_for_recovery(secret_key: &str, recovery_secret: &str) -> Result<String, String> {
    // Derive a 256-bit key from recovery_secret using SHA-256
    let mut hasher = Sha256::new();
    hasher.update(recovery_secret.as_bytes());
    let key_bytes = hasher.finalize();

    // Create AES-256-GCM key
    let unbound_key = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|e| format!("Failed to create key: {:?}", e))?;
    let key = LessSafeKey::new(unbound_key);

    // Generate random nonce
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "Failed to generate nonce")?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    // Encrypt the secret key
    let mut in_out = secret_key.as_bytes().to_vec();
    key.seal_in_place_append_tag(nonce, aead::Aad::empty(), &mut in_out)
        .map_err(|e| format!("Encryption failed: {:?}", e))?;

    // Combine nonce and ciphertext: base64(nonce:ciphertext)
    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&in_out);

    Ok(BASE64.encode(&combined))
}

/// Decrypt the user's secret key using the server's RECOVERY_SECRET
pub fn decrypt_for_recovery(encrypted: &str, recovery_secret: &str) -> Result<String, String> {
    // Decode from base64
    let combined = BASE64.decode(encrypted)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    if combined.len() < NONCE_LEN {
        return Err("Invalid encrypted data".to_string());
    }

    // Split nonce and ciphertext
    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let nonce_array: [u8; NONCE_LEN] = nonce_bytes.try_into()
        .map_err(|_| "Invalid nonce length")?;
    let nonce = Nonce::assume_unique_for_key(nonce_array);

    // Derive key from recovery_secret
    let mut hasher = Sha256::new();
    hasher.update(recovery_secret.as_bytes());
    let key_bytes = hasher.finalize();

    // Create AES-256-GCM key
    let unbound_key = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|e| format!("Failed to create key: {:?}", e))?;
    let key = LessSafeKey::new(unbound_key);

    // Decrypt
    let mut in_out = ciphertext.to_vec();
    let decrypted = key.open_in_place(nonce, aead::Aad::empty(), &mut in_out)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;

    String::from_utf8(decrypted.to_vec())
        .map_err(|e| format!("Invalid UTF-8: {}", e))
}

/// Generate a secure random recovery token
fn generate_recovery_token() -> String {
    let rng = SystemRandom::new();
    let mut token_bytes = [0u8; 32];
    rng.fill(&mut token_bytes).expect("Failed to generate random token");
    BASE64.encode(&token_bytes)
        .replace('+', "-")
        .replace('/', "_")
        .replace('=', "")
}

/// Hash a token for storage
fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a 6-digit numeric recovery code
fn generate_recovery_code() -> String {
    let rng = SystemRandom::new();
    let mut bytes = [0u8; 4];
    rng.fill(&mut bytes).expect("Failed to generate random code");
    let num = u32::from_be_bytes(bytes) % 1_000_000;
    format!("{:06}", num)
}

/// Resend API request body
#[derive(Debug, Serialize)]
struct ResendEmailRequest {
    from: String,
    to: Vec<String>,
    subject: String,
    html: String,
}

/// Send recovery email via Resend API
async fn send_recovery_email(
    api_key: &str,
    from_email: &str,
    to_email: &str,
    first_name: &str,
    recovery_url: &str,
    recovery_code: &str,
) -> Result<(), String> {
    let client = Client::new();

    let html_body = format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .button {{ display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
        .button:hover {{ background-color: #1d4ed8; }}
        .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #666; }}
    </style>
</head>
<body>
    <div class="container">
        <h2>Account Recovery</h2>
        <p>Hi {first_name},</p>
        <p>You requested to recover your Bridge Classroom account. Click the button below to restore your practice history:</p>
        <a href="{recovery_url}" class="button" style="display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">Restore My Account</a>
        <div style="text-align: center; margin: 24px 0; padding: 20px; background: #f0f4ff; border-radius: 8px;">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">Or enter this code in the app:</p>
            <p style="margin: 0; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1a237e; font-family: monospace;">{recovery_code}</p>
        </div>
        <p><strong>This link and code expire in 24 hours.</strong></p>
        <div class="footer">
            <p>If you didn't request this, you can safely ignore this email.</p>
            <p>— Bridge Classroom</p>
        </div>
    </div>
</body>
</html>"#,
        first_name = first_name,
        recovery_url = recovery_url,
        recovery_code = recovery_code,
    );

    let email_request = ResendEmailRequest {
        from: from_email.to_string(),
        to: vec![to_email.to_string()],
        subject: "Restore your Bridge Classroom account".to_string(),
        html: html_body,
    };

    let response = client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&email_request)
        .send()
        .await
        .map_err(|e| format!("Failed to send email request: {}", e))?;

    if response.status().is_success() {
        tracing::info!("Recovery email sent to {}", to_email);
        Ok(())
    } else {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        tracing::error!("Resend API error: {} - {}", status, error_text);
        Err(format!("Email service error: {} - {}", status, error_text))
    }
}

/// POST /api/recovery/request
/// Request account recovery - creates token and logs recovery link (no email yet)
pub async fn request_recovery(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RecoveryRequest>,
) -> Result<Json<RecoveryRequestResponse>, (StatusCode, String)> {
    // Validate email
    if req.email.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Email is required".to_string()));
    }

    // Find user by email
    let user = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>)>(
        "SELECT id, first_name, last_name, classroom, recovery_encrypted_key FROM users WHERE email = ?"
    )
    .bind(&req.email)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (user_id, first_name, _last_name, _classroom, recovery_key) = match user {
        Some(u) => u,
        None => {
            // Don't reveal if email exists or not (security best practice)
            // But for this classroom app, we'll be helpful
            return Ok(Json(RecoveryRequestResponse {
                success: false,
                message: "No account found with this email address. Please register as a new student.".to_string(),
                user_id: None,
            }));
        }
    };

    // Check if recovery key is available
    if recovery_key.is_none() {
        return Ok(Json(RecoveryRequestResponse {
            success: false,
            message: "This account was created before recovery was available. Please contact your teacher.".to_string(),
            user_id: None,
        }));
    }

    // §S4: throttle here — only once we know a recovery email will actually be
    // sent. Counting only real sends (not "no account" / new-email registration
    // checks) means the abuse case (bombing a registered address) is capped
    // while a teacher onboarding many new students from one IP is never blocked.
    // Per-email stops hammering one address; per-IP stops one host bombing many.
    let email_key = req.email.trim().to_lowercase();
    let ip = client_ip(&headers);
    if !rate_limit_allow(&REQUEST_EMAIL_LIMITER, &email_key, REQUEST_MAX_PER_EMAIL, REQUEST_EMAIL_WINDOW_SECS)
        || !rate_limit_allow(&REQUEST_IP_LIMITER, &ip, REQUEST_MAX_PER_IP, REQUEST_IP_WINDOW_SECS)
    {
        tracing::warn!("Recovery request throttled (email={}, ip={})", email_key, ip);
        return Ok(Json(RecoveryRequestResponse {
            success: false,
            message: "You've requested account recovery several times recently. Please check your email (including spam) or wait a few minutes before trying again.".to_string(),
            user_id: None,
        }));
    }

    // Generate token and recovery code
    let token = generate_recovery_token();
    let token_hash = hash_token(&token);
    let recovery_code = generate_recovery_code();
    let code_hash = hash_token(&recovery_code);
    let now = chrono::Utc::now();
    // 24h window — a 1h TTL was tripping up users who didn't click the link
    // promptly (e.g. clicked 71 min later → "No valid token found" → gave up
    // or created a duplicate account).
    let expires_at = now + chrono::Duration::hours(24);

    // SECURITY (§S4): do NOT log the recovery code or the token here. This path
    // runs on every successful recovery request, so logging the one-time secret
    // turned the API log into a credential store. Log only a non-sensitive marker.
    tracing::info!("Creating recovery token for user {}", user_id);

    // Delete any existing tokens for this user
    sqlx::query("DELETE FROM recovery_tokens WHERE user_id = ?")
        .bind(&user_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Store new token with recovery code hash
    let token_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO recovery_tokens (id, user_id, token_hash, recovery_code_hash, created_at, expires_at, used)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        "#
    )
    .bind(&token_id)
    .bind(&user_id)
    .bind(&token_hash)
    .bind(&code_hash)
    .bind(now.to_rfc3339())
    .bind(expires_at.to_rfc3339())
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Build recovery URL — use the Origin header if it's a known allowed origin,
    // so users on .org get .org links and users on .com get .com links.
    let frontend_url = std::env::var("FRONTEND_URL")
        .unwrap_or_else(|_| "https://bridge-classroom.com/solo-practice-app".to_string());
    let base_url = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .filter(|origin| state.config.allowed_origins.iter().any(|o| o == origin))
        .map(|origin| format!("{}/solo-practice-app", origin))
        .unwrap_or(frontend_url);
    let recovery_url = format!("{}?recover={}&user_id={}", base_url, token, user_id);
    // SECURITY (§S4): the recovery URL embeds the one-time token — never log it
    // on the success path. (The email-delivery-failed break-glass block below
    // still prints it as a deliberate operational escape hatch when email is
    // down; that path is rare and is the only manual recovery channel.)

    // Send recovery email via Resend if API key is configured
    let mut email_sent = false;
    if let Some(ref api_key) = state.config.resend_api_key {
        match send_recovery_email(
            api_key,
            &state.config.from_email,
            &req.email,
            &first_name,
            &recovery_url,
            &recovery_code,
        ).await {
            Ok(_) => {
                tracing::info!("Recovery email sent to {} for user {}", req.email, first_name);
                email_sent = true;
            }
            Err(e) => {
                // Log error but don't fail - still tell frontend the account exists
                tracing::error!("Failed to send recovery email: {}", e);
                // Log the recovery URL and code so it can be manually shared if needed
                println!("\n{}", "=".repeat(70));
                println!("RECOVERY LINK (email failed: {})", e);
                println!("{}", "=".repeat(70));
                println!("User: {} ({})", first_name, req.email);
                println!("Link: {}", recovery_url);
                println!("Code: {}", recovery_code);
                println!("Expires: {}", expires_at.to_rfc3339());
                println!("{}\n", "=".repeat(70));
            }
        }
    } else {
        // Fallback to logging if Resend not configured
        tracing::warn!("RESEND_API_KEY not configured - logging recovery link instead");
        println!("\n{}", "=".repeat(70));
        println!("RECOVERY LINK (email not configured)");
        println!("{}", "=".repeat(70));
        println!("User: {} ({})", first_name, req.email);
        println!("Link: {}", recovery_url);
        println!("Code: {}", recovery_code);
        println!("Expires: {}", expires_at.to_rfc3339());
        println!("{}\n", "=".repeat(70));
    }

    let message = if email_sent {
        format!("Recovery link sent to {}. Check your email.", req.email)
    } else {
        format!(
            "Account found for {}. Email delivery failed - please contact your teacher for a recovery link.",
            req.email
        )
    };

    Ok(Json(RecoveryRequestResponse {
        success: true, // Account exists, even if email failed
        message,
        // SECURITY (§S4): the client never needs the user_id here (the claim flow
        // reads it from the emailed recovery URL), so don't hand it out.
        user_id: None,
    }))
}

/// POST /api/recovery/claim
/// Claim account recovery - verify token and return decrypted secret key
pub async fn claim_recovery(
    State(state): State<AppState>,
    Json(req): Json<RecoveryClaimRequest>,
) -> Result<Json<RecoveryClaimResponse>, (StatusCode, String)> {
    tracing::info!("========== Recovery claim request ==========");
    tracing::info!("user_id: {}", req.user_id);
    tracing::info!("token (first 10 chars): {}...", &req.token.chars().take(10).collect::<String>());

    // Validate request
    if req.user_id.is_empty() || req.token.is_empty() {
        tracing::warn!("Invalid request: user_id or token empty");
        return Err((StatusCode::BAD_REQUEST, "user_id and token are required".to_string()));
    }

    let token_hash = hash_token(&req.token);
    let now = chrono::Utc::now().to_rfc3339();
    tracing::info!("Looking for valid token with hash: {}...", &token_hash.chars().take(16).collect::<String>());

    // Find valid token
    let token_record = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT id, user_id FROM recovery_tokens
        WHERE user_id = ? AND token_hash = ? AND used = 0 AND expires_at > ?
        "#
    )
    .bind(&req.user_id)
    .bind(&token_hash)
    .bind(&now)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (token_id, user_id) = match token_record {
        Some(t) => {
            tracing::info!("Found valid token: {}", t.0);
            t
        },
        None => {
            tracing::warn!("No valid token found for user_id: {}", req.user_id);
            return Ok(Json(RecoveryClaimResponse {
                success: false,
                user: None,
                error: Some("This recovery link has expired or was already used. Please request a new recovery email.".to_string()),
            }));
        }
    };

    // Mark token as used — atomically (§S4). The `AND used = 0` guard plus the
    // rows_affected check closes a TOCTOU where two concurrent claims of the same
    // token could both pass the SELECT above and both succeed.
    let marked = sqlx::query("UPDATE recovery_tokens SET used = 1 WHERE id = ? AND used = 0")
        .bind(&token_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if marked.rows_affected() == 0 {
        tracing::warn!("Recovery token {} was already claimed (race)", token_id);
        return Ok(Json(RecoveryClaimResponse {
            success: false,
            user: None,
            error: Some("This recovery link has expired or was already used. Please request a new recovery email.".to_string()),
        }));
    }

    // Get user data with recovery key
    let user = sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>, String)>(
        "SELECT id, first_name, last_name, email, classroom, recovery_encrypted_key, role FROM users WHERE id = ?"
    )
    .bind(&user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (id, first_name, last_name, email, classroom, recovery_encrypted_key, role) = user;

    let encrypted_key = match recovery_encrypted_key {
        Some(k) => k,
        None => {
            return Ok(Json(RecoveryClaimResponse {
                success: false,
                user: None,
                error: Some("No recovery key available for this account".to_string()),
            }));
        }
    };

    // Decrypt the secret key
    let recovery_secret = state.config.recovery_secret.as_ref()
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Recovery not configured".to_string()))?;

    let secret_key = decrypt_for_recovery(&encrypted_key, recovery_secret)
        .map_err(|e| {
            tracing::error!("Failed to decrypt recovery key: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to decrypt recovery key".to_string())
        })?;

    // If user is teacher/admin, also recover viewer private key
    let viewer_private_key = if role == "teacher" || role == "admin" {
        let viewer_row = sqlx::query_as::<_, (Option<String>,)>(
            "SELECT recovery_encrypted_private_key FROM viewers WHERE email = ?"
        )
        .bind(&email)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        if let Some((Some(encrypted_pk),)) = viewer_row {
            match decrypt_for_recovery(&encrypted_pk, recovery_secret) {
                Ok(pk) => {
                    tracing::info!("Recovered viewer private key for teacher/admin");
                    Some(pk)
                }
                Err(e) => {
                    tracing::warn!("Failed to decrypt viewer private key: {}", e);
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    tracing::info!("========== Recovery claim SUCCESS ==========");
    tracing::info!("Account recovered for user: {} {} ({})", first_name, last_name, email);
    tracing::info!("Secret key length: {} chars", secret_key.len());
    tracing::info!("Returning user data with id: {}", id);

    Ok(Json(RecoveryClaimResponse {
        success: true,
        user: Some(RecoveredUserData {
            id,
            first_name,
            last_name,
            email,
            secret_key,
            classroom,
            role,
            viewer_private_key,
        }),
        error: None,
    }))
}

/// POST /api/recovery/claim-code
/// Claim account recovery using a 6-digit numeric code from the email
pub async fn claim_by_code(
    State(state): State<AppState>,
    Json(req): Json<RecoveryClaimByCodeRequest>,
) -> Result<Json<RecoveryClaimResponse>, (StatusCode, String)> {
    let email = req.email.trim().to_lowercase();
    let code = req.code.trim().to_string();

    tracing::info!("========== Recovery claim-by-code request ==========");
    tracing::info!("email: {}", email);

    // Validate request
    if email.is_empty() || code.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "email and code are required".to_string()));
    }

    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Ok(Json(RecoveryClaimResponse {
            success: false,
            user: None,
            error: Some("Please enter a 6-digit numeric code.".to_string()),
        }));
    }

    // Rate limiting
    {
        let mut limiter = CODE_RATE_LIMITER.lock().unwrap();
        let now = Instant::now();

        // Clean up expired entries
        limiter.retain(|_, (start, _)| now.duration_since(*start).as_secs() < CODE_RATE_LIMIT_SECS);

        let entry = limiter.entry(email.clone()).or_insert((now, 0));

        // Reset if window expired
        if now.duration_since(entry.0).as_secs() >= CODE_RATE_LIMIT_SECS {
            *entry = (now, 0);
        }

        entry.1 += 1;
        if entry.1 > MAX_CODE_ATTEMPTS {
            tracing::warn!("Rate limit exceeded for recovery code claims: {}", email);
            return Ok(Json(RecoveryClaimResponse {
                success: false,
                user: None,
                error: Some("Too many attempts. Please wait 15 minutes and try again.".to_string()),
            }));
        }
    }

    // Find user by email
    let user_row = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM users WHERE email = ?"
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let user_id = match user_row {
        Some((id,)) => id,
        None => {
            // Don't reveal whether email exists
            return Ok(Json(RecoveryClaimResponse {
                success: false,
                user: None,
                error: Some("Invalid code. Please check and try again.".to_string()),
            }));
        }
    };

    // Find valid token with matching code hash
    let code_hash = hash_token(&code);
    let now_str = chrono::Utc::now().to_rfc3339();

    let token_record = sqlx::query_as::<_, (String,)>(
        r#"
        SELECT id FROM recovery_tokens
        WHERE user_id = ? AND recovery_code_hash = ? AND used = 0 AND expires_at > ?
        "#
    )
    .bind(&user_id)
    .bind(&code_hash)
    .bind(&now_str)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let token_id = match token_record {
        Some((id,)) => {
            tracing::info!("Found valid token by code for user: {}", user_id);
            id
        },
        None => {
            tracing::warn!("No valid token found for code claim, email: {}", email);
            return Ok(Json(RecoveryClaimResponse {
                success: false,
                user: None,
                error: Some("Invalid or expired code. Please request a new recovery email.".to_string()),
            }));
        }
    };

    // Mark token as used — atomically (§S4). The `AND used = 0` guard plus the
    // rows_affected check closes a TOCTOU where two concurrent claims of the same
    // token could both pass the SELECT above and both succeed.
    let marked = sqlx::query("UPDATE recovery_tokens SET used = 1 WHERE id = ? AND used = 0")
        .bind(&token_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if marked.rows_affected() == 0 {
        tracing::warn!("Recovery token {} was already claimed (race)", token_id);
        return Ok(Json(RecoveryClaimResponse {
            success: false,
            user: None,
            error: Some("This recovery link has expired or was already used. Please request a new recovery email.".to_string()),
        }));
    }

    // Get user data with recovery key
    let user = sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>, String)>(
        "SELECT id, first_name, last_name, email, classroom, recovery_encrypted_key, role FROM users WHERE id = ?"
    )
    .bind(&user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (id, first_name, last_name, user_email, classroom, recovery_encrypted_key, role) = user;

    let encrypted_key = match recovery_encrypted_key {
        Some(k) => k,
        None => {
            return Ok(Json(RecoveryClaimResponse {
                success: false,
                user: None,
                error: Some("No recovery key available for this account".to_string()),
            }));
        }
    };

    // Decrypt the secret key
    let recovery_secret = state.config.recovery_secret.as_ref()
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Recovery not configured".to_string()))?;

    let secret_key = decrypt_for_recovery(&encrypted_key, recovery_secret)
        .map_err(|e| {
            tracing::error!("Failed to decrypt recovery key: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to decrypt recovery key".to_string())
        })?;

    // Clear rate limit on success
    {
        let mut limiter = CODE_RATE_LIMITER.lock().unwrap();
        limiter.remove(&email);
    }

    // If user is teacher/admin, also recover viewer private key
    let viewer_private_key = if role == "teacher" || role == "admin" {
        let viewer_row = sqlx::query_as::<_, (Option<String>,)>(
            "SELECT recovery_encrypted_private_key FROM viewers WHERE email = ?"
        )
        .bind(&user_email)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        if let Some((Some(encrypted_pk),)) = viewer_row {
            decrypt_for_recovery(&encrypted_pk, recovery_secret).ok()
        } else {
            None
        }
    } else {
        None
    };

    tracing::info!("========== Recovery claim-by-code SUCCESS ==========");
    tracing::info!("Account recovered for user: {} {} ({})", first_name, last_name, user_email);

    Ok(Json(RecoveryClaimResponse {
        success: true,
        user: Some(RecoveredUserData {
            id,
            first_name,
            last_name,
            email: user_email,
            secret_key,
            classroom,
            role,
            viewer_private_key,
        }),
        error: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let secret_key = "test-secret-key-base64";
        let recovery_secret = "server-recovery-secret";

        let encrypted = encrypt_for_recovery(secret_key, recovery_secret).unwrap();
        let decrypted = decrypt_for_recovery(&encrypted, recovery_secret).unwrap();

        assert_eq!(decrypted, secret_key);
    }

    #[test]
    fn test_different_nonces() {
        let secret_key = "test-secret-key";
        let recovery_secret = "server-secret";

        let encrypted1 = encrypt_for_recovery(secret_key, recovery_secret).unwrap();
        let encrypted2 = encrypt_for_recovery(secret_key, recovery_secret).unwrap();

        // Same plaintext should produce different ciphertext due to random nonce
        assert_ne!(encrypted1, encrypted2);

        // Both should decrypt correctly
        assert_eq!(decrypt_for_recovery(&encrypted1, recovery_secret).unwrap(), secret_key);
        assert_eq!(decrypt_for_recovery(&encrypted2, recovery_secret).unwrap(), secret_key);
    }

    #[test]
    fn test_wrong_recovery_secret() {
        let secret_key = "test-secret-key";
        let recovery_secret = "correct-secret";
        let wrong_secret = "wrong-secret";

        let encrypted = encrypt_for_recovery(secret_key, recovery_secret).unwrap();
        let result = decrypt_for_recovery(&encrypted, wrong_secret);

        assert!(result.is_err());
    }
}
