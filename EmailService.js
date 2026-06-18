function sendTicketCreatedEmail(ticket) {
  const subject = '[內部服務註冊中心] ' + ticket.ticket_id + ' - ' + ticket.registration_subject;

  const plainBody = [
    '您好，',
    '',
    '您的註冊申請已建立。',
    '',
    '註冊編號：' + ticket.ticket_id,
    '申請人：' + ticket.requester_name,
    '工號：' + ticket.employee_id,
    '申請人部門：' + ticket.requester_department,
    '申請服務部門：' + ticket.target_department,
    '需求類別：' + ticket.service_category,
    '註冊主題：' + ticket.registration_subject,
    '希望完成日：' + ticket.due_date,
    '',
    '註冊說明：',
    stripUrlsForPlainText_(ticket.registration_description),
    '',
    '附件與 JIRA 連結請開啟 HTML 版本信件查看。',
    '',
    '系統已通知負責窗口，請等待處理。',
    '',
    'Internal Service Registration Center / 內部服務註冊中心'
  ].join('\n');

  const htmlBody = buildTicketCreatedEmailHtml_(ticket);

  const toList = [];
  if (ticket.requester_email) toList.push(ticket.requester_email);
  if (ticket.owner_email) toList.push(ticket.owner_email);

  const cc = ticket.cc_group || '';

  if (toList.length === 0) {
    throw new Error('沒有可寄送的收件人。');
  }

  MailApp.sendEmail({
    to: uniqueEmails_(toList.join(',')),
    cc: uniqueEmails_(cc),
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody
  });

  logAudit_('EMAIL_SENT', ticket.ticket_id, 'system', '寄送建立通知信');
}

function buildTicketCreatedEmailHtml_(ticket) {
  const descriptionHtml = formatDescriptionForEmailHtml_(ticket.registration_description);
  const attachmentHtml = formatAttachmentLinksForEmailHtml_(ticket.attachment_url);
  const jiraHtml = ticket.jira_url
    ? '<a class="button" href="' + escapeHtml_(ticket.jira_url) + '" target="_blank">開啟 JIRA</a>'
    : '<span class="muted">尚未建立 / 尚未設定 JIRA</span>';

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="UTF-8">',
    '<style>',
    'body { margin:0; padding:0; background:#f5f7fb; font-family: Arial, "Microsoft JhengHei", sans-serif; color:#172033; }',
    '.wrap { padding:24px; }',
    '.card { max-width:720px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:18px; overflow:hidden; }',
    '.header { padding:22px 24px; background:#eaf1ff; border-bottom:1px solid #c7d7fe; }',
    '.header h1 { margin:0; font-size:22px; color:#1e3a8a; }',
    '.header p { margin:8px 0 0; color:#4b5563; font-size:14px; }',
    '.body { padding:22px 24px; }',
    '.section { margin-top:18px; }',
    '.section-title { font-size:13px; font-weight:700; color:#6b7280; margin-bottom:8px; }',
    '.info-table { width:100%; border-collapse:collapse; }',
    '.info-table th { width:150px; text-align:left; vertical-align:top; padding:9px 10px; background:#f9fafb; border-bottom:1px solid #edf0f4; color:#6b7280; font-size:13px; }',
    '.info-table td { padding:9px 10px; border-bottom:1px solid #edf0f4; color:#172033; font-size:13px; }',
    '.description { white-space:pre-wrap; line-height:1.6; padding:12px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; font-size:13px; }',
    '.button { display:inline-block; padding:10px 14px; background:#2563eb; color:#ffffff !important; text-decoration:none; border-radius:12px; font-weight:700; font-size:13px; margin:4px 8px 4px 0; }',
    '.link-list a { display:inline-block; margin:4px 8px 4px 0; color:#2563eb; font-weight:700; text-decoration:none; }',
    '.muted { color:#6b7280; }',
    '.footer { padding:16px 24px; background:#f9fafb; border-top:1px solid #e5e7eb; color:#6b7280; font-size:12px; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    '<div class="card">',
    '<div class="header">',
    '<h1>註冊申請已建立</h1>',
    '<p>系統已建立您的申請，並通知負責窗口處理。</p>',
    '</div>',
    '<div class="body">',
    '<table class="info-table">',
    rowHtml_('註冊編號', ticket.ticket_id),
    rowHtml_('申請人', ticket.requester_name),
    rowHtml_('工號', ticket.employee_id),
    rowHtml_('申請人部門', ticket.requester_department),
    rowHtml_('申請服務部門', ticket.target_department),
    rowHtml_('需求類別', ticket.service_category),
    rowHtml_('註冊主題', ticket.registration_subject),
    rowHtml_('希望完成日', ticket.due_date),
    '</table>',
    '<div class="section">',
    '<div class="section-title">註冊說明</div>',
    '<div class="description">' + descriptionHtml + '</div>',
    '</div>',
    '<div class="section">',
    '<div class="section-title">附件</div>',
    '<div class="link-list">' + attachmentHtml + '</div>',
    '</div>',
    '<div class="section">',
    '<div class="section-title">JIRA</div>',
    jiraHtml,
    '</div>',
    '</div>',
    '<div class="footer">',
    'Internal Service Registration Center / 內部服務註冊中心',
    '</div>',
    '</div>',
    '</div>',
    '</body>',
    '</html>'
  ].join('');
}

function rowHtml_(label, value) {
  return '<tr><th>' + escapeHtml_(label) + '</th><td>' + escapeHtml_(value || '') + '</td></tr>';
}

function formatAttachmentLinksForEmailHtml_(attachmentUrlText) {
  const text = String(attachmentUrlText || '').trim();

  if (!text) {
    return '<span class="muted">無</span>';
  }

  const urls = text.split(/\n+/).filter(Boolean);

  return urls.map(function (url, index) {
    return '<a href="' + escapeHtml_(url) + '" target="_blank">開啟附件 ' + (index + 1) + '</a>';
  }).join('');
}

function formatDescriptionForEmailHtml_(description) {
  const text = String(description || '').trim();

  if (!text) {
    return '';
  }

  let linkIndex = 0;

  const escaped = escapeHtml_(text);

  return escaped.replace(/https?:\/\/[^\s<]+/g, function (url) {
    linkIndex++;
    return '<a href="' + url + '" target="_blank">開啟連結 ' + linkIndex + '</a>';
  });
}

function stripUrlsForPlainText_(text) {
  return String(text || '').replace(/https?:\/\/[^\s]+/g, '[連結請查看 HTML 版本信件]');
}

function escapeHtml_(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function uniqueEmails_(emailText) {
  if (!emailText) return '';

  const emails = String(emailText)
    .split(',')
    .map(function (email) {
      return email.trim();
    })
    .filter(Boolean);

  const unique = [];

  emails.forEach(function (email) {
    if (unique.indexOf(email) === -1) {
      unique.push(email);
    }
  });

  return unique.join(',');
}