//redux/store/rootReducer.ts
import { combineReducers } from '@reduxjs/toolkit';
import groceryReducer from './grocerySlice';
import userReducer from './userSlice';

export default combineReducers({
  grocery: groceryReducer,
  user: userReducer,
});