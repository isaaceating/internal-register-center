const APP_CONFIG = {
  APP_NAME: '內部註冊中心',
  SPREADSHEET_ID: '1LIl3XaVUinhSybma3aZwS7G5Hixeop981LNky1Ourtg',
  TIMEZONE: 'Asia/Taipei',

  SHEETS: {
    TICKETS: 'Tickets',
    SERVICE_CONFIG: 'Service_Config',
    EMPLOYEES: 'Employees',
    STATUS_MAPPING: 'Status_Mapping',
    PERMISSIONS: 'Permissions',
    SYSTEM_CONFIG: 'System_Config',
    AUDIT_LOG: 'Audit_Log'
  },

  STATUS: {
    OPEN: 'Open',
    OVERDUE: 'Overdue',
    DONE: 'Done'
  }
};

function getScriptSetting_(key, fallback) {
  const props = PropertiesService.getScriptProperties();
  const value = props.getProperty(key);
  return value || fallback || '';
}

/**
 * 第一次使用前可手動執行一次，建立必要 Script Properties 範例。
 *
 * 你們目前是地端 Jira Server / Data Center：
 * - JIRA_BASE_URL = https://jira.lumens.tw
 * - JIRA_USERNAME = 公司帳號，例如 isaac.chen
 * - JIRA_PASSWORD = Jira 密碼
 * - JIRA_MODE = server
 *
 * 注意：
 * 你已經設定好 Script Properties 的話，這個 function 不一定要再執行。
 */
function setupScriptPropertiesExample() {
  const props = PropertiesService.getScriptProperties();

  const defaults = {
    JIRA_BASE_URL: 'https://jira.lumens.tw',
    JIRA_USERNAME: '',
    JIRA_PASSWORD: '',
    JIRA_MODE: 'server',
    ATTACHMENT_FOLDER_ID: ''
  };

  Object.keys(defaults).forEach(function (key) {
    if (!props.getProperty(key)) {
      props.setProperty(key, defaults[key]);
    }
  });

  return 'Script Properties 範例已建立，請到 Project Settings > Script Properties 補上實際值。';
}