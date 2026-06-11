const APP='南帝精密辦公室採購申請系統';
const SHEET_MAIN='採購申請總表';
const SHEET_LOG='採購處理紀錄';
const STATUS=['待處理','處理中','已訂購','已完成','暫緩','已取消'];
const CATS=['辦公用品','文具耗材','資訊設備','清潔用品','總務用品','設備零配件','修繕材料','其他'];
const URGENCY=['一般','急用','影響作業'];
function doGet(e){var p=(e&&e.parameter&&e.parameter.page)||'employee';var f=p==='admin'?'Admin':'Employee';return HtmlService.createTemplateFromFile(f).evaluate