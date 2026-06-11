/**
 * 南帝精密辦公室採購申請系統 V1
 * Code.gs
 *
 * 使用方式：
 * 1. 建立 Google Sheet，並執行 setupPurchaseSystem() 建立表頭。
 * 2. 建立 Google Drive 附件資料夾。
 * 3. 到 Apps Script「專案設定」→「指令碼屬性」加入：
 *    SPREADSHEET_ID = Google Sheet ID
 *    DRIVE_FOLDER_ID = 附件資料夾 ID
 *    ADMIN_PASSWORD = 管理者密碼
 *    NOTIFY_EMAILS = 採購/總務通知信箱，多個信箱用逗號分隔
 * 4. Employee.html、Admin.html 與本檔案一起放入 GAS。
 */

const CONFIG = {
  appName: '南帝精密辦公室採購申請系統',
  requestSheetName: '採購申請總表',
  logSheetName: '採購處理紀錄',
  defaultStatus: '待