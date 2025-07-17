//redux/store/itemsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Item {
  GroceryItem: string;
  Id: string;
}

interface ItemsState {
  items: Item[];
  loading: boolean;
  error: string | null;
}

const initialState: ItemsState = {
  items: [],
  loading: false,
  error: null,
};

const itemsSlice = createSlice({
  name: 'items',
  initialState,
  reducers: {
    setItems: (state, action: PayloadAction<Item[]>) => {
      state.items = action.payload;
      state.loading = false;
      state.error = null;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    },
  },
});

export const { setItems, setLoading, setError } = itemsSlice.actions;
export default itemsSlice.reducer;