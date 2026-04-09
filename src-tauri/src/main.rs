#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::header::{ACCEPT, AUTHORIZATION, CACHE_CONTROL, CONNECTION, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const WECOM_LOGIN_EVENT: &str = "wecom-login-callback";
const WECOM_LOGIN_WINDOW_LABEL: &str = "wecom-login";
const WECOM_CALLBACK_URL: &str = "https://tauri.localhost/__wecom_callback__";
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
  grant_type: String,
  username: String,
  scope: String,
  app_desk_user_type: String,
  app_desk_id: String,
  app_desk_version: String,
  platform_client_id: String,
  mac: String,
  kick_out: Option<bool>,
  base_url: String,
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
  code: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct WecomLoginEventPayload {
  uuid: String,
  source_url: String,
}

fn extract_uuid_from_callback(url: &Url) -> Option<String> {
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

#[tauri::command]
fn open_wecom_login_window(app: AppHandle, login_url: String) -> Result<(), String> {
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
    .initialization_script(WECOM_LOGIN_INIT_SCRIPT)
    .on_navigation(move |url| {
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
    ("mac", payload.mac),
  ];

  if let Some(kick_out) = payload.kick_out {
    params.push(("kick_out", kick_out.to_string()));
  }

  let response = client
    .post(endpoint)
    .header(AUTHORIZATION, payload.client_authorization)
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

  if status.is_success() && payload.access_token.is_some() && payload.user_info.is_some() {
    return Ok(payload);
  }

  Err(
    payload
      .msg
      .or(payload.error_description)
      .or(payload.message)
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
