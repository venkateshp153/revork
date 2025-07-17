//assets/types/index.ts
export type GroceryItem = {
  Id: string;
  GroceryItem: string;
  Quantity?: number;
  // Add other properties as needed
};

export type ListItem = GroceryItem & {
  quantity: number;
};

export type SheetData = GroceryItem[];