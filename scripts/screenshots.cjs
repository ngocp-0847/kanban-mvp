const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '../docs');

async function shot(page, name, delay) {
  await page.waitForTimeout(delay || 1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('✅ ' + name + '.png');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 820 });

  // 1. Board view
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.board__columns', { timeout: 10000 });
  await shot(page, 'ss-01-board', 2000);

  // 2. Add repo form
  await page.click('.repo-add-btn');
  await page.waitForSelector('.repo-add-input');
  await page.fill('.repo-add-input', 'owner/your-repo');
  await shot(page, 'ss-02-add-repo', 600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 3. Issue detail – Description
  const cards = await page.locator('.card__title').all();
  if (cards.length > 0) {
    await cards[0].click();
    await page.waitForSelector('.detail-panel', { timeout: 5000 });
    await shot(page, 'ss-03-detail-description', 1500);

    // 4. Issue detail – Comments tab
    const tabs = await page.locator('.detail-tab').all();
    if (tabs.length > 1) {
      await tabs[1].click();
      await shot(page, 'ss-04-detail-comments', 800);
    }

    // Close panel
    await page.click('.detail-close');
    await page.waitForTimeout(400);
  }

  // 5. Multi-repo tabs (whole header visible)
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'ss-05-multirepo-tabs', 600);

  // 6. Card hover state
  await page.locator('.card').first().hover();
  await shot(page, 'ss-06-card-hover', 400);

  await browser.close();
  console.log('\nAll done → docs/');
})();
