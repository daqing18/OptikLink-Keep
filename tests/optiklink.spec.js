const { test, chromium } = require('@playwright/test');
const https = require('https');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const [panelUser, panelPass] = (process.env.PANEL_ACCOUNT || ',').split(',');
const [TG_CHAT_ID, TG_TOKEN] = (process.env.TG_BOT || ',').split(',');
const TIMEOUT = 60000;

// ===== 反检测配置 =====
// 让浏览器隐藏自动化痕迹，骗过 Cloudflare WAF
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-blink-features=AutomationControlled', // 关键：移除自动化标记
  '--disable-automation',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-infobars',
  '--disable-popup-blocking',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-field-trial-config',
  '--disable-breakpad',
  '--disable-component-extensions-with-background-pages',
  '--disable-sync',
  '--metrics-recording-only',
  '--password-store=basic',
  '--lang=zh-CN',
];

// 真实桌面浏览器 User-Agent
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 全局反检测脚本——在每一个页面加载前注入
function stealthInitScript() {
  // 1. 隐藏 webdriver 标记
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. 伪造 chrome 对象
  window.chrome = window.chrome || { runtime: {} };

  // 3. 伪造 plugins（真实 Chrome 有 5 个插件）
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });

  // 4. 伪造语言
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en'],
  });

  // 5. 隐藏 permissions 的自动化特征
  const originalQuery = window.navigator.permissions ? window.navigator.permissions.query : null;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery(parameters);
    };
  }
}

function nowStr() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', }).replace(/\//g, '-');
}

function sendTG(result, serverName = 'OptikLink') {
  return new Promise((resolve) => {
    if (!TG_CHAT_ID || !TG_TOKEN) {
      console.log('⚠️ TG_BOT 未配置，跳过推送');
      return resolve();
    }
    const msg = [`🎮 OptikLink 保活通知`, `🕐 运行时间: ${nowStr()}`, `🖥 服务器: ${serverName}`, `📊 执行结果: ${result}`].join('\n');
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: msg });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      if (res.statusCode === 200) console.log('📨 TG 推送成功');
      resolve();
    });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

test('OptikLink 保活', async ({ }, testInfo) => {
  if (!DISCORD_TOKEN) throw new Error('❌ 缺少 DISCORD_TOKEN，请在 Secrets 中配置');

  let proxyConfig = undefined;
  if (process.env.PROXY_URL) {
    console.log(`🛡️ 代理就绪: ${process.env.PROXY_URL}`);
    proxyConfig = { server: process.env.PROXY_URL };
  }

  console.log('🔧 启动浏览器...');
  const browser = await chromium.launch({
    headless: true,
    proxy: proxyConfig,
    args: LAUNCH_ARGS,
  });

  // 用带真实 UA 的 context 创建页面
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  let activePage = page;

  // 全局反检测（所有页面生效）
  await page.addInitScript(stealthInitScript);

  // ===== 处理 Cloudflare 挑战：等待挑战页消失 =====
  async function gotoWithChallenge(url, opts = {}) {
    const { waitUntil = 'domcontentloaded', timeout = 90000 } = opts;
    try {
      await page.goto(url, { waitUntil, timeout });
    } catch (e) {
      // 可能是 Cloudflare 挑战页，等待片刻让挑战自动通过
      console.log('⏳ 检测到可能的 Cloudflare 挑战，等待自动通过...');
      await page.waitForTimeout(8000);
      // 挑战页通常有个 Turnstile，等待它消失
      try {
        await page.waitForURL(url, { timeout: 30000 });
      } catch {}
    }
    // 兜底：如果还在挑战页，再等一轮
    await page.waitForTimeout(3000);
  }

  // 广告拦截脚本（仅 optiklink.net，保留原有逻辑）
  await page.addInitScript(() => {
    if (!location.hostname.includes('optiklink.net')) return;
    const AD_DOMAINS = ['tzegilo.com', 'alwingulla.com', 'auqot.com', 'jmosl.com', '094kk.com', 'optiklink.com', 'tmll7.com', 'googlesyndication.com', 'doubleclick.net'];
    const isAd = (url) => url && AD_DOMAINS.some(d => url.includes(d));
    const _createElement = document.createElement.bind(document);
    document.createElement = function (tag) {
      const el = _createElement(tag);
      if (tag.toLowerCase() === 'script') {
        const _desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        Object.defineProperty(el, 'src', {
          set(val) { if (!isAd(val)) _desc.set.call(this, val); },
          get() { return _desc.get.call(this); }
        });
      }
      return el;
    };
    const _appendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function (node) {
      if (node?.tagName === 'SCRIPT' && isAd(node.src)) return node;
      return _appendChild.call(this, node);
    };
    const _insertBefore = Element.prototype.insertBefore;
    Element.prototype.insertBefore = function (node, ref) {
      if (node?.tagName === 'SCRIPT' && isAd(node.src)) return node;
      return _insertBefore.call(this, node, ref);
    };
  });

  try {
    console.log('🌐 验证出口 IP...');
    try {
      const res = await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 15000 });
      const body = await res.text();
      console.log(`✅ 出口 IP 确认：${(JSON.parse(body).ip || body).replace(/(\d+\.\d+\.\d+\.)\d+/, '$1xx')}`);
    } catch {
      console.log('⚠️ IP 验证超时，跳过');
    }

    console.log('🔑 打开 OptikLink 登录页...');
    await gotoWithChallenge('https://optiklink.com/auth');

    // 检查是否真的到了 auth 页（可能被 Cloudflare 拦成别的页面）
    if (!page.url().includes('optiklink')) {
      console.log(`⚠️ 当前 URL: ${page.url()}，可能是 Cloudflare 挑战页，再等 10 秒...`);
      await page.waitForTimeout(10000);
    }

    console.log('📤 点击 Login with Discord...');
    await page.click("a[href='login']");

    console.log('⏳ 等待跳转至 Discord...');
    await page.waitForURL(url => url.toString().includes('discord.com'), { timeout: TIMEOUT });

    // 【核心黑科技：提取参数走底层 API 授权】
    const currentUrl = page.url();
    let oauthPath = '';
    if (currentUrl.includes('/login?redirect_to=')) {
      const urlObj = new URL(currentUrl);
      oauthPath = decodeURIComponent(urlObj.searchParams.get('redirect_to'));
    } else if (currentUrl.includes('/oauth2/authorize')) {
      oauthPath = currentUrl.substring(currentUrl.indexOf('/oauth2/authorize'));
    }
    if (oauthPath) {
      console.log('⚡ 截取 OAuth 参数，开始通过 Discord Token 免风控授权...');
      const apiUrl = `https://discord.com/api/v9${oauthPath}`;
      // 使用 Playwright 的内部 request (会自动走代理)
      const apiRes = await page.context().request.post(apiUrl, {
        headers: { 'authorization': DISCORD_TOKEN, 'content-type': 'application/json' },
        data: { permissions: "0", authorize: true, integration_type: 0 }
      });
      if (!apiRes.ok()) {
        throw new Error(`❌ Discord API 授权失败: HTTP ${apiRes.status()} - ${await apiRes.text()}`);
      }
      const resJson = await apiRes.json();
      if (resJson.location) {
        console.log('✅ 获取到回调授权链接，执行免验证跳跃！');
        await page.goto(resJson.location, { waitUntil: 'domcontentloaded' });
      } else {
        throw new Error(`❌ Discord 返回异常: 未找到 location 字段`);
      }
    } else {
      throw new Error(`❌ 无法识别 Discord 登录 URL 格式: ${currentUrl}`);
    }

    console.log('⏳ 确认到达 OptikLink...');
    await page.waitForURL(/optiklink\.net/, { timeout: 30000 });
    console.log(`✅ 登录成功！当前：${page.url()}`);

    console.log('📤 准备进入控制台...');
    try {
      await page.click('a[data-target="#logintopanel"]', { timeout: 5000 });
      await page.waitForTimeout(2000);
    } catch (e) {
      // 前端结构如果有变不强求，继续往下找
    }

    console.log('📤 点击 Panel Login...');
    // 尝试通过按钮点击打开控制台，如果按钮不可见则直接导航
    let panelPage;
    const panelLoginBtn = page.locator('text=/Panel Login/i').last();
    try {
      await panelLoginBtn.waitFor({ state: 'visible', timeout: 5000 });
      // 按钮可见，正常点击打开新标签页
      [panelPage] = await Promise.all([
        page.context().waitForEvent('page'),
        panelLoginBtn.click(),
      ]);
    } catch (e) {
      // 按钮隐藏或不可见，直接获取 href 导航
      console.log('⚠️ Panel Login 按钮不可见，尝试直接导航到控制台地址...');
      const panelUrl = await panelLoginBtn.getAttribute('href').catch(() => 'https://control.optiklink.net/auth/login');
      const panelContext = await browser.newContext();
      panelPage = await panelContext.newPage();
      await panelPage.goto(panelUrl, { waitUntil: 'domcontentloaded' });
    }

    panelPage.setDefaultTimeout(TIMEOUT);
    activePage = panelPage;

    console.log('⏳ 等待控制台页面加载...');
    await panelPage.waitForURL(/control\.optiklink\.net/, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });

    if (panelPage.url().includes('/auth/login')) {
      console.log('✏️ 填写控制台账号密码...');
      await panelPage.fill('input[name="username"]', panelUser);
      await panelPage.fill('input[name="password"]', panelPass);
      await panelPage.waitForTimeout(2000);
      console.log('📤 提交控制台登录...');
      await panelPage.click('button[type="submit"]');
      await panelPage.waitForURL(url => !url.toString().includes('/auth/login'), { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      console.log(`✅ 控制台登录成功！`);
    }

    await panelPage.waitForTimeout(2000);

    console.log('🔍 查找服务器...');
    const serverInfo = await panelPage.evaluate(() => {
      const card = document.querySelector('a[href*="/server/"]');
      if (!card) return null;
      return {
        id: card.getAttribute('href').replace('/server/', '').trim(),
        name: (card.querySelector('p.sc-1ibsw91-5') || {}).innerText?.trim() || 'Unknown'
      };
    });
    if (!serverInfo) throw new Error('❌ 未找到服务器卡片');

    console.log(`✅ 找到服务器：${serverInfo.name} (${serverInfo.id})`);
    await panelPage.goto(`https://control.optiklink.net/server/${serverInfo.id}`, { waitUntil: 'domcontentloaded' });

    console.log('🔍 检查服务器状态...');
    let statusText = '';
    for (let i = 0; i < 12; i++) {
      statusText = await panelPage.locator('p.sc-168cvuh-1').innerText().catch(() => '');
      // 修复①：加入 starting 状态检测，避免循环跑满60秒
      if (/(running|starting|offline|stopped)/i.test(statusText)) break;
      await panelPage.waitForTimeout(5000);
    }
    console.log(`💻 服务器状态：${statusText.trim()}`);

    if (statusText.toLowerCase().includes('running')) {
      console.log('🎉 保活成功！');
      await sendTG('✅ 保活成功！\n💻 服务器状态：🚀 Running', serverInfo.name);
    } else if (/(offline|stopped)/i.test(statusText)) {
      console.log('⚠️ 服务器离线，尝试启动...');
      await panelPage.click('button:has-text("Start")');
      let started = false;
      for (let i = 0; i < 24; i++) {
        await panelPage.waitForTimeout(5000);
        if (/(running)/i.test(await panelPage.locator('p.sc-168cvuh-1').innerText().catch(() => ''))) {
          started = true;
          break;
        }
      }
      if (started) {
        console.log('✅ 服务器已成功启动！');
        await sendTG('🔄 Start 启动！\n💻 服务器状态：🚀 Running', serverInfo.name);
      } else {
        throw new Error('❌ Start 启动失败，等待超时');
      }
    } else {
      // STARTING 状态 —— 脚本正常运行，也算保活成功
      console.log('⏳ 服务器正在启动中...');
      await sendTG('✅ 保活成功！\n💻 服务器状态：🚀 ' + statusText.trim(), serverInfo.name);
    }

  } catch (e) {
    try {
      await activePage.screenshot({ path: testInfo.outputPath('failure.png'), fullPage: true });
      await testInfo.attach('failure', { path: testInfo.outputPath('failure.png'), contentType: 'image/png' });
    } catch {}
    await sendTG(`❌ 脚本异常：${e.message}`);
    throw e;
  } finally {
    await browser.close();
  }
});
