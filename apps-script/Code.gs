/*******************************************************
 * 南帝精密辦公室採購申請系統 V1
 * Code.gs
 *
 * 使用方式：
 * 1. 建立 Google Sheet
 * 2. 建立 GAS 專案
 * 3. 將 Code.gs、Employee.html、Admin.html 貼入 GAS
 * 4. 執行 setupPurchaseSystem()
 * 5. 設定 Script Properties：
 *    SPREADSHEET_ID = Google Sheet ID
 *    MANAGER_EMAILS = 採購/總務通知信箱，多个用逗號分隔
 *    ADMIN_PASSWORD = 管理後台密碼
 *    ATTACHMENT_FOLDER_ID = Google Drive 附件資料夾 ID，可不填，系統會自動建立
 *******************************************************/

const CONFIG = {
  systemName: '南帝精密辦公室採購申請系統',
  requestSheetName: '採購申請總表',
  logSheetName: '採購處理紀錄',

  statuses: ['待處理', '處理中', '已訂購', '已完成', '暫緩', '已取消'],
  categories: ['辦公用品', '文具耗材', '資訊設備', '清潔用品', '總務用品', '設備零配件', '修繕材料', '其他'],
  urgencyLevels: ['一般', '急用', '影響作業'],

  requestHeaders: [
    '申請編號',
    '建立時間',
    '姓名',
    '查詢碼',
    '部門',
    '申請人Email',
    '採購類別',
    '品名',
    '規格說明',
    '數量',
    '用途說明',
    '緊急程度',
    '希望到貨日',
    '預估金額',
    '參考連結',
    '附件檔案ID',
    '附件連結',
    '狀態',
    '負責人',
    '廠商',
    '實際金額',
    '預定購買日',
    '預定到貨日',
    '管理備註',
    '完成時間',
    '最後更新時間'
  ],

  logHeaders: [
    '更新時間',
    '申請編號',
    '原狀態',
    '新狀態',
    '負責人',
    '廠商',
    '實際金額',
    '預定購買日',
    '預定到貨日',
    '備註',
    '更新人'
  ]
};

function doGet(e) {
  const page = e && e.parameter && e.parameter.page ? e.parameter.page : 'employee';
  const template = page === 'admin'
    ? HtmlService.createTemplateFromFile('Admin')
    : HtmlService.createTemplateFromFile('Employee');

  template.systemName = CONFIG.systemName;
  template.categories = CONFIG.categories;
  template.urgencyLevels = CONFIG.urgencyLevels;
  template.statuses = CONFIG.statuses;

  return template.evaluate()
    .setTitle(CONFIG.systemName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setupPurchaseSystem() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty('SPREADSHEET_ID');

  let ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    ss = SpreadsheetApp.create(CONFIG.systemName);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  const requestSheet = getOrCreateSheet_(ss, CONFIG.requestSheetName, CONFIG.requestHeaders);
  const logSheet = getOrCreateSheet_(ss, CONFIG.logSheetName, CONFIG.logHeaders);

  formatHeader_(requestSheet);
  formatHeader_(logSheet);

  if (!props.getProperty('ADMIN_PASSWORD')) {
    props.setProperty('ADMIN_PASSWORD', '1234');
  }

  if (!props.getProperty('MANAGER_EMAILS')) {
    props.setProperty('MANAGER_EMAILS', Session.getActiveUser().getEmail() || '');
  }

  if (!props.getProperty('ATTACHMENT_FOLDER_ID')) {
    const folder = DriveApp.createFolder(CONFIG.systemName + ' 附件');
    props.setProperty('ATTACHMENT_FOLDER_ID', folder.getId());
  }

  return {
    ok: true,
    message: '系統初始化完成',
    spreadsheetUrl: ss.getUrl()
  };
}

function submitPurchaseRequest(form) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    validateSubmitForm_(form);

    const ss = getSpreadsheet_();
    const sheet = getRequestSheet_();
    const now = new Date();
    const requestNo = generateRequestNo_(sheet, now);

    let attachmentFileId = '';
    let attachmentUrl = '';

    if (form.mergedImageDataUrl) {
      const uploaded = saveAttachment_(form.mergedImageDataUrl, requestNo);
      attachmentFileId = uploaded.fileId;
      attachmentUrl = uploaded.url;
    }

    const row = [
      requestNo,
      now,
      clean_(form.name),
      clean_(form.queryCode),
      clean_(form.department),
      clean_(form.email),
      clean_(form.category),
      clean_(form.itemName),
      clean_(form.spec),
      clean_(form.quantity),
      clean_(form.purpose),
      clean_(form.urgency),
      clean_(form.desiredDate),
      clean_(form.estimatedAmount),
      clean_(form.referenceUrl),
      attachmentFileId,
      attachmentUrl,
      '待處理',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      now
    ];

    sheet.appendRow(row);

    writeLog_({
      requestNo,
      oldStatus: '',
      newStatus: '待處理',
      owner: '',
      vendor: '',
      actualAmount: '',
      purchaseDate: '',
      arrivalDate: '',
      note: '員工送出採購申請',
      updatedBy: clean_(form.name)
    });

    sendManagerNotification_(requestNo, form, attachmentUrl);
    sendApplicantConfirmation_(requestNo, form);

    return {
      ok: true,
      message: '採購申請已送出',
      requestNo
    };
  } catch (err) {
    return {
      ok: false,
      message: err.message || String(err)
    };
  } finally {
    lock.releaseLock();
  }
}

function queryMyRequests(name, queryCode) {
  name = clean_(name);
  queryCode = clean_(queryCode);

  if (!name || !queryCode) {
    return {
      ok: false,
      message: '請輸入姓名與 4 位查詢碼'
    };
  }

  const sheet = getRequestSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return {
      ok: true,
      records: []
    };
  }

  const headers = values[0];
  const idx = getHeaderIndexMap_(headers);
  const records = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    if (String(row[idx['姓名']]).trim() === name && String(row[idx['查詢碼']]).trim() === queryCode) {
      records.push({
        requestNo: row[idx['申請編號']],
        createdAt: formatDateTime_(row[idx['建立時間']]),
        department: row[idx['部門']],
        category: row[idx['採購類別']],
        itemName: row[idx['品名']],
        spec: row[idx['規格說明']],
        quantity: row[idx['數量']],
        purpose: row[idx['用途說明']],
        urgency: row[idx['緊急程度']],
        desiredDate: formatDate_(row[idx['希望到貨日']]),
        estimatedAmount: row[idx['預估金額']],
        referenceUrl: row[idx['參考連結']],
        status: row[idx['狀態']],
        owner: row[idx['負責人']],
        vendor: row[idx['廠商']],
        actualAmount: row[idx['實際金額']],
        arrivalDate: formatDate_(row[idx['預定到貨日']]),
        adminNote: row[idx['管理備註']],
        completedAt: formatDateTime_(row[idx['完成時間']]),
        lastUpdatedAt: formatDateTime_(row[idx['最後更新時間']])
      });
    }
  }

  records.sort(function(a, b) {
    return String(b.requestNo).localeCompare(String(a.requestNo));
  });

  return {
    ok: true,
    records
  };
}

function adminLogin(password) {
  const props = PropertiesService.getScriptProperties();
  const adminPassword = props.getProperty('ADMIN_PASSWORD') || '1234';

  if (String(password || '') === String(adminPassword)) {
    return {
      ok: true,
      token: Utilities.getUuid()
    };
  }

  return {
    ok: false,
    message: '密碼錯誤'
  };
}

function getAdminRequests(filter) {
  filter = filter || {};

  const sheet = getRequestSheet_();
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return {
      ok: true,
      records: []
    };
  }

  const headers = values[0];
  const idx = getHeaderIndexMap_(headers);
  const records = [];

  const statusFilter = clean_(filter.status);
  const urgencyFilter = clean_(filter.urgency);
  const categoryFilter = clean_(filter.category);
  const keyword = clean_(filter.keyword).toLowerCase();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    const record = {
      rowNumber: i + 1,
      requestNo: row[idx['申請編號']],
      createdAt: formatDateTime_(row[idx['建立時間']]),
      name: row[idx['姓名']],
      queryCode: row[idx['查詢碼']],
      department: row[idx['部門']],
      email: row[idx['申請人Email']],
      category: row[idx['採購類別']],
      itemName: row[idx['品名']],
      spec: row[idx['規格說明']],
      quantity: row[idx['數量']],
      purpose: row[idx['用途說明']],
      urgency: row[idx['緊急程度']],
      desiredDate: formatDate_(row[idx['希望到貨日']]),
      estimatedAmount: row[idx['預估金額']],
      referenceUrl: row[idx['參考連結']],
      attachmentFileId: row[idx['附件檔案ID']],
      attachmentUrl: row[idx['附件連結']],
      status: row[idx['狀態']],
      owner: row[idx['負責人']],
      vendor: row[idx['廠商']],
      actualAmount: row[idx['實際金額']],
      purchaseDate: formatDate_(row[idx['預定購買日']]),
      arrivalDate: formatDate_(row[idx['預定到貨日']]),
      adminNote: row[idx['管理備註']],
      completedAt: formatDateTime_(row[idx['完成時間']]),
      lastUpdatedAt: formatDateTime_(row[idx['最後更新時間']])
    };

    if (statusFilter && record.status !== statusFilter) continue;
    if (urgencyFilter && record.urgency !== urgencyFilter) continue;
    if (categoryFilter && record.category !== categoryFilter) continue;

    if (keyword) {
      const text = [
        record.requestNo,
        record.name,
        record.department,
        record.category,
        record.itemName,
        record.spec,
        record.vendor,
        record.owner,
        record.adminNote
      ].join(' ').toLowerCase();

      if (text.indexOf(keyword) === -1) continue;
    }

    records.push(record);
  }

  records.sort(function(a, b) {
    return String(b.requestNo).localeCompare(String(a.requestNo));
  });

  return {
    ok: true,
    records
  };
}

function updatePurchaseRequest(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    payload = payload || {};
    const requestNo = clean_(payload.requestNo);

    if (!requestNo) {
      throw new Error('缺少申請編號');
    }

    const sheet = getRequestSheet_();
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const idx = getHeaderIndexMap_(headers);

    let targetRowNumber = -1;
    let oldStatus = '';

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idx['申請編號']]).trim() === requestNo) {
        targetRowNumber = i + 1;
        oldStatus = values[i][idx['狀態']];
        break;
      }
    }

    if (targetRowNumber === -1) {
      throw new Error('找不到申請資料：' + requestNo);
    }

    const newStatus = clean_(payload.status) || oldStatus;
    const now = new Date();

    setCellByHeader_(sheet, targetRowNumber, idx, '狀態', newStatus);
    setCellByHeader_(sheet, targetRowNumber, idx, '負責人', clean_(payload.owner));
    setCellByHeader_(sheet, targetRowNumber, idx, '廠商', clean_(payload.vendor));
    setCellByHeader_(sheet, targetRowNumber, idx, '實際金額', clean_(payload.actualAmount));
    setCellByHeader_(sheet, targetRowNumber, idx, '預定購買日', clean_(payload.purchaseDate));
    setCellByHeader_(sheet, targetRowNumber, idx, '預定到貨日', clean_(payload.arrivalDate));
    setCellByHeader_(sheet, targetRowNumber, idx, '管理備註', clean_(payload.adminNote));
    setCellByHeader_(sheet, targetRowNumber, idx, '最後更新時間', now);

    if (newStatus === '已完成') {
      setCellByHeader_(sheet, targetRowNumber, idx, '完成時間', now);
    }

    writeLog_({
      requestNo,
      oldStatus,
      newStatus,
      owner: clean_(payload.owner),
      vendor: clean_(payload.vendor),
      actualAmount: clean_(payload.actualAmount),
      purchaseDate: clean_(payload.purchaseDate),
      arrivalDate: clean_(payload.arrivalDate),
      note: clean_(payload.adminNote),
      updatedBy: clean_(payload.updatedBy) || '管理者'
    });

    return {
      ok: true,
      message: '已更新'
    };
  } catch (err) {
    return {
      ok: false,
      message: err.message || String(err)
    };
  } finally {
    lock.releaseLock();
  }
}

function getRequestLogs(requestNo) {
  requestNo = clean_(requestNo);
  const sheet = getLogSheet_();
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return {
      ok: true,
      logs: []
    };
  }

  const headers = values[0];
  const idx = getHeaderIndexMap_(headers);
  const logs = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    if (String(row[idx['申請編號']]).trim() === requestNo) {
      logs.push({
        updatedAt: formatDateTime_(row[idx['更新時間']]),
        requestNo: row[idx['申請編號']],
        oldStatus: row[idx['原狀態']],
        newStatus: row[idx['新狀態']],
        owner: row[idx['負責人']],
        vendor: row[idx['廠商']],
        actualAmount: row[idx['實際金額']],
        purchaseDate: formatDate_(row[idx['預定購買日']]),
        arrivalDate: formatDate_(row[idx['預定到貨日']]),
        note: row[idx['備註']],
        updatedBy: row[idx['更新人']]
      });
    }
  }

  logs.sort(function(a, b) {
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });

  return {
    ok: true,
    logs
  };
}

/***********************
 * private helpers
 ***********************/

function validateSubmitForm_(form) {
  if (!form) throw new Error('表單資料遺失');

  const required = [
    ['name', '姓名'],
    ['queryCode', '查詢碼'],
    ['department', '部門'],
    ['category', '採購類別'],
    ['itemName', '品名'],
    ['quantity', '數量'],
    ['purpose', '用途說明'],
    ['urgency', '緊急程度']
  ];

  required.forEach(function(item) {
    if (!clean_(form[item[0]])) {
      throw new Error('請填寫：' + item[1]);
    }
  });

  if (!/^\d{4}$/.test(clean_(form.queryCode))) {
    throw new Error('查詢碼請輸入 4 位數字');
  }
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');

  if (!spreadsheetId) {
    throw new Error('尚未設定 SPREADSHEET_ID，請先執行 setupPurchaseSystem()');
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function getRequestSheet_() {
  return getSpreadsheet_().getSheetByName(CONFIG.requestSheetName);
}

function getLogSheet_() {
  return getSpreadsheet_().getSheetByName(CONFIG.logSheetName);
}

function getOrCreateSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const empty = firstRow.every(function(v) { return v === ''; });
    if (empty) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  return sheet;
}

function formatHeader_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return;

  sheet.getRange(1, 1, 1, lastColumn)
    .setFontWeight('bold')
    .setBackground('#e8f0fe');

  sheet.setFrozenRows(1);
}

function getHeaderIndexMap_(headers) {
  const map = {};
  headers.forEach(function(h, i) {
    map[String(h).trim()] = i;
  });
  return map;
}

function setCellByHeader_(sheet, rowNumber, idx, headerName, value) {
  const colIndex = idx[headerName] + 1;
  sheet.getRange(rowNumber, colIndex).setValue(value);
}

function generateRequestNo_(sheet, now) {
  const dateText = Utilities.formatDate(now, 'Asia/Taipei', 'yyyyMMdd');
  const prefix = 'PUR-' + dateText + '-';

  const values = sheet.getDataRange().getValues();
  let maxNo = 0;

  if (values.length > 1) {
    const headers = values[0];
    const idx = getHeaderIndexMap_(headers);

    for (let i = 1; i < values.length; i++) {
      const no = String(values[i][idx['申請編號']] || '');
      if (no.indexOf(prefix) === 0) {
        const n = Number(no.replace(prefix, ''));
        if (!isNaN(n) && n > maxNo) maxNo = n;
      }
    }
  }

  const next = String(maxNo + 1).padStart(3, '0');
  return prefix + next;
}

function saveAttachment_(dataUrl, requestNo) {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('ATTACHMENT_FOLDER_ID');

  let folder;
  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
  } else {
    folder = DriveApp.createFolder(CONFIG.systemName + ' 附件');
    props.setProperty('ATTACHMENT_FOLDER_ID', folder.getId());
  }

  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('附件格式錯誤');
  }

  const mimeType = match[1];
  const base64 = match[2];
  const bytes = Utilities.base64Decode(base64);
  const fileName = requestNo + '_attachment.jpg';

  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);
  file.setDescription(CONFIG.systemName + ' ' + requestNo);

  return {
    fileId: file.getId(),
    url: file.getUrl()
  };
}

function writeLog_(data) {
  const sheet = getLogSheet_();

  sheet.appendRow([
    new Date(),
    data.requestNo || '',
    data.oldStatus || '',
    data.newStatus || '',
    data.owner || '',
    data.vendor || '',
    data.actualAmount || '',
    data.purchaseDate || '',
    data.arrivalDate || '',
    data.note || '',
    data.updatedBy || ''
  ]);
}

function sendManagerNotification_(requestNo, form, attachmentUrl) {
  const props = PropertiesService.getScriptProperties();
  const emails = clean_(props.getProperty('MANAGER_EMAILS'));

  if (!emails) return;

  const subject = '【採購申請】' + requestNo + '｜' + clean_(form.itemName);

  const body = [
    '有新的採購申請：',
    '',
    '申請編號：' + requestNo,
    '申請人：' + clean_(form.name),
    '部門：' + clean_(form.department),
    '採購類別：' + clean_(form.category),
    '品名：' + clean_(form.itemName),
    '規格說明：' + clean_(form.spec),
    '數量：' + clean_(form.quantity),
    '用途說明：' + clean_(form.purpose),
    '緊急程度：' + clean_(form.urgency),
    '希望到貨日：' + clean_(form.desiredDate),
    '預估金額：' + clean_(form.estimatedAmount),
    '參考連結：' + clean_(form.referenceUrl),
    '附件連結：' + (attachmentUrl || ''),
    '',
    '請至管理後台查看與處理。'
  ].join('\n');

  MailApp.sendEmail(emails, subject, body);
}

function sendApplicantConfirmation_(requestNo, form) {
  const email = clean_(form.email);
  if (!email) return;

  const subject = '【採購申請確認】' + requestNo;

  const body = [
    clean_(form.name) + ' 您好：',
    '',
    '您的採購申請已送出。',
    '',
    '申請編號：' + requestNo,
    '品名：' + clean_(form.itemName),
    '數量：' + clean_(form.quantity),
    '目前狀態：待處理',
    '',
    '之後可使用「姓名 + 4 位查詢碼」查詢進度。',
    '',
    CONFIG.systemName
  ].join('\n');

  MailApp.sendEmail(email, subject, body);
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function formatDateTime_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  }
  return String(value);
}

function formatDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Taipei', 'yyyy/MM/dd');
  }
  return String(value);
}