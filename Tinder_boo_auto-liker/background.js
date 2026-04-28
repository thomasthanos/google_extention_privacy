// Background script to handle live updates
let likeCount = 0;
let isActive = false;

// URLs where the content script should run
const VALID_URLS = [
  /^https:\/\/tinder\.com\/app\/(recs|explore)/,
  /^https:\/\/boo\.world\/.*\/match/
];

function isValidUrl(url) {
  if (!url) return false;
  return VALID_URLS.some(re => re.test(url));
}

// Inject content script dynamically when tab navigates to a valid URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isValidUrl(tab.url)) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).catch(() => {}); // Ignore if already injected or no permission
  }
});

// Also catch SPA navigation (URL change without full page reload)
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (isValidUrl(details.url)) {
    chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['content.js']
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateCount") {
    likeCount = request.count;
    isActive = request.isActive;
    // Broadcast to all popups
    chrome.runtime.sendMessage({
      action: "liveUpdate",
      count: likeCount,
      isActive: isActive
    }).catch(() => {}); // Popup might be closed
  }
  
  if (request.action === "getStatus") {
    sendResponse({
      count: likeCount,
      isActive: isActive
    });
  }
});