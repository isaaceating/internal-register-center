function queryTicketsByEmployee(employeeId) {
  const id = String(employeeId || '').trim();

  if (!id) {
    return {
      ok: false,
      message: '請輸入工號。'
    };
  }

  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.TICKETS);
  const tickets = rows
    .filter(function (row) {
      return String(row.employee_id).trim() === id;
    })
    .map(ticketToViewModel_);

  return {
    ok: true,
    tickets: tickets,
    summary: buildSummary_(tickets)
  };
}

function verifyDashboardAccess(payload) {
  const dashboardType = String(payload.dashboard_type || '').trim();
  const department = String(payload.department || '').trim();
  const accessCode = String(payload.access_code || '').trim();

  if (!dashboardType || !accessCode) {
    return {
      ok: false,
      message: '請輸入完整資訊。'
    };
  }

  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.PERMISSIONS);

  const matched = rows.find(function (row) {
    const rowType = String(row.dashboard_type || '').trim();
    const rowDept = String(row.department || '').trim();
    const rowCode = String(row.access_code || '').trim();
    const active = String(row.active).toUpperCase() === 'TRUE';

    if (!active) return false;
    if (rowType !== dashboardType) return false;
    if (rowCode !== accessCode) return false;

    if (dashboardType === 'gm') return true;

    return rowDept === department;
  });

  if (!matched) {
    return {
      ok: false,
      message: 'Access Code 錯誤或權限未啟用。'
    };
  }

  return {
    ok: true,
    role_name: matched.role_name || '',
    department: dashboardType === 'gm' ? 'ALL' : department
  };
}

function getDepartmentDashboardData(filters) {
  const access = verifyDashboardAccess({
    dashboard_type: 'department',
    department: filters.department,
    access_code: filters.access_code
  });

  if (!access.ok) return access;

  const department = String(filters.department || '').trim();
  let tickets = getRowsAsObjects_(APP_CONFIG.SHEETS.TICKETS)
    .filter(function (row) {
      return String(row.target_department || '').trim() === department;
    })
    .map(ticketToViewModel_);

  tickets = applyTicketFilters_(tickets, filters);

  return {
    ok: true,
    department: department,
    tickets: tickets,
    summary: buildSummary_(tickets)
  };
}

function getGmDashboardData(payload) {
  const access = verifyDashboardAccess({
    dashboard_type: 'gm',
    access_code: payload.access_code
  });

  if (!access.ok) return access;

  const tickets = getRowsAsObjects_(APP_CONFIG.SHEETS.TICKETS)
    .map(ticketToViewModel_);

  const byDepartment = {};

  tickets.forEach(function (ticket) {
    const dept = ticket.target_department || '未分類';

    if (!byDepartment[dept]) {
      byDepartment[dept] = [];
    }

    byDepartment[dept].push(ticket);
  });

  const departments = Object.keys(byDepartment).sort().map(function (dept) {
    return {
      department: dept,
      summary: buildSummary_(byDepartment[dept])
    };
  });

  return {
    ok: true,
    totalSummary: buildSummary_(tickets),
    departments: departments
  };
}

function getTicketDetail(ticketId) {
  const ticket = findRowByValue_(APP_CONFIG.SHEETS.TICKETS, 'ticket_id', ticketId);

  if (!ticket) {
    return {
      ok: false,
      message: '找不到 Ticket：' + ticketId
    };
  }

  return {
    ok: true,
    ticket: ticketToViewModel_(ticket)
  };
}

function getDashboardDepartments() {
  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.PERMISSIONS);
  const departments = [];

  rows.forEach(function (row) {
    if (
      String(row.dashboard_type).trim() === 'department' &&
      String(row.active).toUpperCase() === 'TRUE'
    ) {
      const dept = String(row.department || '').trim();
      if (dept && departments.indexOf(dept) === -1) {
        departments.push(dept);
      }
    }
  });

  return departments;
}

function applyTicketFilters_(tickets, filters) {
  let result = tickets.slice();

  const status = String(filters.status || '').trim();
  const category = String(filters.service_category || '').trim();
  const startDate = String(filters.start_date || '').trim();
  const endDate = String(filters.end_date || '').trim();

  if (status) {
    result = result.filter(function (ticket) {
      return String(ticket.display_status) === status;
    });
  }

  if (category) {
    result = result.filter(function (ticket) {
      return String(ticket.service_category) === category;
    });
  }

  if (startDate) {
    const start = new Date(startDate);
    result = result.filter(function (ticket) {
      return new Date(ticket.created_at) >= start;
    });
  }

  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    result = result.filter(function (ticket) {
      return new Date(ticket.created_at) <= end;
    });
  }

  return result;
}

function ticketToViewModel_(row) {
  const displayStatus = calculateTicketDisplayStatusFromRow_(row);

  return {
    ticket_id: String(row.ticket_id || ''),
    employee_id: String(row.employee_id || ''),
    requester_department: String(row.requester_department || ''),
    requester_name: String(row.requester_name || ''),
    requester_email: String(row.requester_email || ''),
    target_department: String(row.target_department || ''),
    service_category: String(row.service_category || ''),
    registration_subject: String(row.registration_subject || ''),
    registration_description: String(row.registration_description || ''),
    attachment_url: String(row.attachment_url || ''),
    due_date: normalizeDateString_(row.due_date),
    display_status: displayStatus,
    center_status: String(row.center_status || ''),
    jira_key: String(row.jira_key || ''),
    jira_url: String(row.jira_url || ''),
    jira_project: String(row.jira_project || ''),
    jira_issue_type: String(row.jira_issue_type || ''),
    jira_assignee: String(row.jira_assignee || ''),
    owner_email: String(row.owner_email || ''),
    cc_group: String(row.cc_group || ''),
    jira_status: String(row.jira_status || ''),
    jira_last_comment: String(row.jira_last_comment || ''),
    jira_last_comment_at: String(row.jira_last_comment_at || ''),
    created_at: normalizeDateTimeForView_(row.created_at),
    updated_at: normalizeDateTimeForView_(row.updated_at),
    completed_at: normalizeDateTimeForView_(row.completed_at),
    overdue_flag: displayStatus === APP_CONFIG.STATUS.OVERDUE ? 'TRUE' : 'FALSE'
  };
}

function calculateTicketDisplayStatusFromRow_(row) {
  const centerStatus = String(row.center_status || '').trim();
  const displayStatus = String(row.display_status || '').trim();
  const dueDate = normalizeDateString_(row.due_date);

  if (centerStatus === APP_CONFIG.STATUS.DONE || displayStatus === APP_CONFIG.STATUS.DONE) {
    return APP_CONFIG.STATUS.DONE;
  }

  if (dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);

    if (!isNaN(due.getTime()) && due < today) {
      return APP_CONFIG.STATUS.OVERDUE;
    }
  }

  return APP_CONFIG.STATUS.OPEN;
}

function buildSummary_(tickets) {
  const summary = {
    total: tickets.length,
    open: 0,
    overdue: 0,
    done: 0
  };

  tickets.forEach(function (ticket) {
    if (ticket.display_status === APP_CONFIG.STATUS.DONE) {
      summary.done++;
    } else if (ticket.display_status === APP_CONFIG.STATUS.OVERDUE) {
      summary.overdue++;
    } else {
      summary.open++;
    }
  });

  return summary;
}

function normalizeDateTimeForView_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return formatDateTime_(value);
  }

  return String(value);
}