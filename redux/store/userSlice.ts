import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserState {
  name: string | null;
}

const initialState: UserState = {
  name: null,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setName: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
    },
  },
});

export const { setName } = userSlice.actions;
export const selectUserName = (state: { user: UserState }) => state.user.name;
export default userSlice.reducer;