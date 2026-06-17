function doGet(e) {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function ping() {
  return {
    ok: true,
    appName: APP_CONFIG.APP_NAME,
    now: Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy/MM/dd HH:mm:ss')
  };
}