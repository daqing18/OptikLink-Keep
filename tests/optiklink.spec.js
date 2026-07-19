const { test, chromium } = require('@playwright/test');
const https = require('https');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const [panelUser, panelPass] = (process.env.PANEL_ACCOUNT || ',').split(',');
const [TG_CHAT_ID, TG_TOKEN] = (process.env.TG_BOT || ',').split(',');

const TIMEOUT = 60000;

function nowStr() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).replace(/\//g, '-');
}

function sendTG(result, serverName = 'OptikLink') {
    return new Promise((resolve) => {
        if (!TG_CHAT_ID || !TG_TOKEN) {
            console.log('⚠️ TG_BOT 未配置，跳过推送');
            return resolve();
        }
        const msg = [`🎮 OptikLink 保活通知`, `🕐 运行时间: ${nowStr()}`, `🖥 服务器: ${serverName}`, `📊 执行结果: ${result}`].join('\n');
        const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: msg });
        const req = https.request({ hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
            if (res.statusCode === 200) console.log('📨 TG 推送成功');
            resolve();
        });
        req.on('error', () => resolve());
        req.write(body); req.end();
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
    const browser = await chromium.launch({ headless: true, proxy: proxyConfig });
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT);
    let activePage = page;

    await page.addInitScript(() => {
        if (!location.hostname.includes('optiklink.net')) return;
        const AD_DOMAINS = ['tzegilo.com', 'alwingulla.com', 'auqot.com', 'jmosl.com', '094kk.com', 'optiklink.com', 'tmll7.com', 'googlesyndication.com', 'doubleclick.net'];
        const isAd = (url) => url && AD_DOMAINS.some(d => url.includes(d));
        const _createElement = document.createElement.bind(document);
        document.createElement = function (tag) {
            const el = _createElement(tag);
            if (tag.toLowerCase() === 'script') {
                const _desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
                Object.defineProperty(el, 'src', { set(val) { if (!isAd(val)) _desc.set.call(this, val); }, get() { return _desc.get.call(this); } });
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
            const res = await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded' });
            const body = await res.text();
            console.log(`✅ 出口 IP 确认：${(JSON.parse(body).ip || body).replace(/(\d+\.\d+\.\d+\.)\d+/, '$1xx')}`);
        } catch { console.log('⚠️ IP 验证超时，跳过'); }

        console.log('🔑 打开 OptikLink 登录页...');
        await page.goto('https://optiklink.com/auth', { waitUntil: 'domcontentloaded' });

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
                headers: {
                    'authorization': DISCORD_TOKEN,
                    'content-type': 'application/json'
                },
                data: {
                    permissions: "0",
                    authorize: true,
                    integration_type: 0
                }
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

        console.log('📤 点击 Login to Panel...');
        await page.click('a[data-target="#logintopanel"]');
        await page.waitForTimeout(2000);

        console.log('📤 点击 Panel Login...');
        const panelLoginBtn = page.getByRole('button', { name: 'Panel Login' });
        await panelLoginBtn.waitFor({ state: 'visible' });

        const [panelPage] = await Promise.all([
            page.context().waitForEvent('page'),
            panelLoginBtn.click(),
        ]);

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
            if (/(running|offline|stopped)/i.test(statusText)) break;
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
                    started = true; break;
                }
            }
            if (started) {
                console.log('✅ 服务器已成功启动！');
                await sendTG('🔄 Start 启动！\n💻 服务器状态：🚀 Running', serverInfo.name);
            } else {
                throw new Error('❌ Start 启动失败，等待超时');
            }
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
