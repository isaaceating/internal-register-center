function sendTicketCreatedEmail(ticket) {
  const subject = '[內部註冊中心] ' + ticket.ticket_id + ' - ' + ticket.registration_subject;

  const body = [
    '您好，',
    '',
    '您的註冊申請已建立，以下為申請資訊：',
    '',
    'Ticket ID：' + ticket.ticket_id,
    '申請人：' + ticket.requester_name,
    '工號：' + ticket.employee_id,
    '申請人部門：' + ticket.requester_department,
    '申請服務部門：' + ticket.target_department,
    '需求類別：' + ticket.service_category,
    '註冊主題：' + ticket.registration_subject,
    '希望完成日：' + ticket.due_date,
    '',
    '註冊說明：',
    ticket.registration_description,
    '',
    '附件：' + (ticket.attachment_url || '無'),
    '',
    'JIRA：' + (ticket.jira_url || '尚未建立 / 尚未設定 JIRA'),
    '',
    '系統已通知負責窗口，請等待處理。',
    '',
    'Internal Registration Center / 內部註冊中心'
  ].join('\n');

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
    body: body
  });

  logAudit_('EMAIL_SENT', ticket.ticket_id, 'system', '寄送建立通知信');
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