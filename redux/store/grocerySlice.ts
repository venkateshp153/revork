// //redux/store/grocerySlice.ts
// import { createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit';
// import { GroceryItem, ListItem } from '@/assets/types';

// interface GroceryState {
//   items: GroceryItem[];
//   listItems: ListItem[];
//   loading: boolean;
//   error: string | null;
//   searchQuery: string;
// }

// const initialState: GroceryState = {
//   items: [],
//   listItems: [],
//   loading: false,
//   error: null,
//   searchQuery: '',
// };

// const grocerySlice = createSlice({
//   name: 'grocery',
//   initialState,
//   reducers: {
//     setItems(state, action: PayloadAction<GroceryItem[]>) {
//       state.items = action.payload;
//     },
//     setLoading(state, action: PayloadAction<boolean>) {
//       state.loading = action.payload;
//     },
//     setError(state, action: PayloadAction<string | null>) {
//       state.error = action.payload;
//     },
//     setSearchQuery(state, action: PayloadAction<string>) {
//       state.searchQuery = action.payload;
//     },
//     clearSearchQuery(state) {
//       state.searchQuery = '';
//     },
//     addToList(state, action: PayloadAction<GroceryItem>) {
//       const existingItem = state.listItems.find(item => item.Id === action.payload.Id);
//       if (existingItem) {
//         existingItem.quantity += 1;
//       } else {
//         state.listItems.push({ ...action.payload, quantity: 1 });
//       }
//     },
//     incrementQuantity(state, action: PayloadAction<string>) {
//       const item = state.listItems.find(item => item.Id === action.payload);
//       if (item) {
//         item.quantity += 1;
//       }
//     },
//     decrementQuantity(state, action: PayloadAction<string>) {
//       const item = state.listItems.find(item => item.Id === action.payload);
//       if (item) {
//         item.quantity = Math.max(1, item.quantity - 1);
//       }
//     },
//     removeFromList(state, action: PayloadAction<string>) {
//       state.listItems = state.listItems.filter(item => item.Id !== action.payload);
//     },
//     clearList(state) {
//       state.listItems = [];
//     }
//   },
// });

// export const selectFilteredItems = createSelector(
//   [(state: { grocery: GroceryState }) => state.grocery.items, 
//    (state: { grocery: GroceryState }) => state.grocery.searchQuery],
//   (items, searchQuery) => {
//     if (!searchQuery) return items;
//     const query = searchQuery.toLowerCase().trim();
//     return items.filter(item => 
//       item?.GroceryItem?.toLowerCase().includes(query)
//     );
//   }
// );

// export const selectListItems = (state: { grocery: GroceryState }) => state.grocery.listItems;

// export const { 
//   setItems, 
//   setLoading, 
//   setError, 
//   setSearchQuery, 
//   clearSearchQuery,
//   addToList,
//   incrementQuantity,
//   decrementQuantity,
//   removeFromList,
//   clearList
// } = grocerySlice.actions;

// export default grocerySlice.reducer;






// //redux/store/grocerySlice.ts
import { createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit';
import { GroceryItem, ListItem } from '@/assets/types';
import { RootState } from '.';

interface GroceryState {
  items: GroceryItem[];
  listItems: ListItem[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  _hasHydrated: boolean; // Add hydration state
}

const initialState: GroceryState = {
  items: [],
  listItems: [],
  loading: false,
  error: null,
  searchQuery: '',
  _hasHydrated: false,
};

const grocerySlice = createSlice({
  name: 'grocery',
  initialState,
  reducers: {
    setItems(state, action: PayloadAction<GroceryItem[]>) {
      state.items = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    setSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
    },
    clearSearchQuery(state) {
      state.searchQuery = '';
    },
    addToList(state, action: PayloadAction<GroceryItem>) {
      const existingItem = state.listItems.find(item => item.Id === action.payload.Id);
      if (existingItem) {
        existingItem.quantity += 1;
      } else {
        state.listItems.push({ ...action.payload, quantity: 1 });
      }
    },
    incrementQuantity(state, action: PayloadAction<string>) {
      const item = state.listItems.find(item => item.Id === action.payload);
      if (item) {
        item.quantity += 1;
      }
    },
    decrementQuantity(state, action: PayloadAction<string>) {
      const item = state.listItems.find(item => item.Id === action.payload);
      if (item) {
        item.quantity = Math.max(1, item.quantity - 1);
      }
    },
    removeFromList(state, action: PayloadAction<string>) {
      state.listItems = state.listItems.filter(item => item.Id !== action.payload);
    },
    clearList(state) {
      state.listItems = [];
    },
    // Add hydration action
    setHasHydrated(state, action: PayloadAction<boolean>) {
      state._hasHydrated = action.payload;
    }
  },
});

// Selectors
export const selectFilteredItems = createSelector(
  [(state: { grocery: GroceryState }) => state.grocery.items, 
   (state: { grocery: GroceryState }) => state.grocery.searchQuery],
  (items, searchQuery) => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase().trim();
    return items.filter(item => 
      item?.GroceryItem?.toLowerCase().includes(query)
    );
  }
);

export const selectListItems = (state: { grocery: GroceryState }) => state.grocery.listItems;
export const selectHasHydrated = (state: { grocery: GroceryState }) => state.grocery._hasHydrated;

// Export all actions
export const { 
  setItems, 
  setLoading, 
  setError, 
  setSearchQuery, 
  clearSearchQuery,
  addToList,
  incrementQuantity,
  decrementQuantity,
  removeFromList,
  clearList,
  setHasHydrated
} = grocerySlice.actions;
// In your grocerySlice.ts
// Change this in grocerySlice.ts
export const selectCartItemCount = (state: RootState) => state.grocery.listItems.length;
export default grocerySlice.reducer;