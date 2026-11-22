import {
  API_KEY,
  SHEETS_BASE,
  appendSheetRow,
  appendSheetRowRaw,
  columnLetter,
  fetchSheetValues,
  getGoogleAccessToken,
  getSheetHeaders,
  updateSheetRange,
} from './sheets';
import { getSheetDefinition } from '@/src/constants/workspace';

export const INVENTORY_SHEET = 'Inventory';

export interface InventoryItem {
  id: string;
  category: string;
  name: string;
  quantity: number;
  lowStockAt: number;
  notes: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** 1-based spreadsheet row, used for updates and deletes. */
  row: number;
}

export interface InventoryInput {
  category: string;
  name: string;
  quantity: number;
  lowStockAt: number;
  notes: string;
}

export interface InventoryActor {
  workerId?: string;
  name?: string;
}

const ensuredSheets = new Set<string>();

async function spreadsheetHasSheet(
  sheetId: string,
  title: string,
  token?: string
): Promise<boolean | null> {
  try {
    const keyPart = token ? '' : `&key=${API_KEY}`;
    const response = await fetch(
      `${SHEETS_BASE}/${sheetId}?fields=sheets.properties${keyPart}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    );
    if (!response.ok) return null;
    const data = await response.json();
    return (data?.sheets || []).some(
      (sheet: any) => sheet?.properties?.title === title
    );
  } catch {
    return null;
  }
}

async function inventoryGridId(
  sheetId: string,
  token: string
): Promise<number | null> {
  try {
    const response = await fetch(
      `${SHEETS_BASE}/${sheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const sheet = (data?.sheets || []).find(
      (item: any) => item?.properties?.title === INVENTORY_SHEET
    );
    const id = sheet?.properties?.sheetId;
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}

/** Creates the Inventory tab for workspaces made before it existed. */
export async function ensureInventorySheet(
  sheetId: string,
  token: string
): Promise<boolean> {
  if (!sheetId || !token) return false;
  if (ensuredSheets.has(sheetId)) return true;

  const exists = await spreadsheetHasSheet(sheetId, INVENTORY_SHEET, token);
  if (exists === null) return false;

  if (!exists) {
    const createResponse = await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          { addSheet: { properties: { title: INVENTORY_SHEET } } },
        ],
      }),
    });
    if (!createResponse.ok) return false;

    const headers = getSheetDefinition(INVENTORY_SHEET)?.headers || [];
    if (headers.length > 0) {
      try {
        await appendSheetRowRaw(sheetId, INVENTORY_SHEET, headers, token);
      } catch {
        // Fall back to a direct range write below.
      }
      const createdHeaders = await getSheetHeaders(
        sheetId,
        INVENTORY_SHEET
      ).catch(() => [] as string[]);
      if (
        !createdHeaders.includes('ItemName') &&
        !createdHeaders.includes('Category')
      ) {
        try {
          await updateSheetRange(
            sheetId,
            `${INVENTORY_SHEET}!A1:${columnLetter(headers.length)}1`,
            [headers],
            token
          );
        } catch {
          return false;
        }
      }
    }
  } else {
    // The tab may exist but be empty (for example created by hand), which
    // would make the first item look like a header row. Repair it.
    const currentHeaders = await getSheetHeaders(
      sheetId,
      INVENTORY_SHEET
    ).catch(() => [] as string[]);
    const hasHeader =
      currentHeaders.includes('ItemName') ||
      currentHeaders.includes('Category');
    if (!hasHeader) {
      const values = await fetchSheetValues(sheetId, INVENTORY_SHEET).catch(
        () => [] as string[][]
      );
      const schemaHeaders = getSheetDefinition(INVENTORY_SHEET)?.headers || [];
      if (schemaHeaders.length > 0) {
        if (values.length === 0) {
          await updateSheetRange(
            sheetId,
            `${INVENTORY_SHEET}!A1:${columnLetter(schemaHeaders.length)}1`,
            [schemaHeaders],
            token
          );
        } else {
          // Data exists without headers. Insert a row at the top and write
          // the headers so future appends line up with the schema.
          const gridId = await inventoryGridId(sheetId, token);
          if (gridId !== null) {
            try {
              const response = await fetch(
                `${SHEETS_BASE}/${sheetId}:batchUpdate`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    requests: [
                      {
                        insertDimension: {
                          range: {
                            sheetId: gridId,
                            dimension: 'ROWS',
                            startIndex: 0,
                            endIndex: 1,
                          },
                          inheritFromBefore: false,
                        },
                      },
                    ],
                  }),
                }
              );
              if (response.ok) {
                await updateSheetRange(
                  sheetId,
                  `${INVENTORY_SHEET}!A1:${columnLetter(
                    schemaHeaders.length
                  )}1`,
                  [schemaHeaders],
                  token
                );
              }
            } catch {
              // The loader still handles headerless data.
            }
          }
        }
      }
    }
  }

  ensuredSheets.add(sheetId);
  return true;
}

function itemFromValues(
  headers: string[],
  row: string[],
  rowNumber: number
): InventoryItem | null {
  const valueOf = (header: string) => {
    const index = headers.indexOf(header);
    return index >= 0 ? String(row[index] || '').trim() : '';
  };
  const name = valueOf('ItemName');
  const category = valueOf('Category');
  if (!name || !category) return null;
  return {
    id: valueOf('ItemID') || `item_${rowNumber}`,
    category,
    name,
    quantity: Math.max(0, Math.round(Number(valueOf('Quantity')) || 0)),
    lowStockAt: Math.max(0, Math.round(Number(valueOf('LowStockAt')) || 0)),
    notes: valueOf('Notes'),
    createdAt: valueOf('CreatedAt'),
    createdBy: valueOf('CreatedBy'),
    updatedAt: valueOf('UpdatedAt'),
    updatedBy: valueOf('UpdatedBy'),
    row: rowNumber,
  };
}

export async function loadInventoryItems(
  sheetId: string
): Promise<InventoryItem[]> {
  if (!sheetId) return [];
  try {
    const values = await fetchSheetValues(sheetId, INVENTORY_SHEET);
    if (values.length === 0) return [];

    const firstRow = values[0].map((cell) => String(cell || '').trim());
    const hasHeaders =
      firstRow.includes('ItemName') && firstRow.includes('Category');
    const schemaHeaders = getSheetDefinition(INVENTORY_SHEET)?.headers || [];
    const headers = hasHeaders ? firstRow : schemaHeaders;
    const dataRows = hasHeaders ? values.slice(1) : values;
    const startRow = hasHeaders ? 2 : 1;

    return dataRows
      .map((row, index) => itemFromValues(headers, row, startRow + index))
      .filter((item): item is InventoryItem => !!item);
  } catch {
    return [];
  }
}

function rowValues(
  input: InventoryInput,
  id: string,
  createdAt: string,
  createdBy: string,
  updatedAt: string,
  updatedBy: string,
  headers: string[]
): string[] {
  const values: Record<string, string> = {
    ItemID: id,
    Category: input.category,
    ItemName: input.name,
    Quantity: `${Math.max(0, Math.round(input.quantity))}`,
    LowStockAt: `${Math.max(0, Math.round(input.lowStockAt))}`,
    Notes: input.notes,
    CreatedAt: createdAt,
    CreatedBy: createdBy,
    UpdatedAt: updatedAt,
    UpdatedBy: updatedBy,
  };
  return headers.map((header) => values[header] ?? '');
}

export async function logInventoryAudit(
  sheetId: string,
  actor: InventoryActor | undefined,
  action: string,
  rowId: string,
  oldValue: string,
  newValue: string,
  token?: string | null
): Promise<void> {
  if (!sheetId) return;
  try {
    await appendSheetRow(
      sheetId,
      'AuditLog',
      [
        `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        new Date().toISOString(),
        actor?.workerId || '',
        actor?.name || '',
        action,
        INVENTORY_SHEET,
        rowId,
        oldValue,
        newValue,
      ],
      token ?? (await getGoogleAccessToken(false))
    );
  } catch {
    // Audit logging is best-effort.
  }
}

export async function addInventoryItem(
  sheetId: string,
  input: InventoryInput,
  actor?: InventoryActor
): Promise<boolean> {
  if (!sheetId) return false;
  const token = await getGoogleAccessToken(true);
  if (token) {
    try {
      await ensureInventorySheet(sheetId, token);
    } catch {
      // The append below is queued if the network is unavailable.
    }
  }
  const now = new Date().toISOString();
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let headers = getSheetDefinition(INVENTORY_SHEET)?.headers || [];
  try {
    const sheetHeaders = await getSheetHeaders(sheetId, INVENTORY_SHEET);
    if (
      sheetHeaders.includes('ItemName') &&
      sheetHeaders.includes('Category')
    ) {
      headers = sheetHeaders;
    }
  } catch {
    // Fall back to the schema order.
  }
  try {
    await appendSheetRow(
      sheetId,
      INVENTORY_SHEET,
      rowValues(
        input,
        id,
        now,
        actor?.name || '',
        now,
        actor?.name || '',
        headers
      ),
      token
    );
    void logInventoryAudit(
      sheetId,
      actor,
      'inventory_add',
      id,
      '',
      `${input.category} · ${input.name}`,
      token
    );
    return true;
  } catch (error) {
    console.warn('[Inventory] Could not add item:', error);
    return false;
  }
}

export async function updateInventoryItem(
  sheetId: string,
  item: InventoryItem,
  input: InventoryInput,
  actor?: InventoryActor
): Promise<boolean> {
  if (!sheetId || !item.row) return false;
  const token = await getGoogleAccessToken(true);
  if (token) {
    try {
      await ensureInventorySheet(sheetId, token);
    } catch {
      // Queued below when offline.
    }
  }
  const now = new Date().toISOString();
  let headers = getSheetDefinition(INVENTORY_SHEET)?.headers || [];
  try {
    const sheetHeaders = await getSheetHeaders(sheetId, INVENTORY_SHEET);
    if (
      sheetHeaders.includes('ItemName') &&
      sheetHeaders.includes('Category')
    ) {
      headers = sheetHeaders;
    }
  } catch {
    // Fall back to the schema order.
  }
  try {
    const endColumn = columnLetter(Math.max(headers.length, 1));
    await updateSheetRange(
      sheetId,
      `${INVENTORY_SHEET}!A${item.row}:${endColumn}${item.row}`,
      [
        rowValues(
          input,
          item.id,
          item.createdAt || now,
          item.createdBy || actor?.name || '',
          now,
          actor?.name || '',
          headers
        ),
      ],
      token
    );
    void logInventoryAudit(
      sheetId,
      actor,
      'inventory_update',
      item.id,
      `${item.category} · ${item.name} · qty ${item.quantity}`,
      `${input.category} · ${input.name} · qty ${input.quantity}`,
      token
    );
    return true;
  } catch {
    return false;
  }
}

export async function adjustInventoryQuantity(
  sheetId: string,
  item: InventoryItem,
  nextQuantity: number,
  actor?: InventoryActor
): Promise<boolean> {
  if (!sheetId || !item.row) return false;
  const token = await getGoogleAccessToken(false);
  const quantity = Math.max(0, Math.round(nextQuantity));
  let headers = getSheetDefinition(INVENTORY_SHEET)?.headers || [];
  try {
    const sheetHeaders = await getSheetHeaders(sheetId, INVENTORY_SHEET);
    if (
      sheetHeaders.includes('ItemName') &&
      sheetHeaders.includes('Category')
    ) {
      headers = sheetHeaders;
    }
  } catch {
    // Fall back to the schema order.
  }
  const quantityIndex = headers.indexOf('Quantity');
  const quantityColumn = columnLetter(quantityIndex >= 0 ? quantityIndex + 1 : 4);
  try {
    await updateSheetRange(
      sheetId,
      `${INVENTORY_SHEET}!${quantityColumn}${item.row}:${quantityColumn}${item.row}`,
      [[`${quantity}`]],
      token
    );
    void logInventoryAudit(
      sheetId,
      actor,
      'inventory_quantity',
      item.id,
      `${item.quantity}`,
      `${quantity}`,
      token
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteInventoryItem(
  sheetId: string,
  item: InventoryItem,
  actor?: InventoryActor
): Promise<boolean> {
  if (!sheetId || !item.row) return false;
  const headers = await getSheetHeaders(sheetId, INVENTORY_SHEET).catch(
    () => [] as string[]
  );
  const schemaColumns =
    getSheetDefinition(INVENTORY_SHEET)?.headers.length || 10;
  const columns = Math.max(headers.length, schemaColumns);
  const token = await getGoogleAccessToken(true);
  try {
    await updateSheetRange(
      sheetId,
      `${INVENTORY_SHEET}!A${item.row}:${columnLetter(columns)}${item.row}`,
      [new Array(columns).fill('')],
      token
    );
    void logInventoryAudit(
      sheetId,
      actor,
      'inventory_delete',
      item.id,
      `${item.category} · ${item.name} · qty ${item.quantity}`,
      '',
      token
    );
    return true;
  } catch {
    return false;
  }
}
