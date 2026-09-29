import { expect, test, type Page, type Route } from '@playwright/test';
import {
  authenticate,
  expectAccessible,
  expectNoHorizontalOverflow,
  now,
  profile,
} from './support';

const lakeId = '11111111-1111-4111-8111-111111111111';
const breadId = '44444444-4444-4444-8444-444444444444';
const photoId = '55555555-5555-4555-8555-555555555555';
const newId = '66666666-6666-4666-8666-666666666666';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

type Memory = Record<string, unknown> & { memoryId: string; version: number; photos: unknown[] };

const memory = (overrides: Partial<Memory> & { memoryId: string }): Memory => ({
  coupleId: 'couple',
  createdBy: 'sender',
  createdAt: now,
  updatedAt: now,
  ingestionStatus: 'INDEXED',
  version: 1,
  photos: [],
  title: 'Fin de semana en el lago',
  occurredOn: '2026-06-20',
  body: 'Alquilamos una cabaña junto al lago y remamos hasta la isla.',
  locale: 'es',
  tags: ['viaje', 'lago'],
  category: 'Viajes',
  location: 'Lago Verde',
  ...overrides,
});

interface MockApi {
  memories: Map<string, Memory>;
  requests: { method: string; path: string; body: Record<string, unknown> | null }[];
  conflictOnNextPatch: boolean;
}

const mockApi = async (page: Page): Promise<MockApi> => {
  const api: MockApi = {
    memories: new Map([
      [
        lakeId,
        memory({
          memoryId: lakeId,
          photos: [
            {
              photoId,
              status: 'READY',
              contentType: 'image/jpeg',
              displayUrl: 'http://127.0.0.1:4200/mock-media/lake.png',
              thumbnailUrl: 'http://127.0.0.1:4200/mock-media/lake.png',
            },
          ],
        }),
      ],
      [
        breadId,
        memory({
          memoryId: breadId,
          title: 'Nuestro primer pan de masa madre',
          occurredOn: '2026-08-02',
          body: 'La bautizamos Gertrudis.',
          tags: ['cocina'],
          location: undefined,
          category: undefined,
          ingestionStatus: 'NOT_REQUESTED',
        }),
      ],
    ]),
    requests: [],
    conflictOnNextPatch: false,
  };
  await authenticate(page);
  await page.route('**/mock-media/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: onePixelPng }),
  );
  await page.route('**/mock-s3/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/mock-api/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/mock-api', '');
    const body = request.postDataJSON?.() as Record<string, unknown> | null;
    api.requests.push({ method: request.method(), path, body });
    const [, , id, sub] = path.split('/');
    if (path === '/me') return route.fulfill({ json: profile });
    if (path === '/inbox') return route.fulfill({ json: { items: [] } });
    if (path === '/timeline')
      return route.fulfill({
        json: {
          items: [...api.memories.values()].sort((a, b) =>
            String(b['occurredOn']).localeCompare(String(a['occurredOn'])),
          ),
        },
      });
    if (path === '/memories' && request.method() === 'POST') {
      const created = memory({ ...body, memoryId: newId, ingestionStatus: 'PENDING' });
      api.memories.set(newId, created);
      return route.fulfill({ status: 201, json: created });
    }
    const current = id === undefined ? undefined : api.memories.get(id);
    if (current === undefined)
      return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found' } });
    if (sub === 'uploads') {
      const reserved = { photoId: '77777777-7777-4777-8777-777777777777', status: 'PENDING' };
      current.photos = [...current.photos, { ...reserved, contentType: 'image/jpeg' }];
      return route.fulfill({
        status: 201,
        json: {
          photoId: reserved.photoId,
          url: 'http://127.0.0.1:4200/mock-s3/upload',
          fields: { key: 'staging/x' },
          expiresAt: '2026-09-21T12:05:00.000Z',
        },
      });
    }
    if (sub === 'reindex') {
      current['ingestionStatus'] = 'PENDING';
      return route.fulfill({ json: { status: 'PENDING', retryable: false } });
    }
    if (request.method() === 'PATCH') {
      if (api.conflictOnNextPatch) {
        api.conflictOnNextPatch = false;
        const theirs = {
          ...current,
          version: 3,
          body: 'Versión de Sam: desayunamos en el muelle.',
        };
        api.memories.set(current.memoryId, theirs);
        return route.fulfill({ status: 409, json: { code: 'CONFLICT', message: 'Stale.' } });
      }
      if (body?.['version'] !== current.version)
        return route.fulfill({ status: 409, json: { code: 'CONFLICT', message: 'Stale.' } });
      const updated = { ...current, ...body, version: current.version + 1 } as Memory;
      api.memories.set(current.memoryId, updated);
      return route.fulfill({ json: updated });
    }
    if (request.method() === 'DELETE') {
      api.memories.delete(current.memoryId);
      return route.fulfill({ status: 202, json: { accepted: true } });
    }
    return route.fulfill({ json: current });
  });
  return api;
};

for (const viewport of [
  { name: 'phone', width: 320, height: 720 },
  { name: 'desktop', width: 1280, height: 800 },
] as const)
  test(`the timeline groups memories by month at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockApi(page);
    await page.goto('/app/timeline');

    await expect(page.getByRole('heading', { name: 'Agosto de 2026' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Junio de 2026' })).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: 'Abrir recuerdo: Fin de semana en el lago, 20 de junio de 2026',
      }),
    ).toBeVisible();
    await expect(page.getByText('Nota escrita')).toBeVisible();
    await expect(page.getByText('Preparar para conversar')).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
  });

test('creating a memory validates, keeps typed text, and saves', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/app/timeline/new');

  await page
    .getByRole('textbox', { name: 'Recuerdo', exact: true })
    .fill('Nos quedamos frente al péndulo.');
  await page.getByRole('button', { name: 'Guardar recuerdo' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Hay 2 campos por revisar' }),
  ).toBeFocused();
  await expect(page.getByLabel('Título')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('textbox', { name: 'Recuerdo', exact: true })).toHaveValue(
    'Nos quedamos frente al péndulo.',
  );
  await expectAccessible(page);

  await page.getByLabel('Título').fill('La tarde del museo');
  await page.getByLabel('Fecha del recuerdo').fill('2025-11-03');
  await page.getByLabel('Etiquetas').fill('museo');
  await page.getByLabel('Etiquetas').press('Enter');
  await expect(page.getByRole('button', { name: 'Quitar etiqueta museo' })).toBeVisible();
  await page.getByText('Inglés').click();
  await page.getByRole('button', { name: 'Guardar recuerdo' }).click();

  await expect(page).toHaveURL(new RegExp(`/app/timeline/${newId}$`));
  await expect(page.getByText('Guardamos este momento.').last()).toBeVisible();
  expect(api.requests.find((r) => r.method === 'POST' && r.path === '/memories')?.body).toEqual({
    title: 'La tarde del museo',
    occurredOn: '2025-11-03',
    body: 'Nos quedamos frente al péndulo.',
    locale: 'en',
    tags: ['museo'],
  });
});

test('a concurrent edit opens the conflict panel and replaces only on request', async ({
  page,
}) => {
  const api = await mockApi(page);
  api.conflictOnNextPatch = true;
  await page.goto(`/app/timeline/${lakeId}/edit`);

  await page
    .getByRole('textbox', { name: 'Recuerdo', exact: true })
    .fill('Mi versión: remamos hasta la isla.');
  await page.getByRole('button', { name: 'Guardar recuerdo' }).click();

  const panel = page.getByRole('dialog', { name: 'Este recuerdo cambió mientras escribías' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Mi versión: remamos hasta la isla.')).toBeVisible();
  await panel.getByRole('button', { name: 'Revisar versión actual' }).click();
  await expect(panel.getByText('Versión de Sam: desayunamos en el muelle.')).toBeVisible();
  await expectAccessible(page);
  await panel.getByRole('button', { name: 'Guardar mi versión y reemplazar la suya' }).click();

  await expect(page).toHaveURL(new RegExp(`/app/timeline/${lakeId}$`));
  const patches = api.requests.filter((r) => r.method === 'PATCH');
  expect(patches.map((r) => r.body?.['version'])).toEqual([1, 3]);
  expect(api.memories.get(lakeId)?.['body']).toBe('Mi versión: remamos hasta la isla.');
});

test('leaving a form with changes asks first', async ({ page }) => {
  await mockApi(page);
  await page.goto('/app/timeline/new');
  await page.getByLabel('Título').fill('Borrador');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  const panel = page.getByRole('dialog', { name: '¿Salir sin guardar?' });
  await panel.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(page.getByLabel('Título')).toHaveValue('Borrador');
  await expect(page).toHaveURL(/\/app\/timeline\/new$/);

  await page.getByRole('button', { name: 'Cancelar' }).click();
  await panel.getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page).toHaveURL(/\/app\/timeline$/);
});

test('photos are checked before upload and show their progress', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/app/timeline/${breadId}`);

  await page.getByRole('button', { name: 'Añadir fotografías' }).click();
  const chooser = page.locator('input[type=file]');
  await chooser.setInputFiles({
    name: 'IMG_2044.HEIC',
    mimeType: 'image/heic',
    buffer: onePixelPng,
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Más compatible' })).toBeVisible();
  expect(api.requests.some((r) => r.path.endsWith('/uploads'))).toBe(false);

  await chooser.setInputFiles({ name: 'cabaña.jpg', mimeType: 'image/jpeg', buffer: onePixelPng });
  await expect(page.getByText('Procesando…')).toBeVisible();
  expect(api.requests.find((r) => r.path.endsWith('/uploads'))?.body).toEqual({
    contentType: 'image/jpeg',
    sizeBytes: onePixelPng.length,
  });
});

test('a ready photo opens in the viewer with keyboard navigation', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/app/timeline/${lakeId}`);
  await page.getByRole('button', { name: 'Ver fotografía 1 de 1' }).click();
  const viewer = page.getByRole('dialog', { name: 'Fotografía ampliada' });
  await expect(viewer.getByText('1 de 1')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Ver fotografía 1 de 1' })).toBeFocused();
});

test('preparing a memory for conversation requests indexing', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(`/app/timeline/${breadId}`);
  await page.getByRole('button', { name: 'Preparar para conversar' }).click();
  await expect(page.getByText('Preparando este recuerdo…').first()).toBeVisible();
  expect(api.requests.some((r) => r.path === `/memories/${breadId}/reindex`)).toBe(true);
});

test('a missing memory discloses nothing and deleting returns to the timeline', async ({
  page,
}) => {
  const api = await mockApi(page);
  await page.goto('/app/timeline/99999999-9999-4999-8999-999999999999');
  await expect(
    page.getByRole('heading', { name: 'Este recuerdo ya no está disponible' }),
  ).toBeVisible();

  await page.goto(`/app/timeline/${lakeId}`);
  await page.getByRole('button', { name: 'Eliminar recuerdo' }).click();
  const panel = page.getByRole('dialog', { name: '¿Eliminar «Fin de semana en el lago»?' });
  await expect(panel.getByText('También se eliminará su fotografía.')).toBeVisible();
  await panel.getByRole('button', { name: 'Eliminar recuerdo' }).click();
  await expect(page).toHaveURL(/\/app\/timeline$/);
  expect(api.memories.has(lakeId)).toBe(false);
});
