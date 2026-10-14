const driver = require('./gemini-driver');
const profileManager = require('./profile-manager');

module.exports = {
  sendPrompt: driver.sendPrompt,
  listConversations: driver.listConversations,
  getConversationTranscript: driver.getConversationTranscript,
  deleteConversation: driver.deleteConversation,
  ensureChrome: driver.ensureChrome,
  stopChrome: driver.stopChrome,
  getRunningChromeMode: driver.getRunningChromeMode,
  getRunningChromeProfile: driver.getRunningChromeProfile,
  profileManager
};
