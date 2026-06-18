function createJiraIssue(ticket) {
  const jiraBaseUrl = getScriptSetting_('JIRA_BASE_URL', '');
  const jiraUsername = getScriptSetting_('JIRA_USERNAME', '');
  const jiraPassword = getScriptSetting_('JIRA_PASSWORD', '');
  const jiraMode = getScriptSetting_('JIRA_MODE', 'server');

  if (!jiraBaseUrl || !jiraUsername || !jiraPassword) {
    return {
      ok: false,
      skipped: true,
      message: '尚未設定 JIRA_BASE_URL / JIRA_USERNAME / JIRA_PASSWORD，已略過 JIRA 建單。'
    };
  }

  const dateText = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyyMMdd');

  const summary = '[' + ticket.ticket_id + '] ' +
    ticket.registration_subject + ' - ' +
    ticket.requester_name + ' - ' +
    dateText;

  const description = buildJiraDescription_(ticket);

  const fields = {
    project: {
      key: ticket.jira_project
    },
    summary: summary,
    description: description,
    issuetype: {
      name: ticket.jira_issue_type || 'Task'
    }
  };

  /**
   * 負責人：JIRA assignee
   * 來源：Service_Config.jira_assignee
   *
   * 你們是 Jira Server / Data Center：
   * assignee 格式使用 { name: "isaac.chen" }
   */
  if (ticket.jira_assignee) {
    if (jiraMode === 'cloud') {
      fields.assignee = {
        accountId: ticket.jira_assignee
      };
    } else {
      fields.assignee = {
        name: ticket.jira_assignee
      };
    }
  }

  /**
   * 報告人：JIRA reporter
   * 來源：註冊人 Email @ 前面
   *
   * 例如：
   * isaac.chen@lumens.com.tw → isaac.chen
   */
  const reporterUsername = inferJiraUsernameFromTicket_(ticket);
  if (reporterUsername) {
    if (jiraMode === 'cloud') {
      fields.reporter = {
        accountId: reporterUsername
      };
    } else {
      fields.reporter = {
        name: reporterUsername
      };
    }
  }

  /**
   * 到期日：JIRA duedate
   * 來源：表單希望完成日 due_date
   * JIRA duedate 格式需為 YYYY-MM-DD
   */
  const dueDate = normalizeJiraDate_(ticket.due_date);
  if (dueDate) {
    fields.duedate = dueDate;
  }

  const url = normalizeBaseUrl_(jiraBaseUrl) + '/rest/api/2/issue';
  const response = jiraFetch_(url, 'post', { fields: fields });

  if (!response.ok) {
    return {
      ok: false,
      message: response.message
    };
  }

  const data = response.data;
  const jiraKey = data.key || '';
  const jiraUrl = normalizeBaseUrl_(jiraBaseUrl) + '/browse/' + jiraKey;

  logAudit_('JIRA_CREATED', ticket.ticket_id, 'system', jiraKey);

  /**
   * 保險做法：
   * 建立 issue 成功後，再呼叫 assignee API 指派一次負責人。
   * 有些 Jira Project 在 create issue 時會忽略 assignee，
   * 但允許建立後再 assign。
   */
  if (jiraKey && ticket.jira_assignee) {
    const assignResult = setJiraAssignee_(jiraKey, ticket.jira_assignee, jiraMode);

    if (assignResult.ok) {
      logAudit_('JIRA_ASSIGNEE_SET', ticket.ticket_id, 'system', ticket.jira_assignee);
    } else {
      logAudit_(
        'JIRA_ASSIGNEE_FAILED',
        ticket.ticket_id,
        'system',
        ticket.jira_assignee,
        assignResult.message
      );
    }
  }

  return {
    ok: true,
    jira_key: jiraKey,
    jira_url: jiraUrl,
    jira_status: 'Open'
  };
}

function buildJiraDescription_(ticket) {
  return [
    'Ticket ID: ' + ticket.ticket_id,
    '申請人: ' + ticket.requester_name,
    '工號: ' + ticket.employee_id,
    '申請人部門: ' + ticket.requester_department,
    'Email: ' + ticket.requester_email,
    'JIRA Reporter: ' + inferJiraUsernameFromTicket_(ticket),
    '',
    '申請服務部門: ' + ticket.target_department,
    '需求類別: ' + ticket.service_category,
    '希望完成日: ' + ticket.due_date,
    '',
    '註冊主題:',
    ticket.registration_subject,
    '',
    '註冊說明:',
    ticket.registration_description,
    '',
    '附件:',
    formatAttachmentLinksForJira_(ticket.attachment_url)
  ].join('\n');
}

function formatAttachmentLinksForJira_(attachmentUrlText) {
  const text = String(attachmentUrlText || '').trim();

  if (!text) {
    return '無';
  }

  return text
    .split(/\n+/)
    .map(function (url, index) {
      return '附件 ' + (index + 1) + ': ' + url;
    })
    .join('\n');
}

function syncJiraTickets() {
  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.TICKETS);
  const statusMapping = getStatusMapping_();

  let updatedCount = 0;

  rows.forEach(function (ticket) {
    try {
      if (!ticket.jira_key) return;

      const jiraData = getJiraIssue(ticket.jira_key);

      if (!jiraData || !jiraData.ok) {
        logAudit_(
          'JIRA_SYNC_FAILED',
          ticket.ticket_id,
          'system',
          '',
          jiraData ? jiraData.message : '未知錯誤'
        );
        return;
      }

      const jiraStatus = jiraData.status || '';

      const mapped = mapJiraStatusToCenterStatus_(
        jiraStatus,
        jiraData.status_category_key,
        statusMapping
      );

      /**
       * 到期日以 JIRA duedate 為主。
       * 若 JIRA 沒有 duedate，才保留 Tickets 原本 due_date。
       */
      const dueDate = jiraData.duedate || normalizeDateString_(ticket.due_date);

      const displayStatus = calculateDisplayStatus_(
        mapped.center_status,
        dueDate,
        mapped.is_done
      );

      const updates = {
        jira_status: jiraStatus,
        center_status: mapped.center_status,
        display_status: displayStatus,
        due_date: dueDate || '',
        jira_last_comment: jiraData.last_comment || '',
        jira_last_comment_at: jiraData.last_comment_at || '',
        updated_at: jiraData.updated || formatDateTime_(new Date()),
        overdue_flag: displayStatus === APP_CONFIG.STATUS.OVERDUE ? 'TRUE' : 'FALSE'
      };

      if (mapped.is_done && !ticket.completed_at) {
        updates.completed_at = formatDateTime_(new Date());
      }

      updateObjectByRow_(APP_CONFIG.SHEETS.TICKETS, ticket.__rowNumber, updates);
      updatedCount++;

    } catch (err) {
      logAudit_('JIRA_SYNC_ERROR', ticket.ticket_id, 'system', '', err.message);
    }
  });

  logAudit_('JIRA_SYNC_DONE', '', 'system', '更新筆數：' + updatedCount);

  return {
    ok: true,
    updatedCount: updatedCount
  };
}

function getJiraIssue(jiraKey) {
  const jiraBaseUrl = getScriptSetting_('JIRA_BASE_URL', '');
  const jiraUsername = getScriptSetting_('JIRA_USERNAME', '');
  const jiraPassword = getScriptSetting_('JIRA_PASSWORD', '');

  if (!jiraBaseUrl || !jiraUsername || !jiraPassword) {
    return {
      ok: false,
      message: '尚未設定 JIRA 連線資訊。'
    };
  }

  /**
   * 同步需要抓：
   * status    狀態
   * comment   留言
   * updated   JIRA 最後更新時間
   * duedate   到期日
   * assignee  負責人
   * reporter  報告人
   */
  const url = normalizeBaseUrl_(jiraBaseUrl) +
    '/rest/api/2/issue/' +
    encodeURIComponent(jiraKey) +
    '?fields=status,comment,updated,duedate,assignee,reporter';

  const response = jiraFetch_(url, 'get');

  if (!response.ok) {
    return response;
  }

  const issue = response.data;
  const fields = issue.fields || {};

  const statusObj = fields.status || {};
  const status = statusObj.name || '';

  const statusCategory = statusObj.statusCategory || {};
  const statusCategoryKey = statusCategory.key || '';
  const statusCategoryName = statusCategory.name || '';

  const duedate = fields.duedate || '';

  const updated = fields.updated
    ? formatDateTime_(new Date(fields.updated))
    : '';

  const assigneeName = fields.assignee && fields.assignee.name
    ? fields.assignee.name
    : '';

  const assigneeDisplayName = fields.assignee && fields.assignee.displayName
    ? fields.assignee.displayName
    : '';

  const reporterName = fields.reporter && fields.reporter.name
    ? fields.reporter.name
    : '';

  const reporterDisplayName = fields.reporter && fields.reporter.displayName
    ? fields.reporter.displayName
    : '';

  let lastComment = '';
  let lastCommentAt = '';

  const comments = fields.comment && fields.comment.comments
    ? fields.comment.comments
    : [];

  if (comments.length > 0) {
    const last = comments[comments.length - 1];

    const author = last.author && last.author.displayName
      ? last.author.displayName
      : '';

    const body = typeof last.body === 'string'
      ? last.body
      : JSON.stringify(last.body || '');

    lastComment = author ? author + '：' + body : body;
    lastCommentAt = last.updated ? formatDateTime_(new Date(last.updated)) : '';
  }

  return {
    ok: true,
    status: status,
    status_category_key: statusCategoryKey,
    status_category_name: statusCategoryName,
    duedate: duedate,
    updated: updated,
    assignee_name: assigneeName,
    assignee_display_name: assigneeDisplayName,
    reporter_name: reporterName,
    reporter_display_name: reporterDisplayName,
    last_comment: lastComment,
    last_comment_at: lastCommentAt
  };
}

function setJiraAssignee_(jiraKey, assigneeUsername, jiraMode) {
  if (!jiraKey || !assigneeUsername) {
    return {
      ok: false,
      message: '缺少 jiraKey 或 assigneeUsername'
    };
  }

  const jiraBaseUrl = getScriptSetting_('JIRA_BASE_URL', '');

  const payload = jiraMode === 'cloud'
    ? { accountId: assigneeUsername }
    : { name: assigneeUsername };

  const url = normalizeBaseUrl_(jiraBaseUrl) +
    '/rest/api/2/issue/' +
    encodeURIComponent(jiraKey) +
    '/assignee';

  const response = jiraFetch_(url, 'put', payload);

  if (!response.ok) {
    return {
      ok: false,
      message: response.message
    };
  }

  return {
    ok: true
  };
}

function jiraFetch_(url, method, payload) {
  const jiraUsername = getScriptSetting_('JIRA_USERNAME', '');
  const jiraPassword = getScriptSetting_('JIRA_PASSWORD', '');

  const options = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(jiraUsername + ':' + jiraPassword),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  const text = res.getContentText();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { raw: text };
  }

  if (code < 200 || code >= 300) {
    return {
      ok: false,
      code: code,
      message: 'JIRA API 錯誤 ' + code + '：' + text,
      data: data
    };
  }

  return {
    ok: true,
    code: code,
    data: data
  };
}

function getStatusMapping_() {
  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.STATUS_MAPPING);
  const mapping = {};

  rows.forEach(function (row) {
    const jiraStatus = String(row.jira_status || '').trim();
    if (!jiraStatus) return;

    mapping[jiraStatus] = {
      center_status: String(row.center_status || APP_CONFIG.STATUS.OPEN).trim(),
      is_done: String(row.is_done).toUpperCase() === 'TRUE'
    };
  });

  return mapping;
}

function mapJiraStatusToCenterStatus_(jiraStatus, statusCategoryKey, statusMapping) {
  const statusName = String(jiraStatus || '').trim();
  const categoryKey = String(statusCategoryKey || '').trim().toLowerCase();

  /**
   * 第一優先：
   * 依 Status_Mapping tab 設定。
   */
  if (statusMapping && statusMapping[statusName]) {
    return statusMapping[statusName];
  }

  /**
   * 第二優先：
   * 依 Jira statusCategory 判斷。
   * 常見 key：
   * new / indeterminate / done
   */
  if (categoryKey === 'done') {
    return {
      center_status: APP_CONFIG.STATUS.DONE,
      is_done: true
    };
  }

  /**
   * 第三保護：
   * 常見中英文完成狀態。
   */
  const doneNames = [
    'done',
    'resolved',
    'closed',
    'complete',
    'completed',
    '結案',
    '已結案',
    '完成',
    '已完成',
    '關閉',
    '已關閉'
  ];

  if (doneNames.indexOf(statusName.toLowerCase()) >= 0) {
    return {
      center_status: APP_CONFIG.STATUS.DONE,
      is_done: true
    };
  }

  return {
    center_status: APP_CONFIG.STATUS.OPEN,
    is_done: false
  };
}

function calculateDisplayStatus_(centerStatus, dueDate, isDone) {
  if (isDone || centerStatus === APP_CONFIG.STATUS.DONE) {
    return APP_CONFIG.STATUS.DONE;
  }

  if (dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const due = parseJiraDate_(dueDate);
    if (due) {
      due.setHours(0, 0, 0, 0);

      if (due < today) {
        return APP_CONFIG.STATUS.OVERDUE;
      }
    }
  }

  return APP_CONFIG.STATUS.OPEN;
}

function normalizeBaseUrl_(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Reporter / 報告人：
 * 從註冊人 Email 取 @ 前面。
 *
 * 例如：
 * isaac.chen@lumens.com.tw → isaac.chen
 */
function inferJiraUsernameFromTicket_(ticket) {
  const email = String(ticket.requester_email || '').trim();

  if (email && email.indexOf('@') > 0) {
    return email.split('@')[0].trim();
  }

  return '';
}

/**
 * 給 JIRA 建單用。
 * JIRA duedate 格式建議 YYYY-MM-DD。
 */
function normalizeJiraDate_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) {
    return text.replace(/\//g, '-');
  }

  const date = new Date(text);
  if (!isNaN(date.getTime())) {
    return Utilities.formatDate(date, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  return '';
}

function parseJiraDate_(value) {
  if (!value) return null;

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value;
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parts = text.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) {
    const parts = text.split('/');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  const date = new Date(text);
  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}

/**
 * 手動執行一次，可建立每 15 分鐘同步 JIRA 狀態的 Trigger。
 */
function installJiraSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncJiraTickets') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('syncJiraTickets')
    .timeBased()
    .everyMinutes(15)
    .create();

  return 'JIRA 定時同步 Trigger 已建立：每 15 分鐘執行一次。';
}

/**
 * 測試 JIRA 連線用。
 */
function testJiraConnection() {
  const jiraBaseUrl = getScriptSetting_('JIRA_BASE_URL', '');

  if (!jiraBaseUrl) {
    throw new Error('尚未設定 JIRA_BASE_URL');
  }

  const url = normalizeBaseUrl_(jiraBaseUrl) + '/rest/api/2/myself';
  const response = jiraFetch_(url, 'get');

  if (!response.ok) {
    throw new Error(response.message);
  }

  Logger.log(JSON.stringify(response.data, null, 2));

  return {
    ok: true,
    name: response.data.name || '',
    displayName: response.data.displayName || '',
    emailAddress: response.data.emailAddress || ''
  };
}

/**
 * 測試單一 Issue 同步資料。
 * 使用方式：
 * 先把 jiraKey 改成實際 issue key，再手動執行。
 */
function testGetJiraIssue() {
  const jiraKey = '請改成你的測試 JIRA KEY';
  const res = getJiraIssue(jiraKey);
  Logger.log(JSON.stringify(res, null, 2));
  return res;
}

/**
 * 測試指定 Assignee。
 * 使用方式：
 * 先把 jiraKey 與 assigneeUsername 改成實際值，再手動執行。
 */
function testSetJiraAssignee() {
  const jiraKey = 'PDMR-77';
  const assigneeUsername = 'isaac.chen';

  const result = setJiraAssignee_(jiraKey, assigneeUsername, 'server');
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}