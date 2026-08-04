// Background script to handle live updates
let likeCount = 0;
let isActive = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateCount") {
    likeCount = request.count;
    isActive = request.isActive;
    // Broadcast to all popups - ignore error if popup is closed
    chrome.runtime.sendMessage({
      action: "liveUpdate",
      count: likeCount,
      isActive: isActive
    }).catch(() => {});
  }
  
  if (request.action === "getStatus") {
    sendResponse({
      count: likeCount,
      isActive: isActive
    });
  }
});