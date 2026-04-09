import { invoke } from '@tauri-apps/api/core'

export const WECOM_CONFIG = {
  loginUrl:
    'https://idaas-auth.ecmax.cn/sso/render?thirdOAuthType=WORK_WECHAT_SCAN&state=browser_plugin',
  baseUrl: 'https://idaas-auth.ecmax.cn',
  appDeskId: '2042146917908316161',
  // appDeskId: '1771048544751636482',
  appDeskVersion: '1.0.0',
  platformClientId: 'rpa_app_desk',
  // clientAuthorization: 'Basic YnJvd3Nlcl9wbHVnaW46c2VjcmV0',
  clientAuthorization: 'Basic cnBhX2FwcF9kZXNrOnNlY3JldA',
  macStorageKey: 'ecmax.wecom.macId'
}

export const WECOM_LOGIN_EVENT = 'wecom-login-callback'

export function getWecomMachineId() {
  const existing = localStorage.getItem(WECOM_CONFIG.macStorageKey)
  if (existing) {
    return existing
  }

  const value = `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
  localStorage.setItem(WECOM_CONFIG.macStorageKey, value)
  return value
}

export function openWecomLoginWindow() {
  return invoke('open_wecom_login_window', {
    loginUrl: WECOM_CONFIG.loginUrl
  })
}

export function buildWecomLoginPayload(uuid) {
  return {
    grantType: 'app_desk',
    username: uuid,
    scope: 'ALL',
    appDeskUserType: 'INNER',
    appDeskId: WECOM_CONFIG.appDeskId,
    appDeskVersion: WECOM_CONFIG.appDeskVersion,
    platformClientId: WECOM_CONFIG.platformClientId,
    mac: getWecomMachineId(),
    baseUrl: WECOM_CONFIG.baseUrl,
    clientAuthorization: WECOM_CONFIG.clientAuthorization
  }
}

export async function requestWecomLogin(uuid) {
  return invoke('wecom_login_request', {
    payload: buildWecomLoginPayload(uuid)
  })
}

export function normalizeWecomProfile(rawProfile = {}) {
  const wecomUserId =
    rawProfile.userid ||
    rawProfile.userId ||
    rawProfile.username ||
    rawProfile.open_userid ||
    rawProfile.unionid ||
    ''

  return {
    wecomUserId,
    username: rawProfile.username || wecomUserId || '',
    name:
      rawProfile.realName ||
      rawProfile.name ||
      rawProfile.nickname ||
      rawProfile.username ||
      '企业微信成员',
    title:
      rawProfile.title ||
      rawProfile.position ||
      rawProfile.departmentName ||
      rawProfile.userType ||
      '企业微信成员',
    email: rawProfile.email || '',
    phone: rawProfile.mobile || rawProfile.phone || '',
    avatar:
      rawProfile.avatar ||
      rawProfile.headimgurl ||
      rawProfile.profilePhoto ||
      rawProfile.photo ||
      '',
    rawProfile
  }
}
