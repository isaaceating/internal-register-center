function getInitialData() {
  return {
    appName: APP_CONFIG.APP_NAME,
    serviceOptions: getServiceOptions(),
    today: formatDateOnly_(new Date())
  };
}

function getServiceOptions() {
  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.SERVICE_CONFIG)
    .filter(function (row) {
      return String(row.active).toUpperCase() === 'TRUE';
    });

  const departments = [];
  const categoriesByDepartment = {};

  rows.forEach(function (row) {
    const dept = String(row.target_department || '').trim();
    const category = String(row.service_category || '').trim();

    if (!dept || !category) return;

    if (departments.indexOf(dept) === -1) {
      departments.push(dept);
    }

    if (!categoriesByDepartment[dept]) {
      categoriesByDepartment[dept] = [];
    }

    if (categoriesByDepartment[dept].indexOf(category) === -1) {
      categoriesByDepartment[dept].push(category);
    }
  });

  return {
    departments: departments,
    categoriesByDepartment: categoriesByDepartment
  };
}

function lookupEmployee(employeeId) {
  const id = String(employeeId || '').trim();
  if (!id) {
    return { found: false, message: '請輸入工號。' };
  }

  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.EMPLOYEES);
  const employee = rows.find(function (row) {
    return String(row.employee_id).trim() === id &&
      String(row.active).toUpperCase() === 'TRUE';
  });

  if (!employee) {
    return {
      found: false,
      message: '查無此工號，請確認 Employees 表是否已建立。'
    };
  }

  return {
    found: true,
    employee: {
      employee_id: String(employee.employee_id || ''),
      name: String(employee.name || ''),
      department: String(employee.department || ''),
      email: String(employee.email || '')
    }
  };
}

function submitTicket(payload) {
  try {
    validateTicketPayload_(payload);

    const now = new Date();
    const ticketId = generateTicketId_();
    const service = findServiceConfig_(payload.target_department, payload.service_category);

    if (!service) {
      throw new Error('找不到對應的 Service_Config，請確認申請服務部門與需求類別設定。');
    }

    const attachmentUrl = handleAttachments_(payload.attachments || payload.attachment);

    const ticket = {
      ticket_id: ticketId,
      employee_id: clean_(payload.employee_id),
      requester_department: clean_(payload.requester_department),
      requester_name: clean_(payload.requester_name),
      requester_email: clean_(payload.requester_email),
      target_department: clean_(payload.target_department),
      service_category: clean_(payload.service_category),
      registration_subject: clean_(payload.registration_subject),
      registration_description: clean_(payload.registration_description),
      attachment_url: attachmentUrl || clean_(payload.attachment_url),
      due_date: clean_(payload.due_date),
      display_status: APP_CONFIG.STATUS.OPEN,
      center_status: APP_CONFIG.STATUS.OPEN,
      jira_key: '',
      jira_url: '',
      jira_project: clean_(service.jira_project),
      jira_issue_type: clean_(service.jira_issue_type),
      jira_assignee: clean_(service.jira_assignee),
      owner_email: clean_(service.owner_email),
      cc_group: clean_(service.cc_group),
      jira_status: '',
      jira_last_comment: '',
      jira_last_comment_at: '',
      created_at: formatDateTime_(now),
      updated_at: formatDateTime_(now),
      completed_at: '',
      overdue_flag: 'FALSE'
    };

    appendObject_(APP_CONFIG.SHEETS.TICKETS, ticket);
    logAudit_('CREATE_TICKET', ticketId, ticket.requester_email, 'Ticket 已建立');

    let jiraResult = null;

    try {
      jiraResult = createJiraIssue(ticket);

      if (jiraResult && jiraResult.ok) {
        const row = findRowByValue_(APP_CONFIG.SHEETS.TICKETS, 'ticket_id', ticketId);

        if (row) {
          updateObjectByRow_(APP_CONFIG.SHEETS.TICKETS, row.__rowNumber, {
            jira_key: jiraResult.jira_key,
            jira_url: jiraResult.jira_url,
            jira_status: jiraResult.jira_status || '',
            updated_at: formatDateTime_(new Date())
          });
        }

        ticket.jira_key = jiraResult.jira_key;
        ticket.jira_url = jiraResult.jira_url;
        ticket.jira_status = jiraResult.jira_status || '';
      } else if (jiraResult && jiraResult.skipped) {
        logAudit_('JIRA_SKIPPED', ticketId, 'system', jiraResult.message);
      } else if (jiraResult) {
        logAudit_('JIRA_CREATE_FAILED', ticketId, 'system', '', jiraResult.message);
      }
    } catch (jiraErr) {
      logAudit_('JIRA_CREATE_ERROR', ticketId, 'system', '', jiraErr.message);
    }

    try {
      sendTicketCreatedEmail(ticket);
    } catch (mailErr) {
      logAudit_('EMAIL_ERROR', ticketId, 'system', '', mailErr.message);
    }

    return {
      ok: true,
      ticket_id: ticketId,
      jira_key: ticket.jira_key || '',
      jira_url: ticket.jira_url || '',
      message: '註冊申請已送出。'
    };

  } catch (err) {
    logAudit_('SUBMIT_ERROR', '', clean_(payload && payload.requester_email), '', err.message);

    return {
      ok: false,
      message: err.message
    };
  }
}

function validateTicketPayload_(payload) {
  if (!payload) throw new Error('缺少表單資料。');

  const required = [
    ['employee_id', '工號'],
    ['requester_department', '部門'],
    ['requester_name', '姓名'],
    ['requester_email', 'Email'],
    ['target_department', '申請服務部門'],
    ['service_category', '需求類別'],
    ['registration_subject', '註冊主題'],
    ['registration_description', '註冊說明'],
    ['due_date', '希望完成日']
  ];

  required.forEach(function (item) {
    if (!clean_(payload[item[0]])) {
      throw new Error('請填寫：' + item[1]);
    }
  });

  if (clean_(payload.registration_subject).length > 120) {
    throw new Error('註冊主題請控制在 120 字以內。');
  }
}

function generateTicketId_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const config = readSystemConfig_();
    const prefix = String(config.ticket_prefix || 'IRC');
    const seq = Number(config.ticket_sequence || 1);
    const ticketId = prefix + '-' + String(seq).padStart(4, '0');

    setSystemConfigValue_('ticket_sequence', seq + 1);

    return ticketId;
  } finally {
    lock.releaseLock();
  }
}

function findServiceConfig_(targetDepartment, serviceCategory) {
  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.SERVICE_CONFIG);

  return rows.find(function (row) {
    return String(row.active).toUpperCase() === 'TRUE' &&
      String(row.target_department).trim() === String(targetDepartment).trim() &&
      String(row.service_category).trim() === String(serviceCategory).trim();
  }) || null;
}

function handleAttachments_(attachments) {
  if (!attachments) return '';

  const folderId = getScriptSetting_('ATTACHMENT_FOLDER_ID', '');
  if (!folderId) {
    return '';
  }

  let list = [];

  if (Array.isArray(attachments)) {
    list = attachments;
  } else {
    list = [attachments];
  }

  list = list.filter(function (item) {
    return item && item.data && item.name;
  });

  if (list.length === 0) return '';

  if (list.length > 5) {
    throw new Error('附件最多只能上傳 5 個。');
  }

  const folder = DriveApp.getFolderById(folderId);
  const urls = [];

  list.forEach(function (attachment) {
    const bytes = Utilities.base64Decode(attachment.data);

    if (bytes.length > 10 * 1024 * 1024) {
      throw new Error('附件「' + attachment.name + '」超過 10MB，請壓縮或改用 Drive 連結。');
    }

    const blob = Utilities.newBlob(
      bytes,
      attachment.mimeType || 'application/octet-stream',
      attachment.name
    );

    const file = folder.createFile(blob);
    urls.push(file.getUrl());
  });

  return urls.join('\n');
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}