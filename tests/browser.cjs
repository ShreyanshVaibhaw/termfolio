// Run against a live local instance with Playwright available through NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

function tinyPdf() {
  const content = 'BT /F1 12 Tf 70 700 Td (Coastal erosion affects dunes.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function main() {
  const url = process.env.TERMFOLIO_URL || 'http://127.0.0.1:8000';
  const screenshots = path.join(__dirname, '..', 'docs', 'screenshots');
  await fs.mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.TERMFOLIO_CHROMIUM || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('.term-row').nth(7).waitFor();
    assert.equal(await page.locator('.term-row').count(), 8);
    await page.screenshot({ path: path.join(screenshots, 'workspace.png') });
    const rainGardens = page.getByRole('button', { name: /^Rain gardens$/i });
    await rainGardens.click();
    assert.equal((await page.locator('mark.active').first().textContent()).toLowerCase(), 'rain gardens');
    await page.mouse.move(260, 80);
    await page.screenshot({ path: path.join(screenshots, 'highlighted.png') });
    await page.getByText('Hide source highlights').click();

    await page.selectOption('#method', 'tfidf');
    await page.fill('#limit', '3');
    await page.fill('#source-text', 'Solar panels on office roofs can reduce electricity costs. Solar panels feed energy to an inverter.');
    await page.locator('#source-text').press('Enter');
    const second = page.locator('.turn').nth(1);
    await second.locator('.term-row').nth(2).waitFor();
    assert.equal(await second.locator('.term-row').count(), 3);
    assert.equal(await page.locator('.turn').first().locator('.term-row').count(), 8);
    assert.match(await second.locator('.reply-meta').textContent(), /TF-IDF/);
    const downloadReady = page.waitForEvent('download');
    await second.getByRole('button', { name: /CSV/ }).click();
    const download = await downloadReady;
    assert.equal(download.suggestedFilename(), 'termfolio-keywords.csv');
    const csv = await fs.readFile(await download.path(), 'utf8');
    assert.match(csv, /"Rank","Term","Words","Occurrences","Score","Method"/);
    assert.equal(csv.trim().split('\r\n').length, 4);

    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('heading', { name: 'What are you reading?' }).waitFor();
    await page.getByRole('button', { name: 'Send for extraction' }).click();
    assert.match(await page.getByRole('alert').textContent(), /Paste a document/);
    await page.fill('#source-text', 'and the or');
    await page.locator('#source-text').press('Shift+Enter');
    assert.equal(await page.locator('#source-text').inputValue(), 'and the or\n');
    await page.getByRole('button', { name: 'Send for extraction' }).click();
    await page.getByRole('heading', { name: 'No terms found' }).waitFor();

    const picker = page.locator('#document');
    await picker.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('🌧️ Coastal erosion changes dunes. Coastal erosion affects shorelines.') });
    await page.locator('#file-name').filter({ hasText: /^notes.txt$/ }).waitFor();
    await page.selectOption('#method', 'rake');
    await page.getByRole('button', { name: 'Send for extraction' }).click();
    const uploaded = page.locator('.turn').nth(1);
    await uploaded.locator('.term-row').first().waitFor();
    await uploaded.getByText('Show source highlights').click();
    await uploaded.locator('mark').first().waitFor();
    assert.match(await uploaded.locator('mark').first().textContent(), /^Coastal erosion/);
    assert.match(await uploaded.locator('.reply-meta').textContent(), /RAKE/);

    await picker.setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Coastal erosion\nDunes move over time.') });
    await page.locator('#file-name').filter({ hasText: /^notes.md$/ }).waitFor();
    assert.match(await page.locator('#source-text').inputValue(), /# Coastal erosion/);
    await page.getByRole('button', { name: 'Remove attachment' }).click();
    assert.equal(await page.locator('#source-text').inputValue(), '');
    await picker.setInputFiles({ name: 'abstract.pdf', mimeType: 'application/pdf', buffer: tinyPdf() });
    await page.locator('#file-name').filter({ hasText: /^abstract.pdf$/ }).waitFor();
    assert.match(await page.locator('#source-text').inputValue(), /Coastal erosion affects dunes/);
    await picker.setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
    await page.getByText('Could not read this PDF.', { exact: false }).waitFor();
    assert.match(await page.locator('#source-text').inputValue(), /Coastal erosion/);

    const history = page.getByRole('navigation', { name: 'This session' });
    await history.getByRole('button', { name: 'Rain gardens and urban runoff' }).click();
    assert.equal(await page.locator('.term-row').count(), 11);
    await history.getByRole('button', { name: 'and the or' }).click();
    assert.match(await page.locator('#source-text').inputValue(), /Coastal erosion/);

    await page.getByRole('button', { name: /About the rankers/ }).click();
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    await page.getByText(/500 held-out Inspec abstracts/).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').isVisible(), false);
    assert.deepEqual(errors, []);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.goto(url);
    await mobile.locator('.term-row').nth(7).waitFor();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth === window.innerWidth), true);
    const composer = await mobile.locator('#extract-form').boundingBox();
    assert.ok(composer.y + composer.height <= 844);
    await mobile.screenshot({ path: path.join(screenshots, 'mobile.png') });
    await mobile.getByRole('button', { name: 'Show conversations' }).click();
    await mobile.getByRole('button', { name: 'New chat', exact: true }).click();
    await mobile.getByRole('heading', { name: 'What are you reading?' }).waitFor();
    assert.equal(await mobile.locator('#sidebar').isVisible(), false);
  } finally {
    await browser.close();
  }
  console.log('Browser checks passed on desktop and mobile.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
