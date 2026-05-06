#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chinese_ner::{ChineseNER, NamedEntity};
use reqwest::header::{
    ACCEPT, ACCEPT_ENCODING, AUTHORIZATION, CACHE_CONTROL, CONNECTION, CONTENT_ENCODING,
    CONTENT_TYPE, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env,
    ffi::OsString,
    fs,
    io::{Cursor, ErrorKind, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const WECOM_LOGIN_EVENT: &str = "wecom-login-callback";
const WECOM_LOGIN_DEBUG_EVENT: &str = "wecom-login-debug";
const WECOM_LOGIN_WINDOW_LABEL: &str = "wecom-login";
const WECOM_CALLBACK_URL: &str = "https://tauri.localhost/__wecom_callback__";
const WECOM_CLIENT_AUTHORIZATION_HEADER: &str = "clientAuthorization";
const WECOM_WEBVIEW_USER_AGENT: &str =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const WECOM_LOGIN_INIT_SCRIPT: &str = r#"
(() => {
  const relayMessage = (payload) => {
    try {
      const encoded = encodeURIComponent(JSON.stringify(payload ?? {}));
      window.location.replace('https://tauri.localhost/__wecom_callback__?payload=' + encoded);
    } catch (error) {
      console.error('wecom relay failed', error);
    }
  };

  const openerBridge = {
    postMessage(payload) {
      relayMessage(payload);
    }
  };

  try {
    Object.defineProperty(window, 'opener', {
      configurable: true,
      enumerable: false,
      get() {
        return openerBridge;
      }
    });
  } catch (error) {
    try {
      window.opener = openerBridge;
    } catch (_) {
      console.error('failed to patch opener bridge', error);
    }
  }
})();
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WecomLoginPayload {
    // OAuth 授权类型，当前企微登录固定为 app_desk。
    grant_type: String,
    // 这里传的不是用户名，而是企微扫码成功后回传的 uuid。
    username: String,
    scope: String,
    app_desk_user_type: String,
    app_desk_id: String,
    app_desk_version: String,
    platform_client_id: String,
    // 机器唯一标识，用于和服务端保持设备维度绑定。
    mac: String,
    kick_out: Option<bool>,
    // 认证中心地址，前端传入后由 Rust 侧直接请求。
    base_url: String,
    // 客户端认证信息，服务端会据此校验调用方身份。
    client_authorization: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct WecomLoginResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    user_info: Option<Value>,
    msg: Option<String>,
    message: Option<String>,
    error_description: Option<String>,
    code: Option<Value>,
}

#[derive(Debug, Serialize, Clone)]
struct WecomLoginEventPayload {
    // 企微登录成功后拿到的登录 uuid。
    uuid: String,
    // 原始回调地址，保留给前端调试排查使用。
    source_url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PreciseEntityPayload {
    start: usize,
    end: usize,
    text: String,
    r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    masked: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmSensitiveEntityRequest {
    text: String,
    enabled_types: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LlmDesensitizeConfig {
    enabled: Option<bool>,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    thinking: Option<Value>,
    reasoning_effort: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmEntityCandidate {
    text: Option<String>,
    start: Option<usize>,
    end: Option<usize>,
    r#type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfOcrPayload {
    input_path: Option<String>,
    source_bytes: Option<Vec<u8>>,
    file_name: Option<String>,
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDocTextPayload {
    input_path: Option<String>,
    source_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDocMaskPayload {
    input_path: Option<String>,
    source_bytes: Option<Vec<u8>>,
    hit_list: Vec<LegacyDocMaskHit>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDocMaskHit {
    original: String,
    masked: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficeHtmlPreviewPayload {
    source_bytes: Vec<u8>,
    file_name: Option<String>,
    extension: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfOcrResult {
    output_path: String,
    sidecar_text: String,
    tool: String,
    command_label: String,
    language: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerOcrPagePayload {
    page_number: usize,
    image_data_url: String,
    width: Option<usize>,
    height: Option<usize>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerOcrRequest {
    file_name: Option<String>,
    pages: Vec<WorkerOcrPagePayload>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerOcrLineResult {
    text: String,
    score: Option<f32>,
    left: f32,
    top: f32,
    right: f32,
    bottom: f32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerOcrPageResult {
    page_number: usize,
    text: String,
    line_count: usize,
    avg_score: Option<f32>,
    image_width: Option<usize>,
    image_height: Option<usize>,
    lines: Vec<WorkerOcrLineResult>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerOcrResponse {
    tool: String,
    engine: String,
    pages: Vec<WorkerOcrPageResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerOcrInvokeResult {
    tool: String,
    engine: String,
    command_label: String,
    pages: Vec<WorkerOcrPageResult>,
}

fn extract_uuid_from_callback(url: &Url) -> Option<String> {
    // 远端页面会调用 opener.postMessage({ uuid })，我们把整包 payload 放进 query string，
    // 再在这里解码并提取 uuid。
    let payload = url
        .query_pairs()
        .find(|(key, _)| key == "payload")
        .map(|(_, value)| value.into_owned())?;

    let decoded = urlencoding::decode(&payload).ok()?.into_owned();
    let parsed = serde_json::from_str::<Value>(&decoded).ok()?;

    parsed
        .get("uuid")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn stringify_json_value(value: Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        other => Some(other.to_string()),
    }
}

#[tauri::command]
async fn open_wecom_login_window(app: AppHandle, login_url: String) -> Result<(), String> {
    // 已经打开过登录窗口时，直接聚焦，避免重复打开多个扫码窗。
    if let Some(window) = app.get_webview_window(WECOM_LOGIN_WINDOW_LABEL) {
        let _ = window.set_focus();
        let _ = app.emit_to(
            "main",
            WECOM_LOGIN_DEBUG_EVENT,
            "企微登录窗口已存在，已尝试聚焦。",
        );
        return Ok(());
    }

    let app_handle = app.clone();
    let window_label = WECOM_LOGIN_WINDOW_LABEL.to_string();
    let parsed_login_url: Url = login_url
        .parse()
        .map_err(|error| format!("企微登录地址无效: {error}"))?;

    let _ = app.emit_to(
        "main",
        WECOM_LOGIN_DEBUG_EVENT,
        format!("准备打开企微登录页面：{}", parsed_login_url),
    );

    WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::External(parsed_login_url))
        .title("企业微信登录")
        .inner_size(640.0, 760.0)
        .min_inner_size(480.0, 640.0)
        .center()
        .resizable(true)
        .focused(true)
        .visible(true)
        .user_agent(WECOM_WEBVIEW_USER_AGENT)
        // 给远端登录页注入一个假的 opener.postMessage，把浏览器回调桥接成 Tauri 可拦截的地址。
        .initialization_script(WECOM_LOGIN_INIT_SCRIPT)
        .on_navigation(move |url| {
            let _ = app_handle.emit_to(
                "main",
                WECOM_LOGIN_DEBUG_EVENT,
                format!("企微登录窗口导航到：{}", url),
            );
            // 一旦命中我们约定的回调地址，就说明子窗口已经拿到了 uuid。
            if url.as_str().starts_with(WECOM_CALLBACK_URL) {
                if let Some(uuid) = extract_uuid_from_callback(url) {
                    let payload = WecomLoginEventPayload {
                        uuid,
                        source_url: url.as_str().to_string(),
                    };
                    let _ = app_handle.emit_to("main", WECOM_LOGIN_EVENT, payload);
                }

                if let Some(window) = app_handle.get_webview_window(&window_label) {
                    let _ = window.close();
                }

                return false;
            }

            true
        })
        .build()
        .map_err(|error| format!("创建企微登录窗口失败: {error}"))?;

    let _ = app.emit_to("main", WECOM_LOGIN_DEBUG_EVENT, "企微登录窗口已创建。");

    Ok(())
}

#[tauri::command]
async fn wecom_login_request(payload: WecomLoginPayload) -> Result<WecomLoginResponse, String> {
    // 参考现有 Electron 项目，这里的真实登录接口是认证中心的 /oauth2/token。
    let endpoint = format!("{}/oauth2/token", payload.base_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| format!("初始化登录客户端失败: {error}"))?;

    let mut params = vec![
        ("grant_type", payload.grant_type),
        ("username", payload.username),
        ("scope", payload.scope),
        ("app_desk_user_type", payload.app_desk_user_type),
        ("app_desk_id", payload.app_desk_id),
        ("app_desk_version", payload.app_desk_version),
        ("platform_client_id", payload.platform_client_id),
        ("mac", "mac_id".to_string()),
    ];

    if let Some(kick_out) = payload.kick_out {
        params.push(("kick_out", kick_out.to_string()));
    }

    let client_authorization = payload.client_authorization.clone();

    let response = client
        .post(endpoint)
        // 兼容标准 OAuth 认证头。
        .header(AUTHORIZATION, client_authorization.clone())
        // 兼容服务端可能依赖的自定义 clientAuthorization 头。
        .header(WECOM_CLIENT_AUTHORIZATION_HEADER, client_authorization)
        .header(USER_AGENT, "SmartContract/0.1.0")
        .header(ACCEPT, "*/*")
        .header(CACHE_CONTROL, "no-cache")
        .header(CONNECTION, "keep-alive")
        .form(&params)
        .send()
        .await
        .map_err(|error| format!("企微登录请求失败: {error}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取企微登录响应失败: {error}"))?;

    let payload: WecomLoginResponse =
        serde_json::from_str(&text).map_err(|error| format!("解析企微登录响应失败: {error}"))?;

    // 成功响应至少需要 token 和 user_info，缺一项都按失败处理。
    if status.is_success() && payload.access_token.is_some() && payload.user_info.is_some() {
        return Ok(payload);
    }

    Err(payload
        .msg
        .or(payload.error_description)
        .or(payload.message)
        .or_else(|| payload.code.and_then(stringify_json_value))
        .unwrap_or_else(|| format!("企微登录失败，HTTP {}", status.as_u16())))
}

fn slice_chars(text: &str, start: usize, end: usize) -> String {
    text.chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

fn collect_precise_entities(text: &str, prediction: &NamedEntity<'_>) -> Vec<PreciseEntityPayload> {
    prediction
        .entity
        .iter()
        .filter_map(|(start, end, entity_type)| {
            let mapped_type = match *entity_type {
                "org_name" => "company",
                "person_name" => "namedPerson",
                "location" => "address",
                _ => return None,
            };

            let entity_text = slice_chars(text, *start, *end);
            if entity_text.trim().is_empty() {
                return None;
            }

            Some(PreciseEntityPayload {
                start: *start,
                end: *end,
                text: entity_text,
                r#type: mapped_type.to_string(),
                masked: None,
                source: None,
            })
        })
        .collect()
}

#[tauri::command]
async fn detect_chinese_entities(text: String) -> Result<Vec<PreciseEntityPayload>, String> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let ner = ChineseNER::new();
    let prediction = ner
        .predict(&text)
        .map_err(|error| format!("中文 NER 识别失败: {error}"))?;

    Ok(collect_precise_entities(&text, &prediction))
}

fn read_llm_config() -> Option<LlmDesensitizeConfig> {
    let mut candidates = Vec::new();

    if let Ok(path) = env::var("LLM_DESENSITIZE_CONFIG") {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join("src-tauri/llm-desensitize.config.json"));
        candidates.push(current_dir.join("llm-desensitize.config.json"));
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("llm-desensitize.config.json"));
        }
    }

    for path in candidates {
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        if let Ok(config) = serde_json::from_str::<LlmDesensitizeConfig>(&content) {
            return Some(config);
        }
    }

    None
}

fn resolve_llm_config() -> Option<LlmDesensitizeConfig> {
    let mut config = read_llm_config().unwrap_or(LlmDesensitizeConfig {
        enabled: Some(false),
        base_url: None,
        api_key: None,
        model: None,
        thinking: None,
        reasoning_effort: None,
        timeout_seconds: None,
    });

    if let Ok(value) = env::var("LLM_DESENSITIZE_ENABLED") {
        config.enabled = Some(matches!(
            value.as_str(),
            "1" | "true" | "TRUE" | "yes" | "YES"
        ));
    }
    if let Ok(value) = env::var("LLM_DESENSITIZE_BASE_URL") {
        config.base_url = Some(value);
    }
    if let Ok(value) = env::var("LLM_DESENSITIZE_API_KEY").or_else(|_| env::var("DEEPSEEK_API_KEY"))
    {
        config.api_key = Some(value);
    }
    if let Ok(value) = env::var("LLM_DESENSITIZE_MODEL") {
        config.model = Some(value);
    }

    Some(config)
}

fn normalize_llm_type(value: &str) -> Option<&'static str> {
    match value {
        "idCard" | "身份证号" | "身份证" => Some("idCard"),
        "mobile" | "手机号" | "座机" | "手机号/座机" | "电话" => Some("mobile"),
        "email" | "邮箱" => Some("email"),
        "bankCard" | "银行卡号" | "银行账号" | "账号" => Some("bankCard"),
        "uscc" | "统一社会信用代码" | "社会信用代码" => Some("uscc"),
        "company" | "公司名称" | "企业名称" => Some("company"),
        "namedPerson" | "姓名" | "人名" => Some("namedPerson"),
        "address" | "地址" => Some("address"),
        "price" | "价格" | "金额" => Some("price"),
        _ => None,
    }
}

fn byte_index_to_char(text: &str, byte_index: usize) -> usize {
    text[..byte_index.min(text.len())].chars().count()
}

fn find_candidate_span(text: &str, candidate_text: &str) -> Option<(usize, usize)> {
    let trimmed = candidate_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    text.find(trimmed).map(|byte_start| {
        let start = byte_index_to_char(text, byte_start);
        let end = start + trimmed.chars().count();
        (start, end)
    })
}

fn extract_json_from_llm_content(content: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(content) {
        return Ok(value);
    }

    let Some(start) = content.find('[').or_else(|| content.find('{')) else {
        return Err("大模型返回内容中没有 JSON。".to_string());
    };
    let end = content
        .rfind(']')
        .or_else(|| content.rfind('}'))
        .unwrap_or(content.len().saturating_sub(1));
    serde_json::from_str::<Value>(&content[start..=end])
        .map_err(|error| format!("解析大模型 JSON 失败: {error}"))
}

fn parse_llm_entities(content: &str) -> Result<Vec<LlmEntityCandidate>, String> {
    let value = extract_json_from_llm_content(content)?;
    let entities_value = if let Some(array) = value.as_array() {
        Value::Array(array.clone())
    } else {
        value
            .get("entities")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()))
    };

    serde_json::from_value::<Vec<LlmEntityCandidate>>(entities_value)
        .map_err(|error| format!("解析大模型实体列表失败: {error}"))
}

fn preview_bytes(bytes: &[u8], limit: usize) -> String {
    bytes
        .iter()
        .take(limit)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_response_bytes(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn normalize_llm_entities(
    text: &str,
    candidates: Vec<LlmEntityCandidate>,
    enabled_types: &[String],
) -> Vec<PreciseEntityPayload> {
    let enabled: std::collections::HashSet<String> = enabled_types
        .iter()
        .filter_map(|item| normalize_llm_type(item).map(ToOwned::to_owned))
        .collect();

    let mut entities = Vec::new();
    for candidate in candidates {
        let Some(raw_type) = candidate.r#type.as_deref() else {
            continue;
        };
        let Some(entity_type) = normalize_llm_type(raw_type) else {
            continue;
        };
        if !enabled.contains(entity_type) {
            continue;
        }

        let span = match (candidate.start, candidate.end) {
            (Some(start), Some(end)) if end > start => {
                let candidate_text = slice_chars(text, start, end);
                if candidate
                    .text
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_some()
                    && candidate.text.as_deref().map(str::trim) != Some(candidate_text.trim())
                {
                    find_candidate_span(text, candidate.text.as_deref().unwrap_or_default())
                } else {
                    Some((start, end))
                }
            }
            _ => candidate
                .text
                .as_deref()
                .and_then(|value| find_candidate_span(text, value)),
        };

        let Some((start, end)) = span else {
            continue;
        };
        let entity_text = slice_chars(text, start, end);
        if entity_text.trim().is_empty() {
            continue;
        }

        entities.push(PreciseEntityPayload {
            start,
            end,
            text: entity_text,
            r#type: entity_type.to_string(),
            masked: Some("***".to_string()),
            source: Some("llm".to_string()),
        });
    }

    entities.sort_by(|left, right| {
        left.start
            .cmp(&right.start)
            .then_with(|| right.end.cmp(&left.end))
    });
    entities.dedup_by(|left, right| {
        left.start == right.start && left.end == right.end && left.r#type == right.r#type
    });
    entities
}

#[tauri::command]
async fn detect_llm_sensitive_entities(
    payload: LlmSensitiveEntityRequest,
) -> Result<Vec<PreciseEntityPayload>, String> {
    #[cfg(debug_assertions)]
    eprintln!(
        "[LLM脱敏识别] 输入 enabledTypes={:?}, text={}",
        payload.enabled_types, payload.text
    );

    if payload.text.trim().is_empty() || payload.enabled_types.is_empty() {
        #[cfg(debug_assertions)]
        eprintln!("[LLM脱敏识别] 跳过：文本为空或未启用任何类型。");
        return Ok(Vec::new());
    }

    let Some(config) = resolve_llm_config() else {
        #[cfg(debug_assertions)]
        eprintln!("[LLM脱敏识别] 跳过：未读取到配置。");
        return Ok(Vec::new());
    };
    if !config.enabled.unwrap_or(false) {
        #[cfg(debug_assertions)]
        eprintln!("[LLM脱敏识别] 跳过：配置已关闭 enabled=false。");
        return Ok(Vec::new());
    }

    let api_key = config.api_key.unwrap_or_default();
    if api_key.trim().is_empty() {
        #[cfg(debug_assertions)]
        eprintln!("[LLM脱敏识别] 跳过：apiKey 为空。");
        return Ok(Vec::new());
    }

    let base_url = config
        .base_url
        .unwrap_or_else(|| "https://api.deepseek.com".to_string())
        .trim_end_matches('/')
        .to_string();
    let model = config
        .model
        .unwrap_or_else(|| "deepseek-v4-pro".to_string());
    let timeout = Duration::from_secs(config.timeout_seconds.unwrap_or(60).clamp(5, 180));
    let endpoint = format!("{base_url}/chat/completions");

    let type_list = payload.enabled_types.join(", ");
    let user_prompt = format!(
    "请识别下面合同文本中的敏感信息。只返回 JSON，不要解释。JSON 格式为数组，每项包含 text、type、start、end。start/end 使用从 0 开始的 Unicode 字符下标，end 为开区间。仅允许这些 type：{}。\n\n合同文本：\n{}",
    type_list, payload.text
  );

    let mut body = serde_json::json!({
      "model": model,
      "messages": [
        {
          "role": "system",
          "content": "你是合同脱敏识别助手，只输出严格 JSON。识别身份证号、手机号/座机、邮箱、银行卡号、统一社会信用代码、公司名称、姓名、地址、价格等敏感信息。"
        },
        {
          "role": "user",
          "content": user_prompt
        }
      ],
      "stream": false
    });

    if let Some(thinking) = config.thinking {
        body["thinking"] = thinking;
    }
    if let Some(reasoning_effort) = config.reasoning_effort {
        body["reasoning_effort"] = Value::String(reasoning_effort);
    }

    #[cfg(debug_assertions)]
    eprintln!("[LLM脱敏识别] 请求 endpoint={}, body={}", endpoint, body);

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .build()
        .map_err(|error| {
            #[cfg(debug_assertions)]
            eprintln!("[LLM脱敏识别] 初始化 HTTP 客户端失败: {error}");
            format!("初始化大模型 HTTP 客户端失败: {error}")
        })?;
    let response = match client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", api_key.trim()))
        .header(ACCEPT, "application/json")
        .header(ACCEPT_ENCODING, "identity")
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            #[cfg(debug_assertions)]
            eprintln!("[LLM脱敏识别] 请求报错: {error}");
            return Err(format!("调用大模型识别失败: {error}"));
        }
    };

    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_encoding = response
        .headers()
        .get(CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let response_bytes = match response.bytes().await {
        Ok(value) => value,
        Err(error) => {
            #[cfg(debug_assertions)]
            eprintln!("[LLM脱敏识别] 读取响应原始字节报错: {error}");
            return Err(format!("读取大模型响应失败: {error}"));
        }
    };
    let response_text = decode_response_bytes(&response_bytes);

    #[cfg(debug_assertions)]
    eprintln!(
        "[LLM脱敏识别] 原始响应 status={}, contentType={}, contentEncoding={}, bytes={}, bodyHexPreview={}, bodyText={}",
        status.as_u16(),
        content_type,
        content_encoding,
        response_bytes.len(),
        preview_bytes(&response_bytes, 160),
        response_text
    );

    let response_value = match serde_json::from_str::<Value>(&response_text) {
        Ok(value) => value,
        Err(error) => {
            #[cfg(debug_assertions)]
            eprintln!(
                "[LLM脱敏识别] 响应 JSON 解析报错: {error}; rawBody={}",
                response_text
            );
            return Err(format!(
                "解析大模型响应失败: {error}；原始响应：{}",
                response_text
            ));
        }
    };

    if !status.is_success() {
        #[cfg(debug_assertions)]
        eprintln!(
            "[LLM脱敏识别] HTTP 报错 status={}, body={}",
            status.as_u16(),
            response_value
        );
        return Err(format!(
            "调用大模型识别失败，HTTP {}：{}",
            status.as_u16(),
            response_value
        ));
    }

    let content = response_value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if content.trim().is_empty() {
        #[cfg(debug_assertions)]
        eprintln!("[LLM脱敏识别] 输出为空：message.content 为空。");
        return Ok(Vec::new());
    }

    #[cfg(debug_assertions)]
    eprintln!("[LLM脱敏识别] message.content={}", content);

    let candidates = match parse_llm_entities(content) {
        Ok(candidates) => candidates,
        Err(error) => {
            #[cfg(debug_assertions)]
            eprintln!("[LLM脱敏识别] 输出解析报错: {error}; content={}", content);
            return Err(error);
        }
    };
    let normalized = normalize_llm_entities(&payload.text, candidates, &payload.enabled_types);

    #[cfg(debug_assertions)]
    eprintln!("[LLM脱敏识别] 归一化输出={:?}", normalized);

    Ok(normalized)
}

fn find_executable_in_path(name: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(name);
    if candidate.is_absolute() && candidate.exists() {
        return Some(candidate);
    }

    let paths = env::var_os("PATH")?;
    env::split_paths(&paths)
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
}

fn resolve_ocrmypdf_command() -> Option<(OsString, Vec<OsString>, String)> {
    let direct_candidates = [
        "ocrmypdf",
        "/opt/homebrew/bin/ocrmypdf",
        "/usr/local/bin/ocrmypdf",
        "/usr/bin/ocrmypdf",
    ];

    for candidate in direct_candidates {
        if let Some(path) = find_executable_in_path(candidate) {
            let label = path.display().to_string();
            return Some((path.into_os_string(), Vec::new(), label));
        }
    }

    for candidate in ["python3", "python"] {
        if let Some(path) = find_executable_in_path(candidate) {
            let label = format!("{} -m ocrmypdf", path.display());
            return Some((
                path.into_os_string(),
                vec![OsString::from("-m"), OsString::from("ocrmypdf")],
                label,
            ));
        }
    }

    None
}

fn sanitize_file_stem(path: &Path, fallback: &str) -> String {
    let raw = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback);

    let sanitized = raw
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || matches!(char, '-' | '_') {
                char
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn build_ocr_output_paths(input_path: &Path) -> Result<(PathBuf, PathBuf), String> {
    let temp_root = env::temp_dir().join("ecmax-smart-contract-ocr");
    fs::create_dir_all(&temp_root).map_err(|error| format!("创建 OCR 临时目录失败: {error}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("生成 OCR 临时文件名失败: {error}"))?
        .as_millis();
    let file_stem = sanitize_file_stem(input_path, "contract");

    let output_path = temp_root.join(format!("{stamp}-{file_stem}-ocr.pdf"));
    let sidecar_path = temp_root.join(format!("{stamp}-{file_stem}-ocr.txt"));

    Ok((output_path, sidecar_path))
}

fn persist_input_bytes_for_ocr(file_name: Option<&str>, bytes: &[u8]) -> Result<PathBuf, String> {
    let temp_root = env::temp_dir().join("ecmax-smart-contract-ocr");
    fs::create_dir_all(&temp_root).map_err(|error| format!("创建 OCR 临时目录失败: {error}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("生成 OCR 输入文件失败: {error}"))?
        .as_millis();
    let seed = file_name.unwrap_or("contract.pdf");
    let base_path = Path::new(seed);
    let file_stem = sanitize_file_stem(base_path, "contract");
    let input_path = temp_root.join(format!("{stamp}-{file_stem}-input.pdf"));

    fs::write(&input_path, bytes).map_err(|error| format!("写入 OCR 输入文件失败: {error}"))?;
    Ok(input_path)
}

fn build_ocr_not_installed_message() -> String {
    "未检测到 OCRmyPDF。请先在本机安装 `ocrmypdf`，并确保命令行可直接执行；如果走 Python 模块方式，也需要 `python3 -m ocrmypdf` 可用。".to_string()
}

fn build_worker_not_installed_message() -> String {
    "未检测到本地 RapidOCR worker。开发环境请先创建 `/.venv-ocr-worker` 并安装 `rapidocr_onnxruntime`、`onnxruntime`、`Pillow`；打包环境请附带 `rapidocr-worker` sidecar 或 `rapidocr_worker.py` 资源文件。".to_string()
}

fn normalize_cli_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

fn is_doc_text_char(value: u16) -> bool {
    matches!(value, 0x0009 | 0x000a | 0x000d | 0x000c | 0x0020 | 0x3000)
        || (0x0030..=0x0039).contains(&value)
        || (0x0041..=0x005a).contains(&value)
        || (0x0061..=0x007a).contains(&value)
        || (0x4e00..=0x9fff).contains(&value)
        || (0xff00..=0xffef).contains(&value)
        || "，。、《》：（）()；;,.%+-_·"
            .encode_utf16()
            .any(|char| char == value)
}

fn normalize_legacy_doc_text(value: &str) -> String {
    value
        .replace('\u{000c}', "\n")
        .replace('\r', "\n")
        .replace('\u{0000}', " ")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn score_doc_text_run(value: &str) -> usize {
    const COMMON_CHINESE: &str =
        "的一是在有和为以与年月日合同公司金额人民币服务技术项目协议名称盖章截止签署约定";
    value
        .chars()
        .filter(|char| COMMON_CHINESE.contains(*char))
        .count()
}

fn should_keep_doc_text_run(value: &str) -> bool {
    let normalized_len = value.chars().filter(|char| !char.is_whitespace()).count();
    if normalized_len < 6 {
        return false;
    }

    let chinese_count = value
        .chars()
        .filter(|char| ('\u{4e00}'..='\u{9fff}').contains(char))
        .count();
    if chinese_count < 4 {
        return false;
    }

    score_doc_text_run(value) >= 2 || normalized_len >= 18
}

fn collect_utf16_doc_runs(bytes: &[u8]) -> Vec<(usize, String)> {
    let mut runs = Vec::new();

    for parity in 0..2 {
        let mut current = Vec::new();
        let mut start = parity;
        let mut index = parity;

        while index + 1 < bytes.len() {
            let value = u16::from_le_bytes([bytes[index], bytes[index + 1]]);
            if is_doc_text_char(value) {
                if current.is_empty() {
                    start = index;
                }
                current.push(value);
            } else {
                if !current.is_empty() {
                    if let Ok(text) = String::from_utf16(&current) {
                        let normalized = normalize_legacy_doc_text(&text);
                        if should_keep_doc_text_run(&normalized) {
                            runs.push((start, normalized));
                        }
                    }
                    current.clear();
                }
            }
            index += 2;
        }

        if !current.is_empty() {
            if let Ok(text) = String::from_utf16(&current) {
                let normalized = normalize_legacy_doc_text(&text);
                if should_keep_doc_text_run(&normalized) {
                    runs.push((start, normalized));
                }
            }
        }
    }

    runs
}

fn read_cfb_stream(bytes: &[u8], stream_name: &str) -> Option<Vec<u8>> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut compound = cfb::CompoundFile::open(cursor).ok()?;
    let mut stream = compound.open_stream(stream_name).ok()?;
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer).ok()?;
    Some(buffer)
}

fn extract_legacy_doc_text_from_bytes(bytes: &[u8]) -> Option<String> {
    let mut runs = Vec::new();

    for stream_name in ["WordDocument", "1Table", "0Table"] {
        if let Some(stream_bytes) = read_cfb_stream(bytes, stream_name) {
            runs.extend(collect_utf16_doc_runs(&stream_bytes));
        }
    }

    if runs.is_empty() {
        runs.extend(collect_utf16_doc_runs(bytes));
    }

    runs.sort_by_key(|(start, _)| *start);
    runs.dedup_by(|(_, left), (_, right)| left == right);

    let text = runs
        .into_iter()
        .map(|(_, text)| text)
        .collect::<Vec<_>>()
        .join("\n\n");
    let normalized = normalize_legacy_doc_text(&text);

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn fit_mask_to_original(masked: &str, original: &str) -> String {
    let original_len = original.encode_utf16().count();
    let mut result = masked.encode_utf16().take(original_len).collect::<Vec<_>>();
    if result.len() < original_len {
        result.extend(std::iter::repeat('*' as u16).take(original_len - result.len()));
    }
    String::from_utf16_lossy(&result)
}

fn encode_utf16le(value: &str) -> Vec<u8> {
    value.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

fn replace_all_bytes(buffer: &mut [u8], needle: &[u8], replacement: &[u8]) -> usize {
    if needle.is_empty() || needle.len() != replacement.len() {
        return 0;
    }
    let mut count = 0;
    let mut offset = 0;
    while offset + needle.len() <= buffer.len() {
        if &buffer[offset..offset + needle.len()] == needle {
            buffer[offset..offset + replacement.len()].copy_from_slice(replacement);
            count += 1;
            offset += replacement.len();
        } else {
            offset += 1;
        }
    }
    count
}

fn apply_legacy_doc_replacements(buffer: &mut [u8], hits: &[LegacyDocMaskHit]) -> usize {
    let mut replacement_count = 0;
    for hit in hits {
        if hit.original.trim().is_empty() || hit.original == hit.masked {
            continue;
        }
        let replacement = fit_mask_to_original(&hit.masked, &hit.original);
        replacement_count += replace_all_bytes(
            buffer,
            &encode_utf16le(&hit.original),
            &encode_utf16le(&replacement),
        );

        let normalized_original = hit.original.replace('\n', "\r");
        if normalized_original != hit.original {
            let normalized_replacement =
                fit_mask_to_original(&hit.masked.replace('\n', "\r"), &normalized_original);
            replacement_count += replace_all_bytes(
                buffer,
                &encode_utf16le(&normalized_original),
                &encode_utf16le(&normalized_replacement),
            );
        }
    }
    replacement_count
}

fn apply_replacements_to_cfb_stream<F>(
    compound: &mut cfb::CompoundFile<F>,
    stream_name: &str,
    hits: &[LegacyDocMaskHit],
) -> Result<usize, String>
where
    F: Read + Write + Seek,
{
    let mut stream = match compound.open_stream(stream_name) {
        Ok(stream) => stream,
        Err(_) => return Ok(0),
    };
    let mut buffer = Vec::new();
    stream
        .read_to_end(&mut buffer)
        .map_err(|error| format!("读取 DOC 内部流失败: {error}"))?;
    drop(stream);

    let replacement_count = apply_legacy_doc_replacements(&mut buffer, hits);
    if replacement_count == 0 {
        return Ok(0);
    }

    let mut stream = compound
        .open_stream(stream_name)
        .map_err(|error| format!("写入 DOC 内部流失败: {error}"))?;
    stream
        .seek(SeekFrom::Start(0))
        .map_err(|error| format!("定位 DOC 内部流失败: {error}"))?;
    stream
        .write_all(&buffer)
        .map_err(|error| format!("写入 DOC 内部流失败: {error}"))?;
    Ok(replacement_count)
}

fn build_masked_legacy_doc_bytes(
    bytes: &[u8],
    hits: &[LegacyDocMaskHit],
) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut compound = cfb::CompoundFile::open(cursor)
        .map_err(|error| format!("读取 DOC 复合文档失败: {error}"))?;
    let mut replacement_count = 0;

    for stream_name in ["WordDocument", "1Table", "0Table"] {
        replacement_count += apply_replacements_to_cfb_stream(&mut compound, stream_name, hits)?;
    }

    let mut bytes = compound.into_inner().into_inner();
    if replacement_count == 0 {
        replacement_count = apply_legacy_doc_replacements(&mut bytes, hits);
    }
    if replacement_count == 0 && hits.iter().any(|hit| !hit.original.trim().is_empty()) {
        return Err(
            "未能在 DOC 原文件结构中定位到需要脱敏的内容，请检查文档是否为加密或特殊编码格式。"
                .to_string(),
        );
    }
    Ok(bytes)
}

fn build_office_preview_temp_paths(
    file_name: Option<&str>,
    extension: Option<&str>,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let temp_root = env::temp_dir().join("ecmax-smart-contract-office-preview");
    fs::create_dir_all(&temp_root)
        .map_err(|error| format!("创建 Word 预览临时目录失败: {error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("生成 Word 预览临时文件名失败: {error}"))?
        .as_millis();
    let seed = file_name.unwrap_or("document");
    let file_stem = sanitize_file_stem(Path::new(seed), "document");
    let ext = extension
        .unwrap_or("docx")
        .trim_start_matches('.')
        .to_ascii_lowercase();
    let work_dir = temp_root.join(format!("{stamp}-{file_stem}"));
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("创建 Word 预览工作目录失败: {error}"))?;
    let input_path = work_dir.join(format!("{file_stem}.{ext}"));
    let html_path = work_dir.join(format!("{file_stem}.html"));
    Ok((work_dir, input_path, html_path))
}

fn find_generated_html(work_dir: &Path, preferred_path: &Path) -> Option<PathBuf> {
    if preferred_path.is_file() {
        return Some(preferred_path.to_path_buf());
    }

    fs::read_dir(work_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("html"))
        })
}

fn convert_office_to_html_with_soffice(
    input_path: &Path,
    work_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let program = [
        "soffice",
        "libreoffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/opt/homebrew/bin/soffice",
        "/usr/local/bin/soffice",
        "/usr/bin/soffice",
        "/opt/homebrew/bin/libreoffice",
        "/usr/local/bin/libreoffice",
        "/usr/bin/libreoffice",
    ]
    .into_iter()
    .find_map(find_executable_in_path);

    let Some(program) = program else {
        return Ok(None);
    };

    let output = Command::new(&program)
        .args([
            OsString::from("--headless"),
            OsString::from("--convert-to"),
            OsString::from("html"),
            OsString::from("--outdir"),
            work_dir.as_os_str().to_os_string(),
            input_path.as_os_str().to_os_string(),
        ])
        .output()
        .map_err(|error| format!("启动 LibreOffice 预览转换失败: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "LibreOffice 预览转换失败：{}",
            normalize_cli_output(&output.stderr)
        ));
    }

    Ok(find_generated_html(
        work_dir,
        &input_path.with_extension("html"),
    ))
}

fn convert_office_to_html_with_textutil(
    input_path: &Path,
    html_path: &Path,
) -> Result<Option<PathBuf>, String> {
    let program = ["textutil", "/usr/bin/textutil"]
        .into_iter()
        .find_map(find_executable_in_path);

    let Some(program) = program else {
        return Ok(None);
    };

    let output = Command::new(&program)
        .args([
            OsString::from("-convert"),
            OsString::from("html"),
            OsString::from("-output"),
            html_path.as_os_str().to_os_string(),
            input_path.as_os_str().to_os_string(),
        ])
        .output()
        .map_err(|error| format!("启动系统 Word 预览转换失败: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "系统 Word 预览转换失败：{}",
            normalize_cli_output(&output.stderr)
        ));
    }

    Ok(html_path.is_file().then(|| html_path.to_path_buf()))
}

fn escape_preview_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn legacy_doc_text_preview_html(bytes: &[u8]) -> Option<String> {
    let text = extract_legacy_doc_text_from_bytes(bytes)?;
    let body = text
        .split('\n')
        .map(|line| {
            if line.trim().is_empty() {
                "<p><br></p>".to_string()
            } else {
                format!("<p>{}</p>", escape_preview_html(line))
            }
        })
        .collect::<Vec<_>>()
        .join("");

    Some(format!(
        r#"<html><head><meta charset="utf-8"><style>body{{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.8;color:#111827;}}p{{margin:0 0 10px;white-space:pre-wrap;}}</style></head><body>{body}</body></html>"#
    ))
}

#[tauri::command]
async fn convert_office_document_to_html(
    payload: OfficeHtmlPreviewPayload,
) -> Result<String, String> {
    if payload.source_bytes.is_empty() {
        return Err("Word 预览需要提供文档内容。".to_string());
    }

    let (work_dir, input_path, html_path) = build_office_preview_temp_paths(
        payload.file_name.as_deref(),
        payload.extension.as_deref(),
    )?;
    fs::write(&input_path, &payload.source_bytes)
        .map_err(|error| format!("写入 Word 预览临时文件失败: {error}"))?;

    let mut errors = Vec::new();
    let html_result = match convert_office_to_html_with_soffice(&input_path, &work_dir) {
        Ok(Some(path)) => Some(path),
        Ok(None) => None,
        Err(error) => {
            errors.push(error);
            None
        }
    }
    .or_else(
        || match convert_office_to_html_with_textutil(&input_path, &html_path) {
            Ok(path) => path,
            Err(error) => {
                errors.push(error);
                None
            }
        },
    );

    let html = if let Some(html_path) = html_result {
        fs::read_to_string(&html_path)
            .map_err(|error| format!("读取 Word 预览 HTML 失败: {error}"))?
    } else if payload
        .extension
        .as_deref()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("doc"))
    {
        legacy_doc_text_preview_html(&payload.source_bytes).ok_or_else(|| {
            if errors.is_empty() {
                "未检测到可用的 Word 预览转换器，且无法从 DOC 中解析出可预览内容。".to_string()
            } else {
                format!(
                    "Word 文档预览转换失败，且无法从 DOC 中解析出可预览内容：{}",
                    errors.join("；")
                )
            }
        })?
    } else {
        return Err(if errors.is_empty() {
            "未检测到 LibreOffice/soffice 或系统 Word 转换器，无法生成 Word 原文档预览。"
                .to_string()
        } else {
            format!("Word 文档预览转换失败：{}", errors.join("；"))
        });
    };

    let _ = fs::remove_dir_all(&work_dir);
    Ok(html)
}

#[tauri::command]
async fn extract_legacy_doc_text(payload: LegacyDocTextPayload) -> Result<String, String> {
    let input_path_from_payload = payload
        .input_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);

    let bytes = if let Some(path) = input_path_from_payload {
        if !path.exists() {
            return Err("待解析的 DOC 文件不存在。".to_string());
        }
        fs::read(&path).map_err(|error| format!("读取 DOC 文件失败: {error}"))?
    } else if let Some(bytes) = payload.source_bytes.as_deref() {
        bytes.to_vec()
    } else {
        return Err("解析 DOC 需要提供文件路径或文件字节内容。".to_string());
    };

    extract_legacy_doc_text_from_bytes(&bytes)
        .ok_or_else(|| "DOC 文档解析完成，但未提取到可用文本。请确认文件未加密或损坏。".to_string())
}

#[tauri::command]
async fn mask_legacy_doc_document(payload: LegacyDocMaskPayload) -> Result<Vec<u8>, String> {
    let input_path_from_payload = payload
        .input_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);

    let bytes = if let Some(path) = input_path_from_payload {
        if !path.exists() {
            return Err("待脱敏的 DOC 文件不存在。".to_string());
        }
        fs::read(&path).map_err(|error| format!("读取 DOC 文件失败: {error}"))?
    } else if let Some(bytes) = payload.source_bytes.as_deref() {
        bytes.to_vec()
    } else {
        return Err("脱敏 DOC 需要提供文件路径或文件字节内容。".to_string());
    };

    build_masked_legacy_doc_bytes(&bytes, &payload.hit_list)
}

fn describe_ocr_failure(
    command_label: &str,
    status_code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> String {
    let stderr_lower = stderr.to_lowercase();
    let stdout_lower = stdout.to_lowercase();
    let combined = format!("{stderr_lower}\n{stdout_lower}");

    if combined.contains("no module named ocrmypdf")
        || combined.contains("ocrmypdf: command not found")
        || combined.contains("is not recognized as an internal or external command")
    {
        return build_ocr_not_installed_message();
    }

    if combined.contains("chi_sim") && combined.contains("language") {
        return "OCRmyPDF 已启动，但系统缺少 Tesseract 中文语言包 `chi_sim`。请安装中文语言数据后重试。".to_string();
    }

    if combined.contains("tesseract") && combined.contains("not installed") {
        return "OCRmyPDF 已检测到，但依赖的 `tesseract` 未安装。请先安装 Tesseract OCR 再重试。"
            .to_string();
    }

    if combined.contains("ghostscript") && combined.contains("not installed") {
        return "OCRmyPDF 已检测到，但依赖的 `ghostscript` 未安装。请先安装 Ghostscript 再重试。"
            .to_string();
    }

    let mut detail = stderr.trim().to_string();
    if detail.is_empty() {
        detail = stdout.trim().to_string();
    }
    if detail.is_empty() {
        detail = "未返回更多错误信息。".to_string();
    }

    format!(
        "调用 OCRmyPDF 失败（命令：{command_label}，退出码：{}）：{detail}",
        status_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "未知".to_string())
    )
}

fn build_worker_temp_paths(seed: &str) -> Result<(PathBuf, PathBuf), String> {
    let temp_root = env::temp_dir().join("ecmax-smart-contract-ocr");
    fs::create_dir_all(&temp_root).map_err(|error| format!("创建 OCR 临时目录失败: {error}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("生成 OCR worker 临时文件失败: {error}"))?
        .as_millis();
    let file_stem = sanitize_file_stem(Path::new(seed), "contract");

    Ok((
        temp_root.join(format!("{stamp}-{file_stem}-worker-input.json")),
        temp_root.join(format!("{stamp}-{file_stem}-worker-output.json")),
    ))
}

fn candidate_python_paths() -> Vec<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(manifest_dir.clone());

    let mut candidates = vec![
        workspace_root.join(".venv-ocr-worker/bin/python"),
        workspace_root.join(".venv-ocr-worker/bin/python3"),
        workspace_root.join(".venv-ocr-worker/Scripts/python.exe"),
    ];

    if let Some(path) = find_executable_in_path("python3") {
        candidates.push(path);
    }
    if let Some(path) = find_executable_in_path("python") {
        candidates.push(path);
    }

    candidates
}

fn resolve_worker_script_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("ocr-worker/rapidocr_worker.py"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("resources/ocr-worker/rapidocr_worker.py"));

    candidates
}

fn resolve_worker_binary_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("ocr-worker/rapidocr-worker"));
        candidates.push(resource_dir.join("ocr-worker/rapidocr-worker.exe"));
        candidates.push(resource_dir.join("binaries/rapidocr-worker"));
        candidates.push(resource_dir.join("binaries/rapidocr-worker.exe"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(manifest_dir.clone());
    candidates.push(workspace_root.join("src-tauri/binaries/rapidocr-worker"));
    candidates.push(workspace_root.join("src-tauri/binaries/rapidocr-worker.exe"));

    candidates
}

fn resolve_worker_command(app: &AppHandle) -> Result<(OsString, Vec<OsString>, String), String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_script_path = manifest_dir.join("resources/ocr-worker/rapidocr_worker.py");
    let workspace_root = manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(manifest_dir.clone());
    let workspace_python_candidates = vec![
        workspace_root.join(".venv-ocr-worker/bin/python"),
        workspace_root.join(".venv-ocr-worker/bin/python3"),
        workspace_root.join(".venv-ocr-worker/Scripts/python.exe"),
    ];

    if workspace_script_path.is_file() {
        for python in workspace_python_candidates {
            if python.is_file() {
                let label = format!("{} {}", python.display(), workspace_script_path.display());
                return Ok((
                    python.into_os_string(),
                    vec![workspace_script_path.as_os_str().to_os_string()],
                    label,
                ));
            }
        }
    }

    for candidate in resolve_worker_binary_paths(app) {
        if candidate.is_file() {
            let label = candidate.display().to_string();
            return Ok((candidate.into_os_string(), Vec::new(), label));
        }
    }

    for script_path in resolve_worker_script_paths(app) {
        if !script_path.is_file() {
            continue;
        }

        for python in candidate_python_paths() {
            if python.is_file() {
                let label = format!("{} {}", python.display(), script_path.display());
                return Ok((
                    python.into_os_string(),
                    vec![script_path.as_os_str().to_os_string()],
                    label,
                ));
            }
        }
    }

    Err(build_worker_not_installed_message())
}

fn describe_worker_failure(
    command_label: &str,
    status_code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> String {
    let combined = format!("{}\n{}", stderr.to_lowercase(), stdout.to_lowercase());

    if combined.contains("no module named 'rapidocr_onnxruntime'")
        || combined.contains("no module named rapidocr_onnxruntime")
        || combined.contains("no module named 'rapidocr'")
        || combined.contains("no module named rapidocr")
    {
        return "RapidOCR worker 已启动，但缺少 `rapidocr_onnxruntime` 依赖。请在 worker Python 环境里安装 `rapidocr_onnxruntime`。".to_string();
    }

    if combined.contains("no module named 'onnxruntime'")
        || combined.contains("no module named onnxruntime")
    {
        return "RapidOCR worker 已启动，但缺少 `onnxruntime` 依赖。请在 worker Python 环境里安装 `onnxruntime`。".to_string();
    }

    if combined.contains("no module named 'pil'") || combined.contains("no module named pil") {
        return "RapidOCR worker 已启动，但缺少 `Pillow` 依赖。请在 worker Python 环境里安装 `Pillow`。".to_string();
    }

    let mut detail = stderr.trim().to_string();
    if detail.is_empty() {
        detail = stdout.trim().to_string();
    }
    if detail.is_empty() {
        detail = "未返回更多错误信息。".to_string();
    }

    format!(
        "调用 RapidOCR worker 失败（命令：{command_label}，退出码：{}）：{detail}",
        status_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "未知".to_string())
    )
}

#[tauri::command]
async fn ocr_pdf_document(payload: PdfOcrPayload) -> Result<PdfOcrResult, String> {
    let input_path_from_payload = payload
        .input_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);

    let mut generated_input_path = None;
    let input_path = if let Some(path) = input_path_from_payload {
        path
    } else if let Some(bytes) = payload.source_bytes.as_deref() {
        let path = persist_input_bytes_for_ocr(payload.file_name.as_deref(), bytes)?;
        generated_input_path = Some(path.clone());
        path
    } else {
        return Err("执行 OCR 需要提供 PDF 文件路径或文件字节内容。".to_string());
    };

    if !input_path.exists() {
        return Err("待 OCR 的 PDF 文件不存在。".to_string());
    }

    let extension = input_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "pdf" {
        return Err("当前 OCR 流程仅支持 PDF 文件。".to_string());
    }

    let (output_path, sidecar_path) = build_ocr_output_paths(&input_path)?;
    let (program, mut base_args, command_label) =
        resolve_ocrmypdf_command().ok_or_else(build_ocr_not_installed_message)?;
    let language = payload
        .language
        .unwrap_or_else(|| "chi_sim+eng".to_string());

    base_args.extend([
        OsString::from("--skip-text"),
        OsString::from("--sidecar"),
        sidecar_path.as_os_str().to_os_string(),
        OsString::from("--language"),
        OsString::from(&language),
        input_path.as_os_str().to_os_string(),
        output_path.as_os_str().to_os_string(),
    ]);

    let execution = Command::new(&program).args(&base_args).output();

    if let Some(path) = generated_input_path {
        let _ = fs::remove_file(path);
    }

    let execution = execution.map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            build_ocr_not_installed_message()
        } else {
            format!("启动 OCRmyPDF 失败: {error}")
        }
    })?;

    let stdout = normalize_cli_output(&execution.stdout);
    let stderr = normalize_cli_output(&execution.stderr);

    if !execution.status.success() {
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&sidecar_path);
        return Err(describe_ocr_failure(
            &command_label,
            execution.status.code(),
            &stdout,
            &stderr,
        ));
    }

    if !output_path.exists() {
        return Err("OCRmyPDF 执行完成，但没有生成 OCR 后的 PDF 文件。".to_string());
    }

    let sidecar_text = fs::read_to_string(&sidecar_path).unwrap_or_default();

    Ok(PdfOcrResult {
        output_path: output_path.to_string_lossy().to_string(),
        sidecar_text,
        tool: "ocrmypdf".to_string(),
        command_label,
        language,
    })
}

#[tauri::command]
async fn ocr_pages_with_worker(
    app: AppHandle,
    payload: WorkerOcrRequest,
) -> Result<WorkerOcrInvokeResult, String> {
    if payload.pages.is_empty() {
        return Ok(WorkerOcrInvokeResult {
            tool: "rapidocr".to_string(),
            engine: "rapidocr_onnxruntime".to_string(),
            command_label: String::new(),
            pages: Vec::new(),
        });
    }

    let file_name = payload.file_name.as_deref().unwrap_or("contract.pdf");
    let (input_path, output_path) = build_worker_temp_paths(file_name)?;
    let (program, mut base_args, command_label) = resolve_worker_command(&app)?;

    let payload_json = serde_json::to_vec(&payload)
        .map_err(|error| format!("序列化 OCR worker 请求失败: {error}"))?;
    fs::write(&input_path, payload_json)
        .map_err(|error| format!("写入 OCR worker 输入文件失败: {error}"))?;

    base_args.extend([
        OsString::from("--input"),
        input_path.as_os_str().to_os_string(),
        OsString::from("--output"),
        output_path.as_os_str().to_os_string(),
    ]);

    let execution = Command::new(&program).args(&base_args).output();

    let _ = fs::remove_file(&input_path);

    let execution = execution.map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            build_worker_not_installed_message()
        } else {
            format!("启动 RapidOCR worker 失败: {error}")
        }
    })?;

    let stdout = normalize_cli_output(&execution.stdout);
    let stderr = normalize_cli_output(&execution.stderr);

    if !execution.status.success() {
        let _ = fs::remove_file(&output_path);
        return Err(describe_worker_failure(
            &command_label,
            execution.status.code(),
            &stdout,
            &stderr,
        ));
    }

    let output_bytes =
        fs::read(&output_path).map_err(|error| format!("读取 OCR worker 输出失败: {error}"))?;
    let _ = fs::remove_file(&output_path);

    let response: WorkerOcrResponse = serde_json::from_slice(&output_bytes)
        .map_err(|error| format!("解析 OCR worker 输出失败: {error}"))?;

    Ok(WorkerOcrInvokeResult {
        tool: response.tool,
        engine: response.engine,
        command_label,
        pages: response.pages,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            open_wecom_login_window,
            wecom_login_request,
            detect_chinese_entities,
            detect_llm_sensitive_entities,
            extract_legacy_doc_text,
            mask_legacy_doc_document,
            convert_office_document_to_html,
            ocr_pdf_document,
            ocr_pages_with_worker
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
