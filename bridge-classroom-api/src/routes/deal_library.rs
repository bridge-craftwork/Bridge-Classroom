use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};

use crate::models::{
    CreateDealLibraryRequest, DealLibraryActionResponse, DealLibraryEntry,
    DealLibraryEntryDetail, DealLibraryEntryResponse, DealLibraryListResponse, DealLibraryQuery,
    DeleteDealLibraryQuery, UpdateDealLibraryRequest,
};
use crate::AppState;

/// Per-teacher creation quotas (mirrors the exercises quota rationale). The
/// shared API key is bundled with the frontend (CLAUDE.md, "API Security
/// Notes"), so it can't keep an attacker out — these counts are the real
/// ceiling on how much a single account can push into the nightly-backed
/// DB. `kind=file` entries carry PBN text (~4KB for 24 boards), so the
/// library is the heaviest per-account store; the caps are generous enough
/// for a term of class material but bounded. Both counters include
/// soft-deleted rows — they still consume storage until purged.
const ENTRIES_PER_MONTH: i64 = 1000;
const ENTRIES_LIFETIME: i64 = 10_000;
const ONE_MONTH_SECS: i64 = 30 * 24 * 60 * 60;

/// The three legal `kind` values. Enforced here (and by a CHECK constraint
/// in the schema) so a typo can't create an un-renderable entry.
const VALID_KINDS: [&str; 3] = ["folder", "file", "link"];

/// Validate API key from request headers.
fn validate_api_key(headers: &HeaderMap, expected_key: &str) -> bool {
    if let Some(header_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return header_key == expected_key;
    }
    false
}

/// Enforce the per-month and lifetime creation quotas for `owner`.
async fn check_creation_quota(
    pool: &sqlx::SqlitePool,
    owner: &str,
) -> Result<(), (StatusCode, String)> {
    let lifetime: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM deal_library WHERE owner = ?")
        .bind(owner)
        .fetch_one(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if lifetime >= ENTRIES_LIFETIME {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            format!(
                "Lifetime library limit reached ({} entries per account). Delete some entries before adding more.",
                ENTRIES_LIFETIME
            ),
        ));
    }

    let cutoff = (chrono::Utc::now() - chrono::Duration::seconds(ONE_MONTH_SECS)).to_rfc3339();
    let last_month: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM deal_library WHERE owner = ? AND created_at >= ?",
    )
    .bind(owner)
    .bind(&cutoff)
    .fetch_one(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if last_month >= ENTRIES_PER_MONTH {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            format!(
                "Monthly library limit reached ({} per 30 days). Wait or delete recent entries.",
                ENTRIES_PER_MONTH
            ),
        ));
    }

    Ok(())
}

/// Fetch a live (non-deleted) entry's `owner` and `kind`, or 404. Used to
/// authorize update/delete before touching the row.
async fn fetch_owner_kind(
    pool: &sqlx::SqlitePool,
    id: &str,
) -> Result<(String, String), (StatusCode, String)> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT owner, kind FROM deal_library WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Library entry not found".to_string()))
}

/// Verify a parent, when supplied, exists, is live, belongs to the same
/// owner, and is a folder. Prevents cross-teacher moves and files parented
/// under a non-folder.
async fn validate_parent(
    pool: &sqlx::SqlitePool,
    owner: &str,
    parent_id: &str,
) -> Result<(), (StatusCode, String)> {
    let (p_owner, p_kind) = sqlx::query_as::<_, (String, String)>(
        "SELECT owner, kind FROM deal_library WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(parent_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::BAD_REQUEST, "Parent folder not found".to_string()))?;

    if p_owner != owner {
        return Err((
            StatusCode::FORBIDDEN,
            "Parent folder belongs to another account".to_string(),
        ));
    }
    if p_kind != "folder" {
        return Err((
            StatusCode::BAD_REQUEST,
            "Parent must be a folder".to_string(),
        ));
    }
    Ok(())
}

// ---- Endpoints ----

/// POST /api/deal-library — create a folder, file, or link entry.
pub async fn create_deal_library_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateDealLibraryRequest>,
) -> Result<Json<DealLibraryEntryResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    if req.owner.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "owner is required".to_string()));
    }
    if req.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "name is required".to_string()));
    }
    if !VALID_KINDS.contains(&req.kind.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            "kind must be one of: folder, file, link".to_string(),
        ));
    }

    // Folders hold no payload; files/links require one. Materializing the
    // copy is the caller's job (playlists/uploads arrive as PBN text; links
    // arrive as a JSON descriptor) — the server just stores it.
    match req.kind.as_str() {
        "folder" if req.payload.is_some() => {
            return Err((
                StatusCode::BAD_REQUEST,
                "folders cannot carry a payload".to_string(),
            ));
        }
        "file" | "link"
            if req.payload.as_deref().map(str::trim).unwrap_or("").is_empty() =>
        {
            return Err((
                StatusCode::BAD_REQUEST,
                "file and link entries require a payload".to_string(),
            ));
        }
        _ => {}
    }

    check_creation_quota(&state.db, &req.owner).await?;

    if let Some(ref parent_id) = req.parent_id {
        validate_parent(&state.db, &req.owner, parent_id).await?;
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let sort_order = req.sort_order.unwrap_or(0);
    // Folders never carry settings; drop any the client sent along.
    let settings = if req.kind == "folder" { None } else { req.settings.clone() };

    sqlx::query(
        r#"
        INSERT INTO deal_library
            (id, owner, parent_id, kind, name, payload, settings, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&req.owner)
    .bind(&req.parent_id)
    .bind(&req.kind)
    .bind(req.name.trim())
    .bind(&req.payload)
    .bind(&settings)
    .bind(sort_order)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert deal_library entry: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    tracing::info!("Deal library entry created: {} ({}) for {}", req.name.trim(), req.kind, req.owner);

    Ok(Json(DealLibraryEntryResponse {
        success: true,
        entry: DealLibraryEntryDetail {
            id,
            owner: req.owner,
            parent_id: req.parent_id,
            kind: req.kind,
            name: req.name.trim().to_string(),
            payload: req.payload,
            settings,
            sort_order,
            created_at: now,
            updated_at: None,
        },
    }))
}

/// GET /api/deal-library?owner=X[&parent_id=Y] — list a teacher's entries
/// (metadata only, no payload). Returns a flat list the client assembles
/// into a tree; pass `parent_id` to fetch just one folder's children.
pub async fn list_deal_library(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DealLibraryQuery>,
) -> Result<Json<DealLibraryListResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }
    if query.owner.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "owner is required".to_string()));
    }

    // Project everything except `payload`; expose whether a payload exists
    // and its byte length so the client can render "24 boards ≈ 4KB"
    // without shipping the text.
    let mut sql = String::from(
        r#"
        SELECT
            id, owner, parent_id, kind, name, settings, sort_order,
            (payload IS NOT NULL) AS has_payload,
            COALESCE(LENGTH(payload), 0) AS payload_bytes,
            created_at, updated_at
        FROM deal_library
        WHERE owner = ? AND deleted_at IS NULL
        "#,
    );

    // parent_id is nullable, so an equality bind can't match root-level
    // rows (NULL = ? is never true). Branch on the sentinel "root".
    let filter_root = query.parent_id.as_deref() == Some("root");
    let filter_parent = query
        .parent_id
        .as_ref()
        .filter(|p| p.as_str() != "root")
        .cloned();

    if filter_root {
        sql.push_str(" AND parent_id IS NULL");
    } else if filter_parent.is_some() {
        sql.push_str(" AND parent_id = ?");
    }
    sql.push_str(" ORDER BY sort_order, name");

    let mut q = sqlx::query_as::<_, DealLibraryEntry>(&sql).bind(&query.owner);
    if let Some(ref p) = filter_parent {
        q = q.bind(p);
    }

    let entries = q.fetch_all(&state.db).await.map_err(|e| {
        tracing::error!("Failed to list deal_library: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    Ok(Json(DealLibraryListResponse {
        success: true,
        entries,
    }))
}

/// GET /api/deal-library/:id — fetch a single entry WITH its payload.
pub async fn get_deal_library_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<DealLibraryEntryResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let entry = sqlx::query_as::<_, DealLibraryEntryDetail>(
        r#"
        SELECT id, owner, parent_id, kind, name, payload, settings,
               sort_order, created_at, updated_at
        FROM deal_library
        WHERE id = ? AND deleted_at IS NULL
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "Library entry not found".to_string()))?;

    Ok(Json(DealLibraryEntryResponse {
        success: true,
        entry,
    }))
}

/// PUT /api/deal-library/:id — update an entry (owner only). Supports
/// rename, re-parent (move), payload/settings edits, and re-order.
pub async fn update_deal_library_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateDealLibraryRequest>,
) -> Result<Json<DealLibraryActionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let (owner, _kind) = fetch_owner_kind(&state.db, &id).await?;
    if owner != req.actor_user_id {
        return Err((
            StatusCode::FORBIDDEN,
            "Only the entry's owner can modify it".to_string(),
        ));
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(ref name) = req.name {
        if name.trim().is_empty() {
            return Err((StatusCode::BAD_REQUEST, "name cannot be empty".to_string()));
        }
        sqlx::query("UPDATE deal_library SET name = ? WHERE id = ?")
            .bind(name.trim())
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    // Re-parent. `Some(Some(pid))` moves under a folder; `Some(None)` moves
    // to the root; `None` leaves it. Guard against self-parenting and
    // cross-owner moves; a deeper cycle check isn't needed for a
    // teacher-driven UI, but self-parenting is the trivial footgun.
    if let Some(ref new_parent) = req.parent_id {
        match new_parent {
            Some(pid) => {
                if pid == &id {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "an entry cannot be its own parent".to_string(),
                    ));
                }
                validate_parent(&state.db, &owner, pid).await?;
                sqlx::query("UPDATE deal_library SET parent_id = ? WHERE id = ?")
                    .bind(pid)
                    .bind(&id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            }
            None => {
                sqlx::query("UPDATE deal_library SET parent_id = NULL WHERE id = ?")
                    .bind(&id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            }
        }
    }

    if let Some(ref payload) = req.payload {
        sqlx::query("UPDATE deal_library SET payload = ? WHERE id = ?")
            .bind(payload)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    // Settings: `Some(Some(json))` sets, `Some(None)` clears, `None` leaves.
    if let Some(ref new_settings) = req.settings {
        sqlx::query("UPDATE deal_library SET settings = ? WHERE id = ?")
            .bind(new_settings.as_ref())
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    if let Some(sort_order) = req.sort_order {
        sqlx::query("UPDATE deal_library SET sort_order = ? WHERE id = ?")
            .bind(sort_order)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE deal_library SET updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!("Deal library entry updated: {}", id);

    Ok(Json(DealLibraryActionResponse {
        success: true,
        error: None,
    }))
}

/// DELETE /api/deal-library/:id — soft-delete an entry (owner only). For a
/// folder this cascades to all descendants in code: a soft-delete is an
/// UPDATE, so no FK ON DELETE cascade fires (and `parent_id` intentionally
/// declares none), so we walk the subtree ourselves. Deleting "Week 3"
/// removes its whole subtree in one call.
pub async fn delete_deal_library_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<DeleteDealLibraryQuery>,
) -> Result<Json<DealLibraryActionResponse>, (StatusCode, String)> {
    if !validate_api_key(&headers, &state.config.api_key) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid API key".to_string()));
    }

    let (owner, kind) = fetch_owner_kind(&state.db, &id).await?;
    if owner != query.actor_user_id {
        return Err((
            StatusCode::FORBIDDEN,
            "Only the entry's owner can delete it".to_string(),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Collect the id plus, for folders, every live descendant by walking
    // parent links breadth-first. Owner-scoped so a malicious parent_id
    // can't drag in another teacher's rows.
    let mut to_delete = vec![id.clone()];
    if kind == "folder" {
        let mut frontier = vec![id.clone()];
        while let Some(current) = frontier.pop() {
            let children: Vec<String> = sqlx::query_scalar(
                "SELECT id FROM deal_library WHERE parent_id = ? AND owner = ? AND deleted_at IS NULL",
            )
            .bind(&current)
            .bind(&owner)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            for child in children {
                frontier.push(child.clone());
                to_delete.push(child);
            }
        }
    }

    for target in &to_delete {
        sqlx::query("UPDATE deal_library SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
            .bind(&now)
            .bind(target)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!(
        "Deal library entry soft-deleted: {} ({} rows, kind={})",
        id,
        to_delete.len(),
        kind
    );

    Ok(Json(DealLibraryActionResponse {
        success: true,
        error: None,
    }))
}
