import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserProfile {
  uid?: string;
  designation?: 'admin' | 'manager' | 'worker';
  companyName: string;
  companyAddress?: string;
  companyPhone: string;
  companyEmail: string;
  sheetId?: string;
  folderId?: string;
  joinLink?: string;
}

interface WorkerProfile {
  workerId: string;
  name: string;
  email: string;
  phone: string;
  payPerHour: number;
  designation: 'worker';
  companyName: string;
  sheetId: string;
  companyId: string;
}

interface UserState {
  uid: string | null;
  name: string | null;
  email: string | null;
  googleId: string | null;
  isAuthenticated: boolean;
  isNewUser: boolean;
  designation: 'admin' | 'manager' | 'worker' | null;
  profile: UserProfile | null;
  workerProfile: WorkerProfile | null;
  joinLink: string | null;
  sheetId: string | null;
  folderId: string | null;
  companyId: string | null;
  cacheTimestamp: number | null;
}

const initialState: UserState = {
  uid: null,
  name: null,
  email: null,
  googleId: null,
  isAuthenticated: false,
  isNewUser: false,
  designation: null,
  profile: null,
  workerProfile: null,
  joinLink: null,
  sheetId: null,
  folderId: null,
  companyId: null,
  cacheTimestamp: null,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setName: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
    },
    setUserAuthenticated: (state, action: PayloadAction<{
      uid: string;
      email: string;
      name: string;
      designation?: 'admin' | 'manager' | 'worker';
      companyName?: string;
      companyAddress?: string;
      companyPhone?: string;
      companyEmail?: string;
      sheetId?: string;
      folderId?: string;
      isNewUser: boolean;
    }>) => {
      state.uid = action.payload.uid;
      state.email = action.payload.email;
      state.name = action.payload.name;
      state.designation = action.payload.designation || 'admin';
      state.isAuthenticated = true;
      state.isNewUser = action.payload.isNewUser;
      
      if (action.payload.companyName) {
        state.profile = {
          uid: action.payload.uid,
          designation: state.designation,
          companyName: action.payload.companyName,
          companyAddress: action.payload.companyAddress || '',
          companyPhone: action.payload.companyPhone || '',
          companyEmail: action.payload.companyEmail || '',
          sheetId: action.payload.sheetId || '',
          folderId: action.payload.folderId || '',
        };
        state.sheetId = action.payload.sheetId || null;
        state.folderId = action.payload.folderId || null;
      }
    },
    setProfile: (state, action: PayloadAction<UserProfile>) => {
      state.profile = action.payload;
      state.designation = action.payload.designation || 'admin';
      state.isNewUser = false;
      state.sheetId = action.payload.sheetId || null;
      state.folderId = action.payload.folderId || null;
    },
    setWorkerProfile: (state, action: PayloadAction<WorkerProfile>) => {
      state.workerProfile = action.payload;
      state.designation = 'worker';
      state.isAuthenticated = true;
      state.isNewUser = false;
      state.name = action.payload.name;
      state.email = action.payload.email;
      state.sheetId = action.payload.sheetId;
      state.companyId = action.payload.companyId;
    },
    setJoinLink: (state, action: PayloadAction<string>) => {
      state.joinLink = action.payload;
      if (state.profile) {
        state.profile.joinLink = action.payload;
      }
    },
    setSheetId: (state, action: PayloadAction<string>) => {
      state.sheetId = action.payload;
      if (state.profile) {
        state.profile.sheetId = action.payload;
      }
    },
    setFolderId: (state, action: PayloadAction<string>) => {
      state.folderId = action.payload;
      if (state.profile) {
        state.profile.folderId = action.payload;
      }
    },
    updateCacheTimestamp: (state, action: PayloadAction<number>) => {
      state.cacheTimestamp = action.payload;
    },
    logout: (state) => {
      state.uid = null;
      state.name = null;
      state.email = null;
      state.googleId = null;
      state.isAuthenticated = false;
      state.isNewUser = false;
      state.designation = null;
      state.profile = null;
      state.workerProfile = null;
      state.joinLink = null;
      state.sheetId = null;
      state.folderId = null;
      state.companyId = null;
      state.cacheTimestamp = null;
    },
  },
});

export const {
  setName,
  setUserAuthenticated,
  setProfile,
  setWorkerProfile,
  setJoinLink,
  setSheetId,
  setFolderId,
  updateCacheTimestamp,
  logout,
} = userSlice.actions;

export const selectUser = (state: { user: UserState }) => state.user;
export const selectUserName = (state: { user: UserState }) => state.user.name;
export const selectUserProfile = (state: { user: UserState }) => state.user.profile;
export const selectUserWorkerProfile = (state: { user: UserState }) => state.user.workerProfile;
export const selectUserDesignation = (state: { user: UserState }) => state.user.designation;
export const selectUserSheetId = (state: { user: UserState }) => state.user.sheetId;
export const selectUserCacheTimestamp = (state: { user: UserState }) => state.user.cacheTimestamp;

export const calcMonthlyPay = (clockingRows: any[], payPerHour: number): number => {
  const totalHours = clockingRows.reduce((sum, row) => sum + parseFloat(row.HoursWorked || 0), 0);
  return Math.round((totalHours * payPerHour) * 100) / 100;
};

export default userSlice.reducer;
