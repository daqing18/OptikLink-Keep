// tests/optiklink.spec.js
const { test, expect } = require('@playwright/test');
const https = require('https');

// 🔑 核心魔法：告诉 Playwright 直接使用保存好的登录凭证
test.use({ storageState: 'state.json' });

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

        const msg = [
            `🎮 OptikLink 保活通知`,
            `🕐 运行时间: ${nowStr()}`,
            `🖥 服务器: ${serverName}`,
            `📊 执行结果: ${result}`,
        ].join('\n');

        const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: msg });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            if (res.statusCode === 200) {
                console.log('📨 TG 推送成功');
            } else {
                console.log(`⚠️ TG 推送失败：HTTP ${res.statusCode}`);
            }
            resolve();
        });

        req.on('error', (e) => {
            console.log(`⚠️ TG 推送异常：${e.message}`);
            resolve();
        });

        req.setTimeout(15000, () => {
            console.log('⚠️ TG 推送超时');
            req.destroy();
            resolve();
        });

        req.write(body);
        req.end();
    });
}

test('OptikLink 保活', async ({ page }, testInfo) => {
    page.setDefaultTimeout(TIMEOUT);

    console.log('🚀 浏览器就绪，开始执行保活...');

    try {
        console.log('⏩ 携带状态凭证，直接空降控制台...');
        await page.goto('https://control.optiklink.net/', { waitUntil: 'domcontentloaded' });

        await page.waitForTimeout(3000); // 稍微等 3 秒让页面渲染

        if (page.url().includes('/auth/login')) {
            throw new Error('❌ Cookie 失效，被重定向回登录页！请在本地重新运行 get_cookie.js 提取 state.json');
        }
        console.log(`✅ 成功直达控制台！当前：${page.url()}`);

        console.log('🔍 查找服务器...');
        await page.waitForTimeout(2000);

        const serverInfo = await page.evaluate(() => {
            const card = document.querySelector('a[href*="/server/"]');
            if (!card) return null;
            const href = card.getAttribute('href');
            const id = href.replace('/server/', '').trim();
            const nameEl = card.querySelector('p.sc-1ibsw91-5');
            const name = nameEl ? nameEl.innerText.trim() : '';
            return { id, name };
        });

        if (!serverInfo) throw new Error('❌ 未找到服务器卡片');
        console.log(`✅ 找到服务器：${serverInfo.name} (${serverInfo.id})`);

        await page.goto(`https://control.optiklink.net/server/${serverInfo.id}`, { waitUntil: 'domcontentloaded' });
        console.log(`✅ 已到达服务器页面：${page.url()}`);

        console.log('🔍 检查服务器状态...');
        await page.waitForTimeout(3000);

        const statusText = await page.locator('p.sc-168cvuh-1').innerText().catch(() => '');
        console.log(`📊 服务器状态：${statusText.trim()}`);

        // ✨ 这里的判断逻辑已升级：Running 和 Starting 都视为保活成功
        if (statusText.toLowerCase().includes('running') || statusText.toLowerCase().includes('starting')) {
            console.log('🎉 保活成功！');
            await sendTG(`✅ 保活成功！\n💻 服务器状态：🚀 ${statusText.trim()}`, serverInfo.name);
        } else if (statusText.toLowerCase().includes('offline')) {
            console.log('⚠️ 服务器离线，尝试启动...');
            await page.click('button:has-text("Start")');
            console.log('📤 已点击 Start，持续监控状态...');

            let started = false;
            for (let i = 0; i < 24; i++) {
                await page.waitForTimeout(5000);
                const s = await page.locator('p.sc-168cvuh-1').innerText().catch(() => '');
                console.log(`  🔄 第 ${i + 1} 次检查，状态：${s.trim()}`);
                // 同样，启动后只要检测到 Running 或 Starting 都算成功
                if (s.toLowerCase().includes('running') || s.toLowerCase().includes('starting')) {
                    started = true;
                    break;
                }
            }

            if (started) {
                console.log('✅ 服务器已成功启动！');
                await sendTG('🔄 Start 启动！\n💻 服务器状态：🚀 Running', serverInfo.name);
            } else {
                console.log('❌ 等待超时，服务器未能启动');
                await sendTG('❌ Start 启动失败，等待超时\n💻 服务器状态：Offline', serverInfo.name);
            }
        } else {
            console.log(`⚠️ 未知状态：${statusText.trim()}`);
            await sendTG(`⚠️ 状态未知\n💻 服务器状态：${statusText.trim()}`, serverInfo.name);
        }

    } catch (e) {
        try {
            const screenshotPath = testInfo.outputPath('failure.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            await testInfo.attach('failure', { path: screenshotPath, contentType: 'image/png' });
            console.log('📸 失败截图已保存');
        } catch { /* 截图失败不影响主流程 */ }
        await sendTG(`❌ 脚本异常：${e.message}`);
        throw e;
    }
});

