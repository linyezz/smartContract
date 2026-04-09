#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::header::{ACCEPT, AUTHORIZATION, CACHE_CONTROL, CONNECTION, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const WECOM_LOGIN_EVENT: &str = "wecom-login-callback";
const WECOM_LOGIN_WINDOW_LABEL: &str = "wecom-login";
const WECOM_CALLBACK_URL: &str = "https://tauri.localhost/__wecom_callback__";
const WECOM_CLIENT_AUTHORIZATION_HEADER: &str = "clientAuthorization";
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
fn open_wecom_login_window(app: AppHandle, login_url: String) -> Result<(), String> {
  // 已经打开过登录窗口时，直接聚焦，避免重复打开多个扫码窗。
  if let Some(window) = app.get_webview_window(WECOM_LOGIN_WINDOW_LABEL) {
    let _ = window.set_focus();
    return Ok(());
  }

  let app_handle = app.clone();
  let window_label = WECOM_LOGIN_WINDOW_LABEL.to_string();

  WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::External(login_url.parse().map_err(|error| format!("企微登录地址无效: {error}"))?))
    .title("企业微信登录")
    .inner_size(640.0, 760.0)
    .min_inner_size(480.0, 640.0)
    .center()
    .resizable(true)
    .focused(true)
    .visible(true)
    // 给远端登录页注入一个假的 opener.postMessage，把浏览器回调桥接成 Tauri 可拦截的地址。
    .initialization_script(WECOM_LOGIN_INIT_SCRIPT)
    .on_navigation(move |url| {
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

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
      open_wecom_login_window,
      wecom_login_request
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
