/**
 * 南帝精密辦公室採購申請系統 V1
 * Code.gs
 */

const CONFIG = {
  appName: '南帝精密辦公室採購申請系統',
  requestSheetName: '採購申請總表',
  logSheetName: '採購處理紀錄',
  defaultStatus: '待處理',
  categories: ['辦公用品', '文具耗材', '資訊設備', '清潔用品', '總務用品', '設備零配件', '修繕材料', '其他'],
  urgencies: ['一般', '急用', '影響作業'],
  statuses: ['待處理', '處理中', '已訂購', '已完成', '暫緩', '已取消']
};

const REQUEST_HEADERS = [
  '申請編號', '建立時間', '姓名', '查詢碼', '部門', '申請