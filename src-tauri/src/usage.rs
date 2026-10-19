//! Uso do plano Claude (mesmas porcentagens do app e do /usage do Claude Code).
//!
//! O token OAuth é lido de ~/.claude/.credentials.json e enviado somente à API da
//! Anthropic; ele nunca é repassado ao frontend.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

fn credentials_file() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".claude").join(".credentials.json"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub async fn fetch() -> Result<Value, String> {
    let file = credentials_file().ok_or("pasta do usuário não encontrada")?;
    let raw = std::fs::read_to_string(&file).map_err(|_| "Faça login no Claude Code para ver o uso do plano")?;
    let creds: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let oauth = &creds["claudeAiOauth"];
    let token = oauth["accessToken"]
        .as_str()
        .ok_or("Faça login no Claude Code para ver o uso do plano")?;
    // Não renovamos o token aqui: a renovação trocaria o refresh token usado pelo Claude Code.
    if oauth["expiresAt"].as_i64().is_some_and(|expires| expires <= now_ms()) {
        return Err("Token do Claude expirado: use o Claude Code para renová-lo".into());
    }

    let response = reqwest::Client::new()
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("falha de rede: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("API de uso respondeu {}", response.status()));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;

    Ok(json!({
        "plan": oauth["subscriptionType"],
        "limits": body["limits"],
        "five_hour": body["five_hour"],
        "seven_day": body["seven_day"],
        "seven_day_opus": body["seven_day_opus"],
        "seven_day_sonnet": body["seven_day_sonnet"],
    }))
}
