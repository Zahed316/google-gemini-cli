const driver = require('./gemini-driver');
const profileManager = require('./profile-manager');

module.exports = {
  sendPrompt: driver.sendPrompt,
  listConversations: driver.listConversations,
  getConversationTranscript: driver.getConversationTranscript,
  deleteConversation: driver.deleteConversation,
  deleteConversationInternal: driver.deleteConversationInternal,
  ensureChrome: driver.ensureChrome,
  stopChrome: driver.stopChrome,
  isCdpReady: driver.isCdpReady,
  getRunningChromeMode: driver.getRunningChromeMode,
  getRunningChromeProfile: driver.getRunningChromeProfile,
  getBrowserStatus: driver.getBrowserStatus,
  attachFile: driver.attachFile,
  downloadGeneratedMedia: driver.downloadGeneratedMedia,
  getUploadToolsButton: driver.getUploadToolsButton,
  checkRobotVerification: driver.checkRobotVerification,
  profileManager
};
