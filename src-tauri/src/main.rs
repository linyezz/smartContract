#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chinese_ner::{ChineseNER, NamedEntity};
use reqwest::header::{ACCEPT, AUTHORIZATION, CACHE_CONTROL, CONNECTION, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
  env,
  ffi::OsString,
  fs,
  io::ErrorKind,
  path::{Path, PathBuf},
  process::Command,
  time::{SystemTime, UNIX_EPOCH},
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfOcrPayload {
  input_path: Option<String>,
  source_bytes: Option<Vec<u8>>,
  file_name: Option<String>,
  language: Option<String>,
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
    let _ = app.emit_to("main", WECOM_LOGIN_DEBUG_EVENT, "企微登录窗口已存在，已尝试聚焦。");
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
  let endpoint = format!(
    "{}/oauth2/token",
    payload.base_url.trim_end_matches('/')
  );

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

  Err(
    payload
      .msg
      .or(payload.error_description)
      .or(payload.message)
      .or_else(|| payload.code.and_then(stringify_json_value))
      .unwrap_or_else(|| format!("企微登录失败，HTTP {}", status.as_u16())),
  )
}

fn slice_chars(text: &str, start: usize, end: usize) -> String {
  text.chars().skip(start).take(end.saturating_sub(start)).collect()
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

fn describe_ocr_failure(command_label: &str, status_code: Option<i32>, stdout: &str, stderr: &str) -> String {
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
    return "OCRmyPDF 已检测到，但依赖的 `tesseract` 未安装。请先安装 Tesseract OCR 再重试。".to_string();
  }

  if combined.contains("ghostscript") && combined.contains("not installed") {
    return "OCRmyPDF 已检测到，但依赖的 `ghostscript` 未安装。请先安装 Ghostscript 再重试。".to_string();
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

fn describe_worker_failure(command_label: &str, status_code: Option<i32>, stdout: &str, stderr: &str) -> String {
  let combined = format!("{}\n{}", stderr.to_lowercase(), stdout.to_lowercase());

  if combined.contains("no module named 'rapidocr_onnxruntime'")
    || combined.contains("no module named rapidocr_onnxruntime")
    || combined.contains("no module named 'rapidocr'")
    || combined.contains("no module named rapidocr")
  {
    return "RapidOCR worker 已启动，但缺少 `rapidocr_onnxruntime` 依赖。请在 worker Python 环境里安装 `rapidocr_onnxruntime`。".to_string();
  }

  if combined.contains("no module named 'onnxruntime'") || combined.contains("no module named onnxruntime") {
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
async fn ocr_pages_with_worker(app: AppHandle, payload: WorkerOcrRequest) -> Result<WorkerOcrInvokeResult, String> {
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

  let payload_json =
    serde_json::to_vec(&payload).map_err(|error| format!("序列化 OCR worker 请求失败: {error}"))?;
  fs::write(&input_path, payload_json).map_err(|error| format!("写入 OCR worker 输入文件失败: {error}"))?;

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

  let output_bytes = fs::read(&output_path).map_err(|error| format!("读取 OCR worker 输出失败: {error}"))?;
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
      ocr_pdf_document,
      ocr_pages_with_worker
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
