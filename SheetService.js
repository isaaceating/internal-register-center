function getSs_() {
  return SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
}

function getSheet_(sheetName) {
  const sheet = getSs_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('找不到工作表：' + sheetName);
  }
  return sheet;
}

function getHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
}

function getRowsAsObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  return values.map(function (row, index) {
    const obj = {};
    headers.forEach(function (header, i) {
      obj[header] = row[i];
    });
    obj.__rowNumber = index + 2;
    return obj;
  });
}

function appendObject_(sheetName, obj) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);

  const row = headers.map(function (header) {
    return obj[header] !== undefined ? obj[header] : '';
  });

  sheet.appendRow(row);
}

function updateObjectByRow_(sheetName, rowNumber, updates) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);

  Object.keys(updates).forEach(function (key) {
    const colIndex = headers.indexOf(key);
    if (colIndex >= 0) {
      sheet.getRange(rowNumber, colIndex + 1).setValue(updates[key]);
    }
  });
}

function findRowByValue_(sheetName, fieldName, value) {
  const rows = getRowsAsObjects_(sheetName);
  return rows.find(function (row) {
    return String(row[fieldName]) === String(value);
  }) || null;
}

function readSystemConfig_() {
  const rows = getRowsAsObjects_(APP_CONFIG.SHEETS.SYSTEM_CONFIG);
  const config = {};

  rows.forEach(function (row) {
    if (row.key) {
      config[String(row.key)] = row.value;
    }
  });

  return config;
}

function setSystemConfigValue_(key, value) {
  const sheetName = APP_CONFIG.SHEETS.SYSTEM_CONFIG;
  const row = findRowByValue_(sheetName, 'key', key);

  if (row) {
    updateObjectByRow_(sheetName, row.__rowNumber, { value: value });
  } else {
    appendObject_(sheetName, { key: key, value: value });
  }
}

function logAudit_(action, ticketId, actor, detail, errorMessage) {
  try {
    appendObject_(APP_CONFIG.SHEETS.AUDIT_LOG, {
      timestamp: formatDateTime_(new Date()),
      action: action || '',
      ticket_id: ticketId || '',
      actor: actor || 'system',
      detail: detail || '',
      error_message: errorMessage || ''
    });
  } catch (err) {
    Logger.log('Audit log failed: ' + err.message);
  }
}

function formatDateTime_(date) {
  if (!date) return '';
  return Utilities.formatDate(new Date(date), APP_CONFIG.TIMEZONE, 'yyyy/MM/dd HH:mm');
}

function formatDateOnly_(date) {
  if (!date) return '';
  return Utilities.formatDate(new Date(date), APP_CONFIG.TIMEZONE, 'yyyy/MM/dd');
}

function normalizeDateString_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return formatDateOnly_(value);
  }

  return String(value).trim();
}