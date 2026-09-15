import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { textDocument, type ExperimentView, type Mutation, type MutationResult } from '../../src/lib/contracts';

async function disableAutomaticWork(panel: Locator) {
  for (const name of ['Autosave', 'Polling']) {
    const toggle = panel.getByRole('switch', { name, exact: true });
    if (await toggle.getAttribute('aria-checked') === 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  }
}

async function openSandbox(page: Page) {
  await page.goto('/');
  const a = page.getByRole('region', { name: 'Client A', exact: true });
  const b = page.getByRole('region', { name: 'Client B', exact: true });
  await expect(a.getByRole('textbox', { name: 'Client A document', exact: true })).toBeVisible();
  await expect(b.getByRole('textbox', { name: 'Client B document', exact: true })).toBeVisible();
  return { a, b };
}

test('two real editors preserve a losing draft and safely adopt the winning save', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const { a, b } = await openSandbox(page);
  await disableAutomaticWork(a);
  await disableAutomaticWork(b);
  await a.getByRole('textbox', { name: 'Client A document', exact: true }).fill('Client A wins this revision.');
  await b.getByRole('textbox', { name: 'Client B document', exact: true }).fill('Client B keeps this unsaved draft.');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(a.getByRole('status')).toHaveText('Saved');
  await b.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(b.getByRole('status')).toContainText('Conflict');
  await expect(b.getByRole('textbox', { name: 'Client B document', exact: true })).toHaveText('Client B keeps this unsaved draft.');
  await expect(a.getByRole('textbox', { name: 'Client A document', exact: true })).toHaveText('Client A wins this revision.');
  await b.getByRole('button', { name: /Go to latest/ }).click();
  await expect(b.getByRole('status')).toHaveText('Saved');
  await expect(b.getByRole('textbox', { name: 'Client B document', exact: true })).toHaveText('Client A wins this revision.');
  expect(pageErrors).toEqual([]);
});

test('autosave persists a rich-text draft and a second client can read it', async ({ page }) => {
  const { a, b } = await openSandbox(page);
  await disableAutomaticWork(b);
  const editor = a.getByRole('textbox', { name: 'Client A document', exact: true });
  await editor.fill('Autosaved through Next.js into SQLite.');
  await a.getByRole('button', { name: 'Numbered list', exact: true }).click();
  await expect(editor.locator('ol')).toBeVisible();
  await expect(a.getByRole('status')).toHaveText('Saved');
  await b.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(b.getByRole('textbox', { name: 'Client B document', exact: true })).toHaveText('Autosaved through Next.js into SQLite.');
  await expect(b.getByRole('textbox', { name: 'Client B document', exact: true }).locator('ol')).toBeVisible();
});

test('a draft typed while a slow save is pending eventually reaches the server', async ({ page }) => {
  const { a, b } = await openSandbox(page);
  await disableAutomaticWork(b);
  await a.locator('summary').click();
  const responseDelay = a.getByRole('slider', { name: 'Response delay', exact: true });
  await responseDelay.focus();
  await responseDelay.press('Home');
  for (let step = 0; step < 8; step++) await responseDelay.press('ArrowRight');
  await expect(responseDelay).toHaveValue('2000');
  const editor = a.getByRole('textbox', { name: 'Client A document', exact: true });
  const saveStatus = a.locator('.save-status[role="status"]');
  await editor.fill('First request content.');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(saveStatus).toContainText('Saving');
  await editor.fill('Newest typing survives the older acknowledgment.');
  await expect(saveStatus).toHaveText('Saved');
  await b.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(b.getByRole('textbox', { name: 'Client B document', exact: true })).toHaveText('Newest typing survives the older acknowledgment.');
});

test('the Lose an update scenario visibly overwrites A with a stale write from B', async ({ page }) => {
  const { a, b } = await openSandbox(page);
  const scenarios = page.getByRole('region', { name: 'Guided experiments', exact: true });
  await scenarios.getByRole('button', { name: /Lose an update/ }).click();
  await expect(scenarios.getByRole('status')).toContainText('Both saves were accepted.');
  await expect(page.getByRole('switch', { name: 'OCC protection', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(a.getByRole('status')).toHaveText('Saved');
  await expect(b.getByRole('status')).toHaveText('Saved');
  await expect(a.getByRole('textbox', { name: 'Client A document', exact: true })).toHaveText('Client A: a carefully written first edit.');
  await expect(page.getByRole('textbox', { name: 'Persisted server document', exact: true })).toHaveText('Client B: a different edit from the same starting point.');
  await expect(page.getByRole('region', { name: 'Event timeline', exact: true })).toContainText('Newer content overwritten');
});

test('the history scenario restores a checkpoint and rejects a stale restore', async ({ page }) => {
  const { a, b } = await openSandbox(page);
  const scenarios = page.getByRole('region', { name: 'Guided experiments', exact: true });
  await scenarios.getByRole('button', { name: /Travel through history/ }).click();
  await expect(scenarios.getByRole('status')).toContainText('B’s stale restore was rejected without creating another checkpoint.');
  await expect(a.getByRole('status')).toHaveText('Saved');
  await expect(b.getByRole('status')).toContainText('Conflict');
  await expect(page.getByRole('textbox', { name: 'Persisted server document', exact: true })).toContainText('A shared starting point');
  const history = page.getByRole('region', { name: 'Checkpoint history', exact: true });
  await history.locator('summary').click();
  await expect(history.getByRole('button', { name: /Checkpoint \d/ })).toHaveCount(2);
  await history.getByRole('button', { name: /Checkpoint 2/ }).click();
  await expect(history.getByRole('textbox', { name: 'Checkpoint preview', exact: true })).toHaveText('A new revision, ready to checkpoint.');
  const timeline = page.getByRole('region', { name: 'Event timeline', exact: true });
  await expect(timeline).toContainText('Checkpoint restored');
  await expect(timeline).toContainText('Stale write rejected');
});

test('reset and mode changes create distinct experiments isolated from delayed old writes', async ({ page, request }) => {
  await openSandbox(page);
  const readId = () => page.evaluate(() => localStorage.getItem('occ-sandbox-experiment'));
  const originalId = await readId();
  expect(originalId).toBeTruthy();
  const delayedWrite = request.post(`/api/experiments/${originalId}/mutations`, { data: {
    clientId: 'A', mutationId: randomUUID(), expectedRevision: 1,
    content: textDocument('This belongs only to the old experiment.'),
    checkpoint: true, requestDelayMs: 1500, responseDelayMs: 0,
  } });
  await page.getByRole('button', { name: 'Reset experiment', exact: true }).click();
  await expect.poll(readId).not.toBe(originalId);
  const resetId = await readId();
  expect((await delayedWrite).status()).toBe(200);
  const resetView = await (await request.get(`/api/experiments/${resetId}`)).json() as ExperimentView;
  expect(resetView.document.revision).toBe(1);
  expect(resetView.events).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Client A document', exact: true })).toContainText('A shared starting point');
  await page.getByRole('switch', { name: 'OCC protection', exact: true }).click();
  await expect.poll(readId).not.toBe(resetId);
  const unsafeId = await readId();
  await expect(page.getByRole('switch', { name: 'OCC protection', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: 'Checkpoints', exact: true }).click();
  await expect.poll(readId).not.toBe(unsafeId);
  const noHistoryId = await readId();
  expect(new Set([originalId, resetId, unsafeId, noHistoryId]).size).toBe(4);
  const finalView = await (await request.get(`/api/experiments/${noHistoryId}`)).json() as ExperimentView;
  expect(finalView).toMatchObject({ config: { occEnabled: false, checkpointsEnabled: false }, document: { revision: 1 }, events: [], checkpoints: [] });
});

test('HTTP writes race with OCC and replay a committed mutation idempotently', async ({ request }) => {
  const created = await request.post('/api/experiments', { data: { occEnabled: true, checkpointsEnabled: true } });
  expect(created.status()).toBe(201);
  const experiment = await created.json() as ExperimentView;
  const endpoint = `/api/experiments/${experiment.document.experimentId}/mutations`;
  const inputs: Mutation[] = (['A', 'B'] as const).map(clientId => ({
    clientId, mutationId: randomUUID(), expectedRevision: 1,
    content: textDocument(`HTTP client ${clientId}`), checkpoint: true,
    requestDelayMs: 100, responseDelayMs: 0,
  }));
  const responses = await Promise.all(inputs.map(data => request.post(endpoint, { data })));
  expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
  const winningIndex = responses.findIndex(response => response.status() === 200);
  const committed = await responses[winningIndex].json() as MutationResult;
  const retry = await request.post(endpoint, { data: inputs[winningIndex] });
  expect(await retry.json()).toEqual(committed);
  const stored = await (await request.get(`/api/experiments/${experiment.document.experimentId}`)).json() as ExperimentView;
  expect(stored.document.revision).toBe(2);
  expect(stored.checkpoints).toHaveLength(1);
  expect(stored.events).toHaveLength(2);
});

test('HTTP validation rejects malformed writes without changing the document', async ({ request }) => {
  const created = await request.post('/api/experiments', { data: {} });
  const experiment = await created.json() as ExperimentView;
  const endpoint = `/api/experiments/${experiment.document.experimentId}/mutations`;
  const invalid = await request.post(endpoint, { data: { clientId: 'A', mutationId: randomUUID(), expectedRevision: 0, content: textDocument('invalid') } });
  expect(invalid.status()).toBe(400);
  const malformed = await request.post(endpoint, { data: '{broken', headers: { 'Content-Type': 'application/json' } });
  expect(malformed.status()).toBe(400);
  for (const content of [
    { type: 'doc', content: [{ type: 'text', text: 'A text node cannot be a top-level block.' }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text' }] }] },
  ]) {
    const invalidStructure = await request.post(endpoint, { data: { clientId: 'A', mutationId: randomUUID(), expectedRevision: 1, content } });
    expect(invalidStructure.status()).toBe(400);
    expect(await invalidStructure.json()).toMatchObject({ error: expect.stringContaining('Invalid rich-text document structure') });
  }
  const stored = await (await request.get(`/api/experiments/${experiment.document.experimentId}`)).json() as ExperimentView;
  expect(stored.document).toEqual(experiment.document);
  expect(stored.events).toEqual([]);
});
