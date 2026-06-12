const NATIVE_HOST = 'com.seichris.dianping_nearby_restaurants_bridge';
let nativePort = null;

function isAllowedUrl(value) {
  if (value === 'about:blank') return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'www.dianping.com' || url.hostname.endsWith('.dianping.com'));
  } catch {
    return false;
  }
}

function connectNativeHost() {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort.onMessage.addListener((message) => {
      handleNativeMessage(message).catch((error) => {
        sendResult(message?.id, null, {
          message: error.message,
          stack: error.stack,
        });
      });
    });
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      setTimeout(connectNativeHost, 2000);
    });
  } catch {
    nativePort = null;
    setTimeout(connectNativeHost, 5000);
  }
}

function sendResult(id, result, error = null) {
  if (!nativePort || !id) return;
  nativePort.postMessage({ id, result, error });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for tab ${tabId}`));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function createTab(params = {}) {
  const url = params.url || 'about:blank';
  if (!isAllowedUrl(url)) throw new Error(`Refusing to open non-Dianping URL: ${url}`);
  const tab = await chrome.tabs.create({
    url,
    active: Boolean(params.active),
  });
  if (url !== 'about:blank') {
    await waitForTabComplete(tab.id, params.timeoutMs);
  }
  return { tabId: tab.id, url: tab.url };
}

async function navigateTab(params) {
  if (!isAllowedUrl(params.url)) throw new Error(`Refusing to navigate to non-Dianping URL: ${params.url}`);
  await chrome.tabs.update(params.tabId, { url: params.url, active: Boolean(params.active) });
  await waitForTabComplete(params.tabId, params.timeoutMs);
  const tab = await chrome.tabs.get(params.tabId);
  return { tabId: tab.id, url: tab.url, title: tab.title };
}

async function runScript(tabId, func) {
  const tab = await chrome.tabs.get(tabId);
  if (!isAllowedUrl(tab.url)) throw new Error(`Refusing to inspect non-Dianping tab: ${tab.url}`);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
  });
  return result;
}

async function extractLinks(params) {
  return runScript(params.tabId, () => [...document.querySelectorAll('a')]
    .map((a) => ({ text: a.innerText.trim(), href: a.href }))
    .filter((link) => link.text && link.href));
}

async function extractListingShops(params) {
  return runScript(params.tabId, () => {
    const anchors = [...document.querySelectorAll('a[href*="/shop/"]')];
    const seen = new Set();
    const result = [];
    for (const a of anchors) {
      const href = new URL(a.href, location.href);
      if (!/^\/shop\/[^/]+$/.test(href.pathname)) continue;
      const text = a.innerText.trim();
      if (!text || text.includes('条评价') || text.includes('人均')) continue;
      if (seen.has(href.pathname)) continue;
      seen.add(href.pathname);
      result.push({ name: text, url: href.origin + href.pathname });
    }
    return result;
  });
}

async function extractPageText(params) {
  return runScript(params.tabId, () => {
    const lines = document.body.innerText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return { title: document.title, href: location.href, lines };
  });
}

async function closeTab(params) {
  await chrome.tabs.remove(params.tabId);
  return { closed: true };
}

async function handleNativeMessage(message) {
  if (!message?.id) return;
  const params = message.params || {};
  let result;
  if (message.method === 'createTab') {
    result = await createTab(params);
  } else if (message.method === 'navigate') {
    result = await navigateTab(params);
  } else if (message.method === 'extractLinks') {
    result = await extractLinks(params);
  } else if (message.method === 'extractListingShops') {
    result = await extractListingShops(params);
  } else if (message.method === 'extractPageText') {
    result = await extractPageText(params);
  } else if (message.method === 'closeTab') {
    result = await closeTab(params);
  } else if (message.method === 'healthcheck') {
    result = { ok: true };
  } else {
    throw new Error(`Unknown bridge method: ${message.method}`);
  }
  sendResult(message.id, result);
}

chrome.runtime.onInstalled.addListener(connectNativeHost);
chrome.runtime.onStartup.addListener(connectNativeHost);
chrome.action.onClicked.addListener(connectNativeHost);

connectNativeHost();
